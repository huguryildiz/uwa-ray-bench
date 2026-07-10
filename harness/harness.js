"use strict";
/* ============================================================================
 HARNESS LOGIC (uwa-ray-bench)
 Aggregates each panel's postMessage({type:'ray_metrics',...}) card + canonical
 TL field (101x49x31 Float32 dB, x-fastest), scores every model vs BELLHOP3D:
   - TL RMSE (dB) + TL(R) error vs the reference grid
   - synchronized camera (set/get pose via postMessage)
   - synchronized beam-stop (snap-grid, postMessage)
   - per-cell diff overlay (model - BELLHOP3D), centerline slice
   - scorecard / ranking (validation gate + Field/Coverage/Geometry + Composite)
   - analytic cursor readout (depth, D(x,y), c(z)) from focused-panel world pos
 postMessage only; no network. Model iframes are opaque (never read).
============================================================================ */

const SCORING=globalThis.UwaRayScoring;
const NX=101, NY=49, NZ=31, TL_SHADOW=SCORING.TL_SHADOW, NTL=NX*NY*NZ;
const PANELS=[
  {id:'fugu',      name:'Sakana Fugu'},
  {id:'opus',      name:'Opus 4.8 (max)'},
  {id:'gpt',       name:'GPT 5.6 (Sol Ultra)'},
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
let scoreSort={key:'composite',dir:'desc'};
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
  if(name==='overview')    return []; // all panels closed (poster state) on the overview
  if(name==='compare')     return [curCompareModel,'reference'];  // exactly 2 live
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
   while keeping at most one model panel hot during warm-up. Reference goes
   first (its TL field is needed to score every model) and stays in memory. ---- */
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
    else if(m.convergenceTlDeltaDb!=null)    v=m.convergenceTlDeltaDb;     // GPT (5.5 XH top-level)
    else if(m.convergence?.tlRDeltaDb!=null) v=m.convergence.tlRDeltaDb;   // GPT (5.6 Sol Ultra object)
    else if(m.convergence?.tlDelta!=null)    v=m.convergence.tlDelta;      // GPT (5.6 Sol Ultra object, alias)
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
  // composite + headline fidelity columns first, then the retained diagnostic metrics
  const COLS=[
    {key:'composite', label:'Composite',  dir:'high',    get:id=>scores[id]?.composite?.value},
    {key:'field',     label:'Field',      dir:'high',    get:id=>scores[id]?.fieldFidelity},
    {key:'coverage',  label:'Coverage',   dir:'high',    get:id=>scores[id]?.coverageFidelity},
    {key:'rmse',      label:'TL RMSE',    dir:'low',     get:id=>scores[id]?.rmse},
    {key:'core',      label:'Core err',   dir:'low',     get:id=>scores[id]?.coreRmse},
    {key:'smooth',    label:'Smoothed err',dir:'low',    get:id=>scores[id]?.smoothedRmse},
    {key:'tlR',       label:'TL(R)',      dir:'nearest', ref:refTlR, get:id=>metrics[id]?.tl_R},
    {key:'tlRerr',    label:'TL(R) err',  dir:'low',     get:id=>scores[id]?.tlRerr},
    {key:'recip',     label:'recip',      dir:'low',     get:id=>metrics[id]?.reciprocity},
    {key:'conv',      label:'conv ΔTL(R)',dir:'low',     get:id=>metrics[id]?.conv_tlR},
    {key:'insonif',   label:'insonif%',   dir:'nearest', ref:refInson, get:id=>metrics[id]?.insonified!=null?metrics[id].insonified*100:null},
    {key:'bound',     label:'bound Δ',    dir:'low',     get:id=>scores[id]?.boundaryDistanceKm},
  ];
  // per-column winner detection — canonical models only; Validation status is informational and does not gate eligibility
  const winners={};
  for(const col of COLS){
    let wId=null,wV=null;
    for(const id of MODELS){
      if(!SCORING.eligible(id,scores))continue;
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
  rows.push(`<tr><th>panel</th>`+
    COLS.map(c=>{
      const active=scoreSort.key===c.key;
      const next=active&&scoreSort.dir==='asc'?'desc':'asc';
      const ind=active?(scoreSort.dir==='asc'?'▲':'▼'):'↕';
      return `<th${c.key==='composite'?' class="col-composite"':''} title="${TITLES[c.dir]} · click to sort ${next==='asc'?'ascending':'descending'}">`+
        `<button type="button" class="score-sort${active?' active':''}" data-score-sort="${c.key}" `+
        `aria-label="Sort ${c.label} ${next==='asc'?'ascending':'descending'}">${c.label}`+
        ` <span class="score-dir">${DI[c.dir]}</span><span class="score-ind">${ind}</span></button></th>`;
    }).join('')+`</tr>`);
  function wcell(key,id,content){
    if(winners[key]!==id)return`<td${key==='composite'?' class="col-composite"':''}>${content}</td>`;
    const clr=MODEL_CLRS[id];
    return`<td style="color:${clr};text-shadow:0 0 10px ${clr}55;background:${clr}1a;border-radius:5px;font-weight:600">${content}</td>`;
  }
  function cellHTML(col,id){
    const s=scores[id], m=metrics[id];
    switch(col.key){
      case'field':return s&&s.fieldFidelity!=null?fmt(s.fieldFidelity,1):'—';
      case'coverage':return s&&s.coverageFidelity!=null?fmt(s.coverageFidelity,1):'—';
      case'composite':return s&&s.composite&&s.composite.value!=null
        ?fmt(s.composite.value,1)+(s.composite.provisional?' *':''):'—';
      case'rmse':return s?fmt(s.rmse):'—';
      case'core':return s?fmt(s.coreRmse):'—';
      case'smooth':return s&&s.smoothedRmse!=null?fmt(s.smoothedRmse):'—';
      case'tlR':return fmt(m&&m.tl_R,1);
      case'tlRerr':return s&&s.tlRerr!=null?fmt(s.tlRerr,1):'—';
      case'recip':return m&&m.reciprocity!=null?fmt(m.reciprocity,1):'—';
      case'conv':return m&&m.conv_tlR!=null?fmt(m.conv_tlR,1):'—';
      case'insonif':return m&&m.insonified!=null?fmt(m.insonified*100,1):'—';
      case'bound':return s&&s.boundaryDistanceKm!=null?fmt(s.boundaryDistanceKm,2)+'km':'—';
      default:return'—';
    }
  }
  const rowDefs=PANELS.map((p,i)=>({
    p, i,
    fixed:p.id==='reference',
    values:Object.fromEntries(COLS.map(c=>[c.key,c.get(p.id)])),
  }));
  const ordered=scoreSort.key?SCORING.sortScorecardRows(rowDefs,scoreSort.key,scoreSort.dir):rowDefs;
  const leaderId=SCORING.compositeLeader(MODELS,scores);
  ordered.forEach(({p})=>{
    const m=metrics[p.id],s=scores[p.id];
    if(p.id==='reference'){
      if(!m){rows.push(`<tr class="refrow"><td>${p.name} (ref)</td><td colspan="${COLS.length}" style="text-align:left;color:#65809f">loading…</td></tr>`);return;}
      rows.push(`<tr class="refrow"><td>${p.name} (ref)</td>`+
        `<td class="col-composite">100.0</td>`+
        `<td>100.0</td><td>100.0</td>`+
        `<td>0.00</td><td>0.00</td><td>0.00</td>`+
        `<td>${fmt(m.tl_R,1)}</td><td>0.00</td>`+
        `<td>0.00</td><td>0.00</td>`+
        `<td>${m.insonified!=null?fmt(m.insonified*100,1):'—'}</td>`+
        `<td>0.00km</td></tr>`);
      return;
    }
    if(!m){rows.push(`<tr><td>${p.name}</td><td colspan="${COLS.length}" style="text-align:left;color:#65809f">no panel / no metrics yet</td></tr>`);return;}
    rows.push(`<tr${p.id===leaderId?' class="leader"':''}><td>${p.name}${m.canonical===false?' <span class="pill-off">OFF-CANON</span>':''}</td>`+
      COLS.map(c=>wcell(c.key,p.id,cellHTML(c,p.id))).join('')+
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
  const refTlR=metrics.reference?.tl_R??null;
  const refInson=metrics.reference?.insonified!=null?metrics.reference.insonified*100:null;
  const defs=[
    {label:'Field',      unit:'',  dp:1, dir:'high',    get:id=>scores[id]?.fieldFidelity},
    {label:'Coverage',   unit:'',  dp:1, dir:'high',    get:id=>scores[id]?.coverageFidelity},
    {label:'Composite',  unit:'',  dp:1, dir:'high',    get:id=>scores[id]?.composite?.value},
    {label:'TL RMSE',    unit:'dB', dp:2, dir:'low',    get:id=>scores[id]?.rmse},
    {label:'Core err',   unit:'dB', dp:2, dir:'low',    get:id=>scores[id]?.coreRmse},
    {label:'Smoothed err',unit:'dB',dp:2, dir:'low',    get:id=>scores[id]?.smoothedRmse},
    {label:'TL(R) err',  unit:'dB', dp:1, dir:'low',    get:id=>scores[id]?.tlRerr},
    {label:'TL(R)',      unit:'dB', dp:1, dir:'nearest', ref:refTlR, get:id=>metrics[id]?.tl_R},
    {label:'Recip',      unit:'dB', dp:1, dir:'low',    get:id=>metrics[id]?.reciprocity},
    {label:'Conv ΔTL(R)',unit:'dB', dp:1, dir:'low',    get:id=>metrics[id]?.conv_tlR},
    {label:'Insonif%',   unit:'%',  dp:1, dir:'nearest', ref:refInson, get:id=>metrics[id]?.insonified!=null?metrics[id].insonified*100:null},
    {label:'Boundary Δ', unit:'km', dp:2, dir:'low',    get:id=>scores[id]?.boundaryDistanceKm},
  ];
  let out='';
  for(const d of defs){
    let vals=MODELS.map(id=>({id,v:d.get(id)}));
    vals.sort((a,b)=>{
      const af=a.v!=null&&isFinite(a.v), bf=b.v!=null&&isFinite(b.v);
      if(af!==bf)return af?-1:1;
      if(!af)return 0;
      const ar=d.dir==='nearest'?Math.abs(a.v-(d.ref??0)):a.v;
      const br=d.dir==='nearest'?Math.abs(b.v-(d.ref??0)):b.v;
      return d.dir==='high'?br-ar:ar-br;
    });
    const nums=vals.map(x=>x.v).filter(v=>v!=null&&isFinite(v));
    const hasRef=d.dir==='nearest'&&d.ref!=null&&isFinite(d.ref);
    const mx=Math.max(nums.length?Math.max(...nums):0, hasRef?d.ref:0);
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
    /* 'nearest'-sorted cards (Insonif%, TL(R)) rank by distance to the BELLHOP3D
       reference, not raw value, so bar heights aren't monotonic left-to-right —
       draw the reference itself as a dashed line so that ordering reads as intentional. */
    const refLine=hasRef&&mx>0?
      `<div class="bc-refline" style="bottom:${Math.max(0,Math.min(CH,Math.round(d.ref/mx*CH)))}px">`+
      `<span class="bc-refline-lbl">ref ${d.ref.toFixed(d.dp)}${d.unit}</span></div>`:'';
    const xlbls=vals.map(({id})=>`<span class="bc-xl">${MODEL_SHORT[id]}</span>`).join('');
    out+=`<div class="bc-g"><div class="bc-hd">${d.label}${unitSpan}</div>`+
      `<div class="bc-chart">${refLine}${cols}</div>`+
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
  document.getElementById('elevsel').value=ELEV_STOPS.indexOf(+elev);
  document.getElementById('azimsel').value=AZIM_STOPS.indexOf(+azim);
  const ev=document.getElementById('elevsel-val');if(ev)ev.textContent=elev;
  const av=document.getElementById('azimsel-val');if(av)av.textContent=azim;
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

/* ---- leader = highest Composite Benchmark Score among canonical models
   (Validation status is informational, not a ranking gate — see scoring.js
   eligible()); deterministic tie-break: core TL error, then coverage error,
   then receiver error, then lexical id — see scoring.js compareForTiebreak. ---- */
function currentLeader(){
  return SCORING.compositeLeader(MODELS,scores);
}
/* WP2: fill each Quick View poster's cached-score line (harness chrome only —
   the poster never mounts the model panel). */
function updatePosters(){
  MODELS.forEach(id=>{
    const el=document.querySelector(`.cell[data-id="${id}"] .poster-stat`);
    if(!el)return;
    const s=scores[id];
    const c=s&&s.composite&&s.composite.value;
    el.textContent=(c!=null&&isFinite(c))?`composite ${c.toFixed(1)} pts`:'awaiting score';
  });
}

/* ---- hero KPI cards (always-visible compact section) ---- */
const HERO_H=24;
const HERO_DEFS=[
  {key:'field',   label:'Field',      unit:'', dp:1, dir:'high', desc:'TL field fidelity vs BELLHOP3D',
   get:id=>scores[id]?.fieldFidelity, ref:()=>100},
  {key:'coverage',label:'Coverage',   unit:'', dp:1, dir:'high', desc:'Shadow-mask fidelity vs BELLHOP3D',
   get:id=>scores[id]?.coverageFidelity, ref:()=>100},
  {key:'boundary',label:'Boundary Δ', unit:'km', dp:2, dir:'low', desc:'Shadow-boundary position error vs BELLHOP3D',
   get:id=>scores[id]?.boundaryDistanceKm, ref:()=>0},
  {key:'composite',label:'Composite', unit:'', dp:1, dir:'high', desc:'Composite benchmark score (provisional)',
   get:id=>scores[id]?.composite?.value, ref:()=>100},
  {key:'core',   label:'Core err',   unit:'dB', dp:2, dir:'low', desc:'Robust insonified-cell error',
   get:id=>scores[id]?.coreRmse, ref:()=>0},
  {key:'rmse',   label:'TL RMSE',    unit:'dB', dp:2, dir:'low', desc:'Full-field TL error vs BELLHOP3D',
   get:id=>scores[id]?.rmse, ref:()=>0},
  {key:'smooth', label:'Smoothed err',unit:'dB', dp:2, dir:'low', desc:'3×3×3-smoothed TL field error',
   get:id=>scores[id]?.smoothedRmse, ref:()=>0},
  {key:'tlRerr', label:'TL(R) err',  unit:'dB', dp:1, dir:'low', desc:'Loss error at receiver R',
   get:id=>scores[id]?.tlRerr, ref:()=>0},
];
function renderHero(){
  const el=document.getElementById('hero-bars'); if(!el)return;
  // allReported: every panel has a score object (data attempted). NOT the same as
  // having a real result — when the reference reports, recompute() scoreModel()s all
  // MODELS at once, so every panel gets a truthy-but-empty (composite:null) object
  // before any model has streamed its live TL field.
  const allReported=MODELS.every(id=>!!scores[id]);
  // allScored: every panel has a FINITE composite — i.e. genuinely scored. Gate the
  // winner banner on this, not allReported, or the first model to report live (fugu,
  // first in warm-up order) briefly wins the whole field while the others sit at
  // composite:null, flashing the wrong leader before the real one overtakes it.
  const allScored=MODELS.every(id=>{const c=scores[id]&&scores[id].composite;
    return c&&c.value!=null&&isFinite(c.value);});
  let out='';
  for(const d of HERO_DEFS){
    const r=d.ref();
    const vals=MODELS.map(id=>({id,v:d.get(id)}));
    // leader among canonical panels only (matches the scorecard; Validation is informational)
    let lid=null,lv=null;
    for(const {id,v} of vals){
      if(v==null||!isFinite(v)||!SCORING.eligible(id,scores))continue;
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
      +`<div class="kpi-sub"><span class="kpi-leader">${lid?MODEL_SHORT[lid]:(allReported?'off-canonical':'awaiting')}</span>${deltaChip}</div></div>`
      +`<div class="kpi-bars">${bars}</div></div>`
      +`<div class="kpi-foot">${d.desc}</div></div>`;
  }
  setHTML(el,out);
  // only reveal a winner once every canonical model has reported — otherwise the
  // leader among a partial field (e.g. just the first panel to report) flashes
  // briefly before the real winner overtakes it as the rest stream in.
  const winId=allScored?currentLeader():null;
  const nm=document.getElementById('winner-name');
  const badge=document.getElementById('winner-badge');
  const sc=document.getElementById('winner-score');
  if(nm){
    nm.textContent=winId?PANELS.find(p=>p.id===winId).name:'—';
    if(winId){nm.style.color=MODEL_CLRS[winId];nm.style.textShadow=`0 0 14px ${MODEL_CLRS[winId]}88`;}
  }
  const winComposite=winId&&scores[winId]&&scores[winId].composite;
  if(sc)sc.textContent=winComposite&&winComposite.value!=null
    ? `${fmt(winComposite.value,1)} pt Composite Benchmark Score${winComposite.provisional?' (provisional)':''}`
    : (allReported?'all panels off-canonical — reset to canonical 41×31':'awaiting canonical metrics');
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
let ELEV_STOPS=[], AZIM_STOPS=[];
function buildSelectors(stops){
  ELEV_STOPS=stops.elev; AZIM_STOPS=stops.azim;
  const es=document.getElementById('elevsel'), as=document.getElementById('azimsel');
  es.max=ELEV_STOPS.length-1; as.max=AZIM_STOPS.length-1;
  es.value=ELEV_STOPS.indexOf(41); as.value=AZIM_STOPS.indexOf(31);
  es.oninput=()=>setStop(ELEV_STOPS[+es.value],curStop.azim);
  as.oninput=()=>setStop(curStop.elev,AZIM_STOPS[+as.value]);
  MODELS.forEach(id=>document.getElementById('diffmodel').add(new Option(PANELS.find(p=>p.id===id).name,id)));
}
function syncPlayUI(){
  const barBtn=document.getElementById('play');
  if(barBtn)barBtn.textContent=playing?'❚❚ Pause all':'▶ Play all';
}
/* ---- playback-completion tracking: all panels share a 14 s playback at 1×
   (the reference runs to 17.5 s); when the active run finishes we flip the
   button back to "▶ Play all" so a single click replays from the top. ---- */
const MODEL_DUR=14, REF_DUR=17.5;
let playTimer=null, animElapsed=0, playAnchor=0, playSpeed=1, playDone=false;
function activeDur(){const a=activeSetFor(curTab); return a.length?(a.includes('reference')?REF_DUR:MODEL_DUR):0;}
function curSpeed(){const el=document.getElementById('tl-speed'); return el?SPEED_STEPS[+el.value]:1;}
function clearPlayTimer(){ if(playTimer){clearTimeout(playTimer); playTimer=null;} }
function pausePlayClock(){ if(playAnchor){animElapsed+=(performance.now()-playAnchor)/1000*playSpeed; playAnchor=0;} clearPlayTimer(); }
function resetPlayClock(){ clearPlayTimer(); animElapsed=0; playAnchor=0; playDone=false; }
function schedulePlayEnd(){ clearPlayTimer(); const dur=activeDur(); if(!playing||dur<=0)return;
  playSpeed=curSpeed(); playAnchor=performance.now();
  playTimer=setTimeout(()=>{ playing=false; playDone=true; animElapsed=0; playAnchor=0; syncPlayUI(); },
    Math.max(0,(dur-animElapsed)/playSpeed*1000)); }
document.getElementById('play').onclick=()=>{
  if(!playing){                                   // starting playback
    if(playDone){broadcast({type:'reset'}); resetPlayClock();}   // finished → replay from t=0
    playing=true; syncPlayUI(); broadcast({type:'play'}); schedulePlayEnd();
  }else{                                          // pausing
    playing=false; pausePlayClock(); syncPlayUI(); broadcast({type:'pause'});
  }
};
document.getElementById('reset').onclick=()=>{playing=false;resetPlayClock();syncPlayUI();
  const s=document.getElementById('tl-seek');if(s)s.value=0;
  const t=document.getElementById('tl-time');if(t)t.textContent='0%';
  broadcast({type:'reset'});};
document.getElementById('camreset').onclick=()=>{lastPose={yaw:1.0,pitch:0.72,dist:3.3};
  broadcast({type:'set_camera',pose:lastPose});};
document.getElementById('canon').onclick=()=>setStop(41,31);
document.getElementById('volchk').onchange=e=>broadcast({type:'set_volume',on:e.target.checked});
document.getElementById('opac').oninput=e=>{broadcast({type:'set_opacity',v:+e.target.value});
  const o=document.getElementById('opac-val');if(o)o.textContent=`${Math.round(+e.target.value*100)}%`;};
document.querySelectorAll('.tab-btn').forEach(btn=>{btn.onclick=()=>switchTab(btn.dataset.tab);});
document.getElementById('scoretbl').addEventListener('click',e=>{
  const btn=e.target.closest('button[data-score-sort]');
  if(!btn)return;
  const key=btn.dataset.scoreSort;
  scoreSort={
    key,
    dir:scoreSort.key===key&&scoreSort.dir==='asc'?'desc':'asc',
  };
  renderScore();
});
document.querySelectorAll('.focus-overlay').forEach(ov=>{
  ov.onclick=()=>{
    const fid=ov.dataset.focus;
    if(MODELS.includes(fid)){setCompareModel(fid);switchTab('compare');}
    else switchTab(fid);
  };
});

/* ---- sidebar controls ---- */
const SPEED_STEPS=[0.25,0.5,1,2,4];
document.getElementById('tl-speed').oninput=e=>{const speed=SPEED_STEPS[+e.target.value];
  broadcast({type:'set_speed',speed});
  const v=document.getElementById('tl-speed-val');if(v)v.textContent=`${speed}×`;
  if(playing){pausePlayClock();schedulePlayEnd();}};   // rescale remaining time to new speed
document.getElementById('tl-seek').oninput=e=>{broadcast({type:'set_time',t:+e.target.value/100});
  const t=document.getElementById('tl-time');if(t)t.textContent=`${e.target.value}%`;
  playing=false;clearPlayTimer();playAnchor=0;playDone=false;   // set_time pauses the panels
  animElapsed=activeDur()*(+e.target.value/100);syncPlayUI();};

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
