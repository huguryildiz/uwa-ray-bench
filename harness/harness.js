"use strict";
/* ============================================================================
 HARNESS LOGIC (uwa-ray-bench)
 Aggregates each panel's postMessage({type:'ray_metrics',...}) card + canonical
 TL field (101x49x31 Float32 dB, x-fastest), scores every model vs BELLHOP3D:
   - TL RMSE (dB) + TL(R) error vs the reference grid
   - synchronized camera (set/get pose via postMessage)
   - synchronized beam-stop (snap-grid, postMessage)
   - per-cell diff overlay (model - BELLHOP3D), centerline slice
   - scorecard / ranking (weighted leader score per spec)
   - analytic cursor readout (depth, D(x,y), c(z)) from focused-panel world pos
 postMessage only; no network. Model iframes are opaque (never read).
============================================================================ */

const SCORING=globalThis.UwaRayScoring;
const NX=101, NY=49, NZ=31, TL_SHADOW=SCORING.TL_SHADOW, NTL=NX*NY*NZ;
const PANELS=[
  {id:'fugu',      name:'Sakana Fugu'},
  {id:'opus',      name:'Opus 4.8 (max)'},
  {id:'gpt',       name:'GPT 5.5 (XH)'},
  {id:'gemini',    name:'Gemini 3.1 Pro'},
  {id:'fable',     name:'Fable 5 (Max)'},
  {id:'reference', name:'BELLHOP3D'},
];
const MODELS=['fugu','opus','gpt','gemini','fable'];

/* analytic scenario (identical to reference) for the cursor readout */
const soundSpeed=z=> z<=200 ? 1520-0.10*z : 1500+0.018*(z-200);
const bathy=(xk,yk)=> 2500
  -1500*Math.exp(-((((xk-18)/2.5)**2)+(((yk-12)/3.0)**2)))
  -1900*Math.exp(-((((xk-34)/2.0)**2)+(((yk-9)/2.5)**2)));

/* ---- panel registry: iframe + contentWindow ---- */
const iframes={}, metrics={}, scores={};
let focusId=null, curStop={elev:41,azim:31};
let curTab='overview', curCompareModel='fugu';
document.querySelectorAll('iframe[data-id]').forEach(f=>{iframes[f.dataset.id]=f;});
function winOf(id){return iframes[id]&&iframes[id].contentWindow;}

/* ---- panel lifecycle (WP2): iframes are lazy (data-src). Mount = boot a GL
   context + rAF loop; unmount = about:blank (kills the context + rAF, not just
   hides them). Cached metrics stay in memory so the scorecard/diff survive an
   unmount. Quick View shows one live leader/fallback panel plus static posters;
   Compare shows exactly two (model + reference); at most MOUNT_CAP live GL
   panels exist at once, kept warm as an LRU so back-and-forth switching is fast. */
const MOUNT_CAP=2;                    // ceiling on simultaneously-live GL panels
const mounted=new Set();
let lru=[];                           // mounted ids, most-recently-touched first
function touchLRU(id){ lru=[id,...lru.filter(x=>x!==id)]; }
function activeSetFor(name){
  if(name==='overview')    return [currentLeader()||curCompareModel]; // one live panel
  if(name==='compare')     return [curCompareModel,'reference'];  // exactly 2 live
  if(name==='physics')     return [];
  if(MODELS.includes(name))return [name];
  if(name==='reference')   return ['reference'];
  return [];
}
function mountPanel(id){
  const f=iframes[id]; if(!f)return;
  if(!mounted.has(id)){ mounted.add(id); f.src=f.dataset.src; }
  touchLRU(id);
}
function unmountPanel(id){
  const f=iframes[id]; if(!f||!mounted.has(id))return;
  mounted.delete(id); lru=lru.filter(x=>x!==id);
  f.src='about:blank';
  const cell=document.querySelector(`.cell[data-id="${id}"]`);
  if(cell){const chip=cell.querySelector('.chip'); if(chip)chip.classList.remove('live');
    const w=cell.querySelector('.wait'); if(w)w.style.display='';}
}
/* Mount the tab's required live set; keep up to MOUNT_CAP total warm (LRU),
   unmount the rest. Quick View and Compare hold no warm extras — they must show
   exactly 1 and exactly 2 live panels respectively. */
function mountForTab(name){
  const active=activeSetFor(name);
  active.forEach(mountPanel);
  const noWarm=(name==='overview'||name==='compare');
  const warmCap=noWarm?0:Math.max(0,MOUNT_CAP-active.length);
  const activeSet=new Set(active);
  const warm=[];
  for(const id of lru){ if(activeSet.has(id))continue; if(warm.length<warmCap)warm.push(id); }
  const allowed=new Set([...active,...warm]);
  [...mounted].forEach(id=>{ if(!allowed.has(id))unmountPanel(id); });
  document.querySelectorAll('.cell').forEach(c=>c.classList.remove('live-cell'));
  if(name==='overview')active.forEach(id=>{
    const cell=document.querySelector(`.cell[data-id="${id}"]`);
    if(cell)cell.classList.add('live-cell');
  });
}

/* ---- sequential warm-up (WP1): boot panels one at a time to capture each
   panel's ray_metrics + TL field, score against the reference, cache the
   scorecard — so scores no longer require every panel to be alive at once,
   and the FPS column is a fair solo measurement. Reference goes first (its
   TL field is needed to score every model) and stays in memory after. ---- */
let warmToken=0;
const warmWaiters=new Map();
async function warmup(){
  const token=++warmToken;
  const order=['reference',...MODELS];
  const keep=new Set(activeSetFor(curTab));      // panels the visible tab needs — don't unmount those
  for(const id of order){
    if(token!==warmToken)return;                 // a newer warm-up superseded this one
    await warmOne(id);
    if(token!==warmToken)return;
    if(!keep.has(id))unmountPanel(id);           // free the ones the current view isn't showing
  }
  mountForTab(curTab);                           // ensure the active tab is fully displayed
}
function warmOne(id){
  return new Promise(resolve=>{
    mountPanel(id);
    let done=false;
    const finish=()=>{ if(done)return; done=true; clearTimeout(to);
      if(warmWaiters.get(id)===finish)warmWaiters.delete(id); resolve(); };
    warmWaiters.set(id,finish);
    const to=setTimeout(finish,8000);            // fallback if a panel never answers
  });
}

/* ---- score cache (WP1): canonical 41×31 only, in sessionStorage, so the
   scorecard paints instantly on reload. Slim (scalars + computed score); the
   TL fields live in memory, not the cache. ---- */
function cacheKey(){return `uwarb_scores_${curStop.elev}x${curStop.azim}`;}
function slimMetrics(m){return m?{
  tl_R:m.tl_R??null, insonified:m.insonified??null, reciprocity:m.reciprocity??null,
  conv_tlR:m.conv_tlR??null, out_of_plane:m.out_of_plane??null, fps:m.fps??null,
  canonical:m.canonical!==false}:null;}
function saveCache(){
  if(!(curStop.elev===41&&curStop.azim===31))return;   // canonical is the only scored stop
  try{
    const obj={models:{},ref:slimMetrics(metrics.reference)};
    MODELS.forEach(id=>{ if(scores[id]||metrics[id])
      obj.models[id]={s:scores[id]||null,m:slimMetrics(metrics[id])}; });
    sessionStorage.setItem(cacheKey(),JSON.stringify(obj));
  }catch(_){}
}
function loadCache(){
  try{
    const raw=sessionStorage.getItem('uwarb_scores_41x31'); if(!raw)return false;
    const obj=JSON.parse(raw);
    if(obj.ref)metrics.reference={...(metrics.reference||{}),...obj.ref};
    MODELS.forEach(id=>{ const e=obj.models&&obj.models[id]; if(!e)return;
      if(e.m)metrics[id]={...(metrics[id]||{}),...e.m};
      if(e.s)scores[id]=e.s; });
    return true;
  }catch(_){return false;}
}
function idOfWindow(w){for(const p of PANELS)if(winOf(p.id)===w)return p.id;return null;}
function send(id,msg){const w=winOf(id); if(w)w.postMessage(msg,'*');}
function broadcast(msg){PANELS.forEach(p=>send(p.id,msg));}
function broadcastExcept(id,msg){PANELS.forEach(p=>{if(p.id!==id)send(p.id,msg);});}
function switchTab(name){
  curTab=name;
  [...document.body.classList]
    .filter(cls=>cls.startsWith('tab-'))
    .forEach(cls=>document.body.classList.remove(cls));
  document.body.classList.add('tab-'+name);
  document.querySelectorAll('.tab-btn').forEach(b=>
    b.classList.toggle('act',b.dataset.tab===name));
  mountForTab(name);                             // WP1: mount what the tab shows, unmount the rest
  const active=new Set(activeSetFor(name));
  PANELS.forEach(p=>{
    send(p.id,{type:active.has(p.id)?(playing?'play':'pause'):'pause'});
  });
}
function setCompareModel(id){
  curCompareModel=id;
  document.querySelectorAll('.cell').forEach(c=>
    c.classList.toggle('compare-active',c.dataset.id===id));
  const sel=document.getElementById('compare-model');
  if(sel&&sel.value!==id)sel.value=id;
  if(curTab==='compare'){
    mountForTab('compare');                      // WP1: swap the live model to the chosen one
    PANELS.forEach(p=>send(p.id,{type:(p.id===id||p.id==='reference')?(playing?'play':'pause'):'pause'}));
  }
  updateCompareInfo();
}
function updateCompareInfo(){
  const el=document.getElementById('compare-info'); if(!el)return;
  const s=scores[curCompareModel];
  if(!s){el.textContent='vs BELLHOP3D reference';return;}
  el.textContent=`RMSE ${fmt(s.rmse)} dB · TL(R) err ${fmt(s.tlRerr,1)} dB  ·  vs BELLHOP3D`;
}

/* ---- normalise non-standard field names from model panels ---- */
function normalizeMetrics(m){
  // TL grid array — each model chose a different key name
  if(!m.tl){
    if(m.tlGridDb)       m.tl=m.tlGridDb;       // Fugu (also GPT fallback)
    else if(m.tlFieldDb) m.tl=m.tlFieldDb;      // GPT primary
    else if(m.grid_data) m.tl=m.grid_data;      // Gemini
    else if(m.tlField)   m.tl=m.tlField;        // Fable
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
    else if(m.insonifiedFrac!=null)     m.insonified=m.insonifiedFrac;      // Fable
  }
  // Reciprocity error (dB)
  if(m.reciprocity==null)
    m.reciprocity=m.reciprocityErrorDb??m.reciprocityErrorDB??m.reciprocity_err??m.reciprocityErrDB??null;
  // Convergence ΔTL(R) (dB) — use absolute value
  if(m.conv_tlR==null){
    let v=null;
    if(m.convergence?.tlDeltaDb!=null)       v=m.convergence.tlDeltaDb;    // Fugu
    else if(m.convergenceTlDeltaDb!=null)    v=m.convergenceTlDeltaDb;     // GPT
    else if(m.convergence_err_tl!=null)      v=m.convergence_err_tl;       // Gemini
    else if(m.convergence?.dTL_R_dB!=null) v=m.convergence.dTL_R_dB;     // Opus (object)
    else if(m.convDTL_R_dB!=null)            v=m.convDTL_R_dB;            // Fable
    else if(typeof m.convergence==='string'){
      try{const c=JSON.parse(m.convergence);v=c.dTL_R_dB??null;}catch(_){} // Opus (stringified)
    }
    if(v!=null)m.conv_tlR=Math.abs(v);
  }
  // Out-of-plane deflection (metres)
  if(m.out_of_plane==null)
    m.out_of_plane=m.maxOutOfPlaneDeflectionM??m.maxOutOfPlaneDeflM??m.max_dy??m.maxOutOfPlaneDyM??null;
}

/* ---- scoring: model TL field vs reference TL field ---- */
function scoreModel(id){
  const m=metrics[id], r=metrics.reference;
  return SCORING.scoreModel(m,r,NTL);
}
/* WP1: rescore only what changed (the reference moving invalidates every model) */
function recompute(changedId){
  if(changedId&&changedId!=='reference') scores[changedId]=scoreModel(changedId);
  else MODELS.forEach(id=>{scores[id]=scoreModel(id);});
  renderScore(); renderHero(); updatePosters(); if(diffOpen)drawDiff(); saveCache();
}
/* WP1: DOM-diff guard — skip the innerHTML rebuild (and its layout/paint) when
   the produced markup is byte-identical to what's already mounted */
function setHTML(el,html){ if(!el)return; if(el._h!==html){el.innerHTML=html; el._h=html;} }

/* ---- scorecard table ---- */
function fmt(v,d=2){return v==null||!isFinite(v)?'—':(+v).toFixed(d);}
function renderScore(){
  const rows=[];
  const refTlR=metrics.reference?.tl_R??null;
  const refInson=metrics.reference?.insonified!=null?metrics.reference.insonified*100:null;
  // per-column winner detection (canonical panels only)
  const COLS=[
    {key:'leader', dir:'low',     get:id=>scores[id]?.leaderScore},
    {key:'rmse',    dir:'low',     get:id=>scores[id]?.rmse},
    {key:'core',    dir:'low',     get:id=>scores[id]?.coreRmse},
    {key:'mask',    dir:'low',     get:id=>scores[id]?.maskError},
    {key:'tlR',     dir:'nearest', ref:refTlR, get:id=>metrics[id]?.tl_R},
    {key:'tlRerr',  dir:'low',     get:id=>scores[id]?.tlRerr},
    {key:'recip',   dir:'low',     get:id=>metrics[id]?.reciprocity},
    {key:'conv',    dir:'low',     get:id=>metrics[id]?.conv_tlR},
    {key:'insonif', dir:'nearest', ref:refInson, get:id=>metrics[id]?.insonified!=null?metrics[id].insonified*100:null},
    {key:'oop',     dir:'nearest', ref:()=>metrics.reference?.out_of_plane, get:id=>metrics[id]?.out_of_plane},
    {key:'fps',     dir:'high',    get:id=>metrics[id]?.fps},
  ];
  const winners={};
  for(const col of COLS){
    let wId=null,wV=null;
    for(const id of MODELS){
      if(scores[id]?.canonical===false)continue;
      const v=col.get(id);
      if(v==null||!isFinite(v))continue;
      if(wId===null){wId=id;wV=v;continue;}
      const ref=typeof col.ref==='function'?col.ref():col.ref;
      const better=col.dir==='low'?v<wV:col.dir==='high'?v>wV:Math.abs(v-(ref??0))<Math.abs(wV-(ref??0));
      if(better){wId=id;wV=v;}
    }
    if(wId)winners[col.key]=wId;
  }
  const DI={low:'↓',high:'↑',nearest:'≈'};
  const TITLES={low:'lower is better',high:'higher is better',nearest:'nearest to reference'};
  const HLBLS=['Leader','TL RMSE','core RMSE','Mask err','TL(R)','TL(R) err','recip','conv ΔTL(R)','insonif%','|Δy| 3D','FPS'];
  const leaderId=currentLeader();
  rows.push(`<tr><th>panel</th>`+
    COLS.map((c,i)=>`<th title="${TITLES[c.dir]}">${HLBLS[i]}`+
      ` <span style="opacity:.4;font-size:9px;font-weight:400">${DI[c.dir]}</span></th>`).join('')+`</tr>`);
  function wcell(key,id,content){
    if(winners[key]!==id)return`<td>${content}</td>`;
    const clr=MODEL_CLRS[id];
    return`<td style="color:${clr};text-shadow:0 0 10px ${clr}55;background:${clr}1a;border-radius:5px;font-weight:600">${content}</td>`;
  }
  PANELS.forEach(p=>{
    const m=metrics[p.id],s=scores[p.id];
    if(p.id==='reference'){
      if(!m){rows.push(`<tr class="refrow"><td>${p.name} (ref)</td><td colspan="11" style="text-align:left;color:#65809f">loading…</td></tr>`);return;}
      rows.push(`<tr class="refrow"><td>${p.name} (ref)</td><td>0.0</td><td>0.00</td><td>0.00</td><td>0%</td>`+
        `<td>${fmt(m.tl_R,1)}</td><td>0.00</td><td>0.00</td><td>—</td>`+
        `<td>${m.insonified!=null?fmt(m.insonified*100,1):'—'}</td><td>ground truth</td>`+
        `<td>${m.fps!=null?fmt(m.fps,0):'—'}</td></tr>`);
      return;
    }
    if(!m){rows.push(`<tr><td>${p.name}</td><td colspan="11" style="text-align:left;color:#65809f">no panel / no metrics yet</td></tr>`);return;}
    rows.push(`<tr${p.id===leaderId?' class="leader"':''}><td>${p.name}${m.canonical===false?' <span class="pill-off">OFF-CANON</span>':''}</td>`+
      wcell('leader',p.id,s&&s.leaderScore!=null?fmt(s.leaderScore,1):'—')+
      wcell('rmse',p.id,s?fmt(s.rmse):'—')+
      wcell('core',p.id,s?fmt(s.coreRmse):'—')+
      wcell('mask',p.id,s&&s.maskError!=null?fmt(s.maskError*100,1)+'%':'—')+
      wcell('tlR',p.id,fmt(m.tl_R,1))+
      wcell('tlRerr',p.id,s&&s.tlRerr!=null?fmt(s.tlRerr,1):'—')+
      wcell('recip',p.id,m.reciprocity!=null?fmt(m.reciprocity,1):'—')+
      wcell('conv',p.id,m.conv_tlR!=null?fmt(m.conv_tlR,1):'—')+
      wcell('insonif',p.id,m.insonified!=null?fmt(m.insonified*100,1):'—')+
      wcell('oop',p.id,m.out_of_plane!=null?fmt(m.out_of_plane/1000,1)+'km':'—')+
      wcell('fps',p.id,m.fps!=null?fmt(m.fps,0):'—')+
      `</tr>`);
  });
  setHTML(document.getElementById('scoretbl'),rows.join(''));
  renderBars();
}

/* ---- score bar charts (3×3 grid, bars per model inside each chart) ---- */
const MODEL_CLRS={fugu:'#39ff85',opus:'#7b8cff',gpt:'#ff8c42',gemini:'#ff4f9a',fable:'#2dd4bf'};
const MODEL_SHORT={fugu:'Fugu',opus:'Opus',gpt:'GPT',gemini:'Gemini',fable:'Fable'};
const CH=64; // bar area height px (matches .bc-chart height:72px)
function renderBars(){
  const el=document.getElementById('score-bars');
  if(!el)return;
  const defs=[
    {label:'Leader',     unit:'', dp:1, get:id=>scores[id]?.leaderScore},
    {label:'TL RMSE',    unit:'dB', dp:2, get:id=>scores[id]?.rmse},
    {label:'Core RMSE',  unit:'dB', dp:2, get:id=>scores[id]?.coreRmse},
    {label:'Mask err',   unit:'%', dp:1, get:id=>scores[id]?.maskError!=null?scores[id].maskError*100:null},
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
  setHTML(el,out||'');
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
        /* WP1: replay global state a lazily-mounted panel missed at boot */
        send(rid,{type:'hide_controls'});
        send(rid,{type:(activeSetFor(curTab).includes(rid)&&playing)?'play':'pause'});
        send(rid,{type:'request_metrics'});}
      break;}
    case'ray_metrics':{ const pid=m.panel||id; if(!pid)break; clearWait(pid);
      normalizeMetrics(m);
      if(m.tl&&Array.isArray(m.tl))m.tl=Float32Array.from(m.tl);
      metrics[pid]=m; recompute(pid);
      const w=warmWaiters.get(pid); if(w)w();      // WP1: unblock the sequential warm-up
      break;}
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

/* ---- leader = weighted physics score among canonical models. Tie within two
   points goes to the model whose out-of-plane |Δy| is closest to BELLHOP3D. ---- */
function coreScore(id){
  const s=scores[id]; if(!s||s.coreRmse==null||!isFinite(s.coreRmse))return null;
  return s.leaderScore;
}
function currentLeader(){
  return SCORING.leaderOf(MODELS,scores,metrics);
}
/* WP2: fill each Quick View poster's cached-score line (harness chrome only —
   the poster never mounts the model panel). */
function updatePosters(){
  MODELS.forEach(id=>{
    const el=document.querySelector(`.cell[data-id="${id}"] .poster-stat`);
    if(!el)return;
    const v=scores[id]?.coreRmse;
    const ls=scores[id]?.leaderScore;
    el.textContent=(ls!=null&&isFinite(ls))?`leader ${ls.toFixed(1)} pts`:'awaiting score';
  });
}

/* ---- hero KPI cards (always-visible compact section) ---- */
const HERO_H=24;
const HERO_DEFS=[
  {key:'rmse',   label:'TL RMSE',    unit:'dB', dp:2, dir:'low', desc:'Full-field TL error',
   get:id=>scores[id]?.rmse,     ref:()=>0},
  {key:'core',   label:'Core RMSE',  unit:'dB', dp:2, dir:'low', desc:'Insonified-cell error',
   get:id=>scores[id]?.coreRmse, ref:()=>0},
  {key:'tlR',    label:'TL(R)',      unit:'dB', dp:1, dir:'nearest', desc:'Loss at receiver R',
   get:id=>metrics[id]?.tl_R,    ref:()=>metrics.reference?.tl_R??null},
  {key:'tlRerr', label:'TL(R) err',  unit:'dB', dp:1, dir:'low', desc:'Receiver TL error',
   get:id=>scores[id]?.tlRerr,   ref:()=>0},
  {key:'recip',  label:'Recip',      unit:'dB', dp:1, dir:'low', desc:'Reciprocity residual',
   get:id=>metrics[id]?.reciprocity, ref:()=>0},
  {key:'conv',   label:'Conv ΔTL(R)',unit:'dB', dp:1, dir:'low', desc:'Grid convergence',
   get:id=>metrics[id]?.conv_tlR, ref:()=>0},
  {key:'insonif',label:'Insonif%',   unit:'%',  dp:1, dir:'nearest', desc:'Volume coverage',
   get:id=>metrics[id]?.insonified!=null?metrics[id].insonified*100:null,
   ref:()=>metrics.reference?.insonified!=null?metrics.reference.insonified*100:null},
  {key:'oop',    label:'|Δy| 3D',    unit:'km', dp:1, dir:'nearest', desc:'Out-of-plane vs reference',
   get:id=>metrics[id]?.out_of_plane!=null?metrics[id].out_of_plane/1000:null,
   ref:()=>metrics.reference?.out_of_plane!=null?metrics.reference.out_of_plane/1000:null},
];
function renderHero(){
  const el=document.getElementById('hero-bars'); if(!el)return;
  let out='';
  for(const d of HERO_DEFS){
    const r=d.ref();
    const vals=MODELS.map(id=>({id,v:d.get(id)}));
    // leader among canonical panels only (matches the scorecard)
    let lid=null,lv=null;
    for(const {id,v} of vals){
      if(v==null||!isFinite(v)||scores[id]?.canonical===false)continue;
      if(lid===null){lid=id;lv=v;continue;}
      const better=d.dir==='nearest'?Math.abs(v-(r??0))<Math.abs(lv-(r??0)):d.dir==='high'?v>lv:v<lv;
      if(better){lid=id;lv=v;}
    }
    const lc=lid?MODEL_CLRS[lid]:'var(--text-faint)';
    // gap vs BELLHOP reference
    const gap=(lv!=null&&r!=null)?lv-r:null;
    const u=d.unit?`<small>${d.unit}</small>`:'';
    const valTxt=lv!=null?`${fmt(lv,d.dp)}${u}`:'—';
    const deltaChip=gap!=null
      ? `<span class="kpi-delta" title="vs BELLHOP ${fmt(r,d.dp)}${d.unit}">Δ${gap>=0?'+':''}${fmt(gap,d.dp)}</span>`
      : '';
    // mini bars: 5 models + BELLHOP reference ghost bar
    const nums=vals.map(x=>x.v).filter(v=>v!=null&&isFinite(v));
    const mx=Math.max(...nums,(r&&isFinite(r)?r:0),0);
    let bars='';
    for(const {id,v} of vals){
      const h=mx>0&&v!=null?Math.max(Math.round(v/mx*HERO_H),2):2;
      const c=MODEL_CLRS[id],on=id===lid;
      bars+=`<div class="kpi-bar" style="height:${h}px;background:${c};opacity:${on?1:.4}`+
            `${on?`;box-shadow:0 0 6px ${c}`:''}" title="${MODEL_SHORT[id]}: ${fmt(v,d.dp)}"></div>`;
    }
    const rh=mx>0&&r!=null?Math.max(Math.round(r/mx*HERO_H),2):2;
    bars+=`<div class="kpi-bar ref" style="height:${rh}px" title="BELLHOP: ${fmt(r,d.dp)}"></div>`;
    out+=`<div class="kpi" style="--lc:${lc}">`
      +`<div class="kpi-h"><span class="kpi-nm">${d.label}</span>`
      +`<i class="kpi-dir">${d.dir==='nearest'?'≈':d.dir==='high'?'↑':'↓'}</i></div>`
      +`<div class="kpi-mid"><div class="kpi-figs"><div class="kpi-val">${valTxt}</div>`
      +`<div class="kpi-sub"><span class="kpi-leader">${lid?MODEL_SHORT[lid]:'awaiting'}</span>${deltaChip}</div></div>`
      +`<div class="kpi-bars">${bars}</div></div>`
      +`<div class="kpi-foot">${d.desc}</div></div>`;
  }
  setHTML(el,out);
  const winId=currentLeader();
  const nm=document.getElementById('winner-name');
  const badge=document.getElementById('winner-badge');
  const sc=document.getElementById('winner-score');
  if(nm){
    nm.textContent=winId?PANELS.find(p=>p.id===winId).name:'—';
    if(winId){nm.style.color=MODEL_CLRS[winId];nm.style.textShadow=`0 0 14px ${MODEL_CLRS[winId]}88`;}
  }
  if(sc)sc.textContent=winId&&scores[winId]?.leaderScore!=null
    ? `${fmt(scores[winId].leaderScore,1)} point physics score`
    : 'awaiting canonical metrics';
  if(badge){
    badge.classList.toggle('has-winner',!!winId);
    if(winId){
      badge.style.borderColor=`${MODEL_CLRS[winId]}66`;
      badge.style.setProperty('--winner',MODEL_CLRS[winId]);
    }
  }
  updateCompareInfo();
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
function syncPlayUI(){
  const barBtn=document.getElementById('play');
  if(barBtn)barBtn.textContent=playing?'❚❚ Pause all':'▶ Play all';
}
document.getElementById('play').onclick=()=>{playing=!playing;syncPlayUI();broadcast({type:playing?'play':'pause'});};
document.getElementById('reset').onclick=()=>{playing=false;syncPlayUI();
  const s=document.getElementById('tl-seek');if(s)s.value=0;
  broadcast({type:'reset'});};
document.getElementById('camreset').onclick=()=>{lastPose={yaw:1.0,pitch:0.72,dist:3.3};
  broadcast({type:'set_camera',pose:lastPose});};
document.getElementById('canon').onclick=()=>setStop(41,31);
document.getElementById('volchk').onchange=e=>broadcast({type:'set_volume',on:e.target.checked});
document.getElementById('opac').oninput=e=>broadcast({type:'set_opacity',v:+e.target.value});
document.querySelectorAll('.tab-btn').forEach(btn=>{btn.onclick=()=>switchTab(btn.dataset.tab);});
document.querySelectorAll('.focus-overlay').forEach(ov=>{
  ov.onclick=()=>{
    const fid=ov.dataset.focus;
    if(MODELS.includes(fid)){setCompareModel(fid);switchTab('compare');}
    else switchTab(fid);
  };
});

/* ---- sidebar controls ---- */
document.getElementById('tl-speed').onchange=e=>broadcast({type:'set_speed',speed:+e.target.value});
document.getElementById('tl-seek').oninput=e=>broadcast({type:'set_time',t:+e.target.value/100});

/* ---- compare panel ---- */
document.getElementById('compare-model').onchange=e=>setCompareModel(e.target.value);
document.getElementById('delta-btn').onclick=e=>{
  const on=e.target.classList.toggle('on');
  diffOpen=on;
  document.getElementById('diff').classList.toggle('show',on);
  if(on)drawDiff();
};


document.getElementById('diffclose').onclick=()=>{diffOpen=false;
  document.getElementById('diff').classList.remove('show');
  document.getElementById('delta-btn').classList.remove('on');};
document.getElementById('diffmodel').onchange=drawDiff;

/* ---- mobile hamburger menu (collapses the toolbar in portrait) ---- */
(function(){
  const bar=document.getElementById('bar'), ham=document.getElementById('hamburger');
  if(!bar||!ham)return;
  const set=open=>{bar.classList.toggle('nav-open',open);ham.setAttribute('aria-expanded',open);};
  ham.onclick=()=>set(!bar.classList.contains('nav-open'));
  /* tapping a one-shot action closes the drawer; Fan/View stay open to interact */
  document.getElementById('bar-actions').addEventListener('click',e=>{
    if(e.target.closest('.tab-btn'))set(false);
  });
})();

/* ---- animated sonar favicon (canvas → link.href, ~2fps) — WP4: the sweep +
   PNG encode tick ONLY while the tab is visible (no always-on encode tax when
   backgrounded); a single static frame under prefers-reduced-motion ---- */
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
  frame();                                          // always paint the icon once
  if(matchMedia('(prefers-reduced-motion:reduce)').matches) return;   // static — no ticking
  let timer=null;
  const stop=()=>{ if(timer){clearInterval(timer);timer=null;} };
  const start=()=>{ if(!timer)timer=setInterval(frame,500); };
  const sync=()=>{ document.visibilityState==='visible'?start():stop(); };
  document.addEventListener('visibilitychange',sync);
  sync();                                           // begin only if the tab is currently visible
})();

/* ---- WP4: pause the decorative section-divider animation while its section is
   offscreen (scrolled away, or on a non-scorecard tab) — no always-on compositor
   tax. prefers-reduced-motion is already honored in CSS. ---- */
(function gateSectionAnims(){
  const divs=document.querySelectorAll('.sect-div');
  if(!divs.length||!('IntersectionObserver'in window))return;
  const io=new IntersectionObserver(es=>es.forEach(e=>
    e.target.classList.toggle('anim-off',!e.isIntersecting)),{threshold:0});
  divs.forEach(d=>{d.classList.add('anim-off');io.observe(d);});
})();

/* ---- boot ---- */
buildSelectors({elev:[11,21,41,61,81], azim:[9,16,31,46,61]});
setCompareModel('fugu');
loadCache();                 // WP1: paint the canonical scorecard instantly if we've scored it before
renderScore();
renderHero();
updatePosters();             // WP2: fill Quick View poster score lines from cache
mountForTab('overview');     // WP2: show one live panel + posters immediately (no 5-panel wall)
warmup();                    // WP1: sequential panel warm-up refreshes/collects the live scores
setTimeout(()=>broadcast({type:'request_metrics'}),1500);
setTimeout(()=>broadcast({type:'hide_controls'}),800);
