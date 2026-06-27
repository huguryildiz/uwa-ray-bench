"use strict";
/* ============================================================================
 HARNESS LOGIC (uwa-ray-bench)
 Aggregates each panel's postMessage({type:'ray_metrics',...}) card + canonical
 TL field (101x49x31 Float32 dB, x-fastest), scores every model vs BELLHOP3D:
   - TL RMSE (dB) + TL(R) error vs the reference grid
   - synchronized camera (set/get pose via postMessage)
   - synchronized beam-stop (snap-grid, postMessage)
   - per-cell diff overlay (model - BELLHOP3D), centerline slice
   - scorecard / ranking (raw, unweighted — rubric deferred per spec)
   - analytic cursor readout (depth, D(x,y), c(z)) from focused-panel world pos
 postMessage only; no network. Model iframes are opaque (never read).
============================================================================ */

const NX=101, NY=49, NZ=31, TL_SHADOW=120, NTL=NX*NY*NZ;
const PANELS=[
  {id:'fugu',      name:'Sakana Fugu'},
  {id:'opus',      name:'Opus 4.8 (max)'},
  {id:'gpt',       name:'GPT 5.5 (XH)'},
  {id:'gemini',    name:'Gemini 3.1 Pro'},
  {id:'reference', name:'BELLHOP3D'},
];
const MODELS=['fugu','opus','gpt','gemini'];

/* analytic scenario (identical to reference) for the cursor readout */
const soundSpeed=z=> z<=200 ? 1520-0.10*z : 1500+0.018*(z-200);
const bathy=(xk,yk)=> 2500
  -1500*Math.exp(-((((xk-18)/2.5)**2)+(((yk-12)/3.0)**2)))
  -1900*Math.exp(-((((xk-34)/2.0)**2)+(((yk-9)/2.5)**2)));

/* ---- panel registry: iframe + contentWindow ---- */
const iframes={}, metrics={}, scores={};
let focusId=null, curStop={elev:41,azim:31};
let curTab='overview';
document.querySelectorAll('iframe[data-id]').forEach(f=>{iframes[f.dataset.id]=f;});
function winOf(id){return iframes[id]&&iframes[id].contentWindow;}
function idOfWindow(w){for(const p of PANELS)if(winOf(p.id)===w)return p.id;return null;}
function send(id,msg){const w=winOf(id); if(w)w.postMessage(msg,'*');}
function broadcast(msg){PANELS.forEach(p=>send(p.id,msg));}
function broadcastExcept(id,msg){PANELS.forEach(p=>{if(p.id!==id)send(p.id,msg);});}
function switchTab(name){
  curTab=name;
  document.body.className='tab-'+name;
  document.querySelectorAll('.tab-btn').forEach(b=>
    b.classList.toggle('act',b.dataset.tab===name));
  const active=name==='overview'?[...MODELS]:
    MODELS.includes(name)?[name]:name==='reference'?['reference']:[];
  PANELS.forEach(p=>{
    if(active.includes(p.id)){send(p.id,{type:playing?'play':'pause'});}
    else send(p.id,{type:'pause'});
  });
}

/* ---- normalise non-standard field names from model panels ---- */
function normalizeMetrics(m){
  // TL grid array — each model chose a different key name
  if(!m.tl){
    if(m.tlGridDb)       m.tl=m.tlGridDb;       // Fugu (also GPT fallback)
    else if(m.tlFieldDb) m.tl=m.tlFieldDb;      // GPT primary
    else if(m.grid_data) m.tl=m.grid_data;      // Gemini
    else if(m.tlGrid){                           // Opus: embedded JSON string → {dB:{0:v,1:v,...}}
      try{
        const g=typeof m.tlGrid==='string'?JSON.parse(m.tlGrid):m.tlGrid;
        if(g&&g.dB){
          const arr=new Float32Array(NTL).fill(TL_SHADOW);
          for(const k of Object.keys(g.dB)) arr[+k]=g.dB[k];
          m.tl=arr;
        }
      }catch(_){}
    }
  }
  // TL at receiver (dB)
  if(m.tl_R==null)
    m.tl_R=m.tlRDb??m.TL_R_dB??m.tl_r??null;
  // Insonified fraction (0–1)
  if(m.insonified==null){
    if(m.insonifiedFraction!=null)      m.insonified=m.insonifiedFraction;  // Fugu, Opus
    else if(m.coverageFraction!=null)   m.insonified=m.coverageFraction;    // GPT
    else if(m.insonified_pct!=null)     m.insonified=m.insonified_pct/100;  // Gemini (sends %)
  }
  // Reciprocity error (dB)
  if(m.reciprocity==null)
    m.reciprocity=m.reciprocityErrorDb??m.reciprocityErrorDB??m.reciprocity_err??null;
  // Convergence ΔTL(R) (dB) — use absolute value
  if(m.conv_tlR==null){
    let v=null;
    if(m.convergence?.tlDeltaDb!=null)       v=m.convergence.tlDeltaDb;    // Fugu
    else if(m.convergenceTlDeltaDb!=null)    v=m.convergenceTlDeltaDb;     // GPT
    else if(m.convergence_err_tl!=null)      v=m.convergence_err_tl;       // Gemini
    else if(m.convergence?.dTL_R_dB!=null) v=m.convergence.dTL_R_dB;     // Opus (object)
    else if(typeof m.convergence==='string'){
      try{const c=JSON.parse(m.convergence);v=c.dTL_R_dB??null;}catch(_){} // Opus (stringified)
    }
    if(v!=null)m.conv_tlR=Math.abs(v);
  }
  // Out-of-plane deflection (metres)
  if(m.out_of_plane==null)
    m.out_of_plane=m.maxOutOfPlaneDeflectionM??m.maxOutOfPlaneDeflM??m.max_dy??null;
}

/* ---- scoring: model TL field vs reference TL field ---- */
function scoreModel(id){
  const m=metrics[id], r=metrics.reference;
  if(!m||!r||!m.tl||!r.tl) return null;
  const a=m.tl, b=r.tl, n=Math.min(a.length,b.length,NTL);
  let se=0,cnt=0,cse=0,ccnt=0,amax=0;
  for(let i=0;i<n;i++){
    // clamp to TL_SHADOW so models using 999/Inf as shadow markers don't explode RMSE
    const av=Math.min(isFinite(a[i])?a[i]:TL_SHADOW, TL_SHADOW);
    const bv=Math.min(isFinite(b[i])?b[i]:TL_SHADOW, TL_SHADOW);
    const d=av-bv; se+=d*d; cnt++;
    if(a[i]<TL_SHADOW && b[i]<TL_SHADOW){cse+=d*d;ccnt++; if(Math.abs(d)>amax)amax=Math.abs(d);}
  }
  const tlRerr=(m.tl_R!=null&&r.tl_R!=null)?Math.abs(m.tl_R-r.tl_R):null;
  return {
    rmse: cnt?Math.sqrt(se/cnt):null,
    coreRmse: ccnt?Math.sqrt(cse/ccnt):null,
    coreCells: ccnt, maxErr: amax, tlRerr,
    canonical: !!m.canonical,
  };
}
function recompute(){ MODELS.forEach(id=>{scores[id]=scoreModel(id);}); renderScore(); if(diffOpen)drawDiff(); }

/* ---- scorecard table ---- */
function fmt(v,d=2){return v==null||!isFinite(v)?'—':(+v).toFixed(d);}
function renderScore(){
  const rows=[];
  rows.push(`<tr><th>panel</th><th>TL RMSE</th><th>core RMSE</th><th>TL(R)</th>`+
    `<th>TL(R) err</th><th>recip</th><th>conv ΔTL(R)</th><th>insonif%</th><th>|Δy| 3D</th><th>FPS</th></tr>`);
  // best (lowest) core RMSE among models that reported
  let bestId=null,bestV=Infinity;
  MODELS.forEach(id=>{const s=scores[id]; if(s&&s.coreRmse!=null&&s.coreRmse<bestV){bestV=s.coreRmse;bestId=id;}});
  PANELS.forEach(p=>{
    const m=metrics[p.id], s=scores[p.id];
    if(p.id==='reference'){
      if(!m){rows.push(`<tr class="refrow"><td>${p.name} (ref)</td><td colspan="9" style="text-align:left;color:#65809f">loading…</td></tr>`);return;}
      rows.push(`<tr class="refrow"><td>${p.name} (ref)</td><td>0.00</td><td>0.00</td>`+
        `<td>${fmt(m.tl_R,1)}</td><td>0.00</td><td>0.00</td><td>—</td>`+
        `<td>${m.insonified!=null?fmt(m.insonified*100,1):'—'}</td><td>ground truth</td>`+
        `<td>${m.fps!=null?fmt(m.fps,0):'—'}</td></tr>`);
      return;
    }
    if(!m){rows.push(`<tr><td>${p.name}</td><td colspan="9" style="text-align:left;color:#65809f">no panel / no metrics yet</td></tr>`);return;}
    const best=(p.id===bestId)?' class="best"':'';
    rows.push(`<tr${p.id===bestId?' class="leader"':''}><td>${p.name}${m.canonical===false?' <span class="pill-off">OFF-CANON</span>':''}</td>`+
      `<td${best}>${s?fmt(s.rmse):'—'}</td>`+
      `<td${best}>${s?fmt(s.coreRmse):'—'}</td>`+
      `<td>${fmt(m.tl_R,1)}</td>`+
      `<td>${s&&s.tlRerr!=null?fmt(s.tlRerr,1):'—'}</td>`+
      `<td>${m.reciprocity!=null?fmt(m.reciprocity,1):'—'}</td>`+
      `<td>${m.conv_tlR!=null?fmt(m.conv_tlR,1):'—'}</td>`+
      `<td>${m.insonified!=null?fmt(m.insonified*100,1):'—'}</td>`+
      `<td>${m.out_of_plane!=null?fmt(m.out_of_plane/1000,1)+'km':'—'}</td>`+
      `<td>${m.fps!=null?fmt(m.fps,0):'—'}</td></tr>`);
  });
  document.getElementById('scoretbl').innerHTML=rows.join('');
  renderBars();
}

/* ---- score bar charts (3×3 grid, bars per model inside each chart) ---- */
const MODEL_CLRS={fugu:'#39ff85',opus:'#7b8cff',gpt:'#ff8c42',gemini:'#ff4f9a'};
const MODEL_SHORT={fugu:'Fugu',opus:'Opus',gpt:'GPT',gemini:'Gemini'};
const CH=64; // bar area height px (matches .bc-chart height:72px)
function renderBars(){
  const el=document.getElementById('score-bars');
  if(!el)return;
  const defs=[
    {label:'TL RMSE',    unit:'dB', dp:2, get:id=>scores[id]?.rmse},
    {label:'Core RMSE',  unit:'dB', dp:2, get:id=>scores[id]?.coreRmse},
    {label:'TL(R) err',  unit:'dB', dp:1, get:id=>scores[id]?.tlRerr},
    {label:'TL(R)',      unit:'dB', dp:1, get:id=>metrics[id]?.tl_R},
    {label:'Recip',      unit:'dB', dp:1, get:id=>metrics[id]?.reciprocity},
    {label:'Conv ΔTL(R)',unit:'dB', dp:1, get:id=>metrics[id]?.conv_tlR},
    {label:'Insonif%',   unit:'%',  dp:1, get:id=>metrics[id]?.insonified!=null?metrics[id].insonified*100:null},
    {label:'|Δy| 3D',   unit:'km', dp:1, get:id=>metrics[id]?.out_of_plane!=null?metrics[id].out_of_plane/1000:null},
    {label:'FPS',        unit:'',   dp:0, get:id=>metrics[id]?.fps!=null?+metrics[id].fps:null},
  ];
  let out='';
  for(const d of defs){
    const vals=MODELS.map(id=>({id,v:d.get(id)}));
    const nums=vals.map(x=>x.v).filter(v=>v!=null&&isFinite(v));
    const mx=nums.length?Math.max(...nums):0;
    const unitSpan=d.unit?` <small style="font-size:7px;opacity:.5">${d.unit}</small>`:'';
    let cols='';
    for(const {id,v} of vals){
      const h=mx>0&&v!=null?Math.max(Math.round(v/mx*CH),2):0;
      const clr=MODEL_CLRS[id];
      cols+=`<div class="bc-col">`+
        `<span class="bc-val-v" style="color:${clr}">${v!=null?v.toFixed(d.dp):'—'}</span>`+
        `<div class="bc-bar-v" style="height:${h}px;background:${clr};box-shadow:0 0 6px ${clr}88"></div>`+
        `</div>`;
    }
    const xlbls=MODELS.map(id=>`<span class="bc-xl">${MODEL_SHORT[id]}</span>`).join('');
    out+=`<div class="bc-g"><div class="bc-hd">${d.label}${unitSpan}</div>`+
      `<div class="bc-chart">${cols}</div>`+
      `<div class="bc-xlbls">${xlbls}</div></div>`;
  }
  el.innerHTML=out||'';
}

/* ---- diff overlay: centerline y=12km slice (x by z), model - reference ---- */
const IY_CENTER=Math.round(12/24*(NY-1));   // = 24
let diffOpen=false;
function drawDiff(){
  const sel=document.getElementById('diffmodel'), id=sel.value;
  const m=metrics[id], r=metrics.reference, info=document.getElementById('diffinfo');
  const cv=document.getElementById('diffcanvas'), ctx=cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  if(!m||!m.tl||!r||!r.tl){info.textContent='waiting for '+id+' + reference TL fields…';return;}
  const PX=cv.width/NX, PZ=cv.height/NZ;
  let maxAbs=1;
  for(let iz=0;iz<NZ;iz++)for(let ix=0;ix<NX;ix++){
    const k=ix+IY_CENTER*NX+iz*NX*NY;
    if(m.tl[k]<TL_SHADOW&&r.tl[k]<TL_SHADOW){const d=Math.abs(m.tl[k]-r.tl[k]);if(d>maxAbs)maxAbs=d;}
  }
  maxAbs=Math.min(maxAbs,30);
  for(let iz=0;iz<NZ;iz++)for(let ix=0;ix<NX;ix++){
    const k=ix+IY_CENTER*NX+iz*NX*NY;
    const mv=m.tl[k], rv=r.tl[k];
    if(mv>=TL_SHADOW||rv>=TL_SHADOW){ctx.fillStyle='#0b1018';}
    else{const d=Math.max(-maxAbs,Math.min(maxAbs,mv-rv))/maxAbs; ctx.fillStyle=diverge(d);}
    ctx.fillRect(ix*PX, iz*PZ, PX+0.8, PZ+0.8);
  }
  ctx.fillStyle='#9bb6d8';ctx.font='10px sans-serif';ctx.textAlign='left';
  ctx.fillText('0',2,cv.height-3);ctx.fillText('range x →  50 km',cv.width-96,cv.height-3);
  ctx.save();ctx.translate(2,12);ctx.fillText('z 0 → 3000 m ↓',0,0);ctx.restore();
  info.innerHTML=`scale ±${maxAbs.toFixed(0)} dB &nbsp; <span style="color:#5b9bff">blue=model under</span> / `+
    `<span style="color:#ff6b6b">red=model over</span> &nbsp; RMSE ${scores[id]?fmt(scores[id].rmse):'—'} dB`;
}
function diverge(t){ // t in [-1,1] -> blue..white..red
  if(t<0){const u=1+t;return `rgb(${(40+u*215)|0},${(90+u*165)|0},255)`;}
  const u=1-t;return `rgb(255,${(90+u*165)|0},${(40+u*215)|0})`;
}

/* ---- camera + stop + playback sync ---- */
let playing=false, lastPose={yaw:1.0,pitch:0.72,dist:3.3};
function setStop(elev,azim){curStop={elev:+elev,azim:+azim};
  document.getElementById('elevsel').value=elev;document.getElementById('azimsel').value=azim;
  broadcast({type:'set_stop',elev:+elev,azim:+azim});}

/* ---- message hub ---- */
addEventListener('message',e=>{
  const m=e.data||{}; const id=idOfWindow(e.source);
  switch(m.type){
    case'ready':{ const rid=m.panel||id; if(rid){clearWait(rid);
        send(rid,{type:'set_stop',elev:curStop.elev,azim:curStop.azim});
        if(lastPose)send(rid,{type:'set_camera',pose:lastPose});
        send(rid,{type:'request_metrics'});
        if(!playing)send(rid,{type:'pause'});}
      break;}
    case'ray_metrics':{ const pid=m.panel||id; if(!pid)break; clearWait(pid);
      normalizeMetrics(m);
      if(m.tl&&Array.isArray(m.tl))m.tl=Float32Array.from(m.tl);
      metrics[pid]=m; recompute(); break;}
    case'camera':{ if(id){lastPose=m.pose; broadcastExcept(id,{type:'set_camera',pose:m.pose});} break;}
    case'cursor':{ if(m.clear){setReadout(null);} else setReadout(m); if(id){focusId=id;markFocus(id);} break;}
  }
});
function clearWait(id){const c=document.querySelector(`.cell[data-id="${id}"] .wait`); if(c)c.style.display='none';
  const chip=document.querySelector(`.cell[data-id="${id}"] .chip`); if(chip)chip.classList.add('live');}
function markFocus(id){document.querySelectorAll('.cell').forEach(c=>
  c.classList.toggle('focus', c.dataset.id===id));}

/* ---- analytic cursor readout ---- */
function setReadout(w){
  const el=document.getElementById('readout');
  if(!w){el.textContent='cursor: —';return;}
  const c=soundSpeed(w.z_m), D=bathy(w.x_km,w.y_km);
  el.innerHTML=`cursor&nbsp; x=<b>${w.x_km.toFixed(1)}</b>km `+
    `y=<b>${w.y_km.toFixed(1)}</b>km depth=<b>${w.z_m.toFixed(0)}</b>m &nbsp;`+
    `c(z)=<b>${c.toFixed(1)}</b>m/s &nbsp; D(x,y)=<b>${D.toFixed(0)}</b>m`;
}

/* ---- top-bar controls ---- */
function buildSelectors(stops){
  const es=document.getElementById('elevsel'), as=document.getElementById('azimsel');
  stops.elev.forEach(v=>es.add(new Option(v,v)));
  stops.azim.forEach(v=>as.add(new Option(v,v)));
  es.value=41; as.value=31;
  es.onchange=()=>setStop(es.value,curStop.azim);
  as.onchange=()=>setStop(curStop.elev,as.value);
  MODELS.forEach(id=>document.getElementById('diffmodel').add(new Option(PANELS.find(p=>p.id===id).name,id)));
}
document.getElementById('play').onclick=()=>{playing=!playing;
  document.getElementById('play').textContent=playing?'❚❚ Pause all':'▶ Play all';
  broadcast({type:playing?'play':'pause'});};
document.getElementById('reset').onclick=()=>{playing=false;
  document.getElementById('play').textContent='▶ Play all';broadcast({type:'reset'});};
document.getElementById('camreset').onclick=()=>{lastPose={yaw:1.0,pitch:0.72,dist:3.3};
  broadcast({type:'set_camera',pose:lastPose});};
document.getElementById('canon').onclick=()=>setStop(41,31);
document.getElementById('volchk').onchange=e=>broadcast({type:'set_volume',on:e.target.checked});
document.getElementById('opac').oninput=e=>broadcast({type:'set_opacity',v:+e.target.value});
document.querySelectorAll('.tab-btn').forEach(btn=>{btn.onclick=()=>switchTab(btn.dataset.tab);});
document.querySelectorAll('.focus-overlay').forEach(ov=>{ov.onclick=()=>switchTab(ov.dataset.focus);});

/* overview: play-on-hover — only the hovered panel animates; prevents 4 concurrent WebGL renders */
document.querySelectorAll('.cell[data-id]').forEach(cell=>{
  const id=cell.dataset.id;
  cell.addEventListener('mouseenter',()=>{
    if(curTab==='overview'&&!playing)
      PANELS.forEach(p=>send(p.id,p.id===id?{type:'play'}:{type:'pause'}));
  });
  cell.addEventListener('mouseleave',()=>{
    if(curTab==='overview'&&!playing) send(id,{type:'pause'});
  });
});
document.getElementById('scorebtn').onclick=()=>switchTab('scorecard');
document.getElementById('physicsbtn').onclick=()=>switchTab('scorecard');
document.getElementById('diffbtn').onclick=e=>{diffOpen=true;
  document.getElementById('diff').classList.add('show');e.target.classList.add('on');drawDiff();};
document.getElementById('diffclose').onclick=()=>{diffOpen=false;
  document.getElementById('diff').classList.remove('show');
  document.getElementById('diffbtn').classList.remove('on');};
document.getElementById('diffmodel').onchange=drawDiff;

/* ---- mobile hamburger menu (collapses the toolbar in portrait) ---- */
(function(){
  const bar=document.getElementById('bar'), ham=document.getElementById('hamburger');
  if(!bar||!ham)return;
  const set=open=>{bar.classList.toggle('nav-open',open);ham.setAttribute('aria-expanded',open);};
  ham.onclick=()=>set(!bar.classList.contains('nav-open'));
  /* tapping a one-shot action closes the drawer; Fan/View stay open to interact */
  document.getElementById('bar-actions').addEventListener('click',e=>{
    if(e.target.closest('#play,#reset,#camreset,#diffbtn,#scorebtn,#physicsbtn'))set(false);
  });
})();

/* ---- animated sonar favicon (canvas → link.href, ~12.5fps) ---- */
(function sonarFavicon(){
  const link=document.querySelector('link[rel="icon"]'); if(!link) return;
  const N=32, c=Object.assign(document.createElement('canvas'),{width:N,height:N}), g=c.getContext('2d');
  const cx=16, cy=16, R=15; let a=-Math.PI/2;
  function frame(){
    g.clearRect(0,0,N,N);
    g.beginPath(); g.arc(cx,cy,R,0,7); g.fillStyle='#06160d'; g.fill();
    g.strokeStyle='rgba(57,255,133,.30)'; g.lineWidth=1;
    [5,10].forEach(r=>{g.beginPath();g.arc(cx,cy,r,0,7);g.stroke();});
    g.beginPath();g.arc(cx,cy,R-0.5,0,7);g.strokeStyle='rgba(57,255,133,.55)';g.stroke();
    g.strokeStyle='rgba(57,255,133,.18)';
    g.beginPath();g.moveTo(1,cy);g.lineTo(N-1,cy);g.moveTo(cx,1);g.lineTo(cx,N-1);g.stroke();
    g.beginPath();g.moveTo(cx,cy);g.arc(cx,cy,R,a,a+1.3);g.closePath();
    g.fillStyle='rgba(57,255,133,.22)';g.fill();
    g.beginPath();g.moveTo(cx,cy);g.lineTo(cx+R*Math.cos(a),cy+R*Math.sin(a));
    g.strokeStyle='#9dffc4';g.lineWidth=1.4;g.stroke();
    g.beginPath();g.arc(cx,cy,1.6,0,7);g.fillStyle='#39ff85';g.fill();
    link.type='image/png'; link.href=c.toDataURL('image/png');
    a=(a+0.18)%(Math.PI*2);
  }
  frame(); setInterval(frame,500);
})();

/* ---- boot ---- */
buildSelectors({elev:[11,21,41,61,81], azim:[9,16,31,46,61]});
renderScore();
setTimeout(()=>broadcast({type:'request_metrics'}),1500);
