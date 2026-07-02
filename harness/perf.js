"use strict";
/* ============================================================================
 WP0 — dev-only performance overlay (uwa-ray-bench). Opt-in via ?perf=1.
 Reproduces the audit's parent-side probes so every later WP can be measured:
   FPS      — parent-page rAF throughput
   heap     — used JS heap (Chromium performance.memory; "n/a" elsewhere)
   msg/s    — incoming postMessage rate to the harness (ray_metrics etc.)
   live     — model/reference iframes currently mounted (src set, not blank)
 Parent-side only — never injects into or reads the opaque model panels.
============================================================================ */
(function(){
  if(window.__uwarbPerf) return; window.__uwarbPerf=true;

  const box=document.createElement('div');
  box.id='perf-overlay';
  box.style.cssText=
    'position:fixed;top:64px;right:12px;z-index:9999;'+
    'font:600 11px/1.55 "IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;'+
    'color:#eaeefc;background:rgba(6,8,24,.82);border:1px solid rgba(255,255,255,.16);'+
    'border-radius:10px;padding:9px 13px;white-space:pre;pointer-events:none;'+
    'backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);'+
    'box-shadow:0 8px 28px rgba(0,0,0,.5);min-width:150px;letter-spacing:.02em';
  const mount=()=>{ if(document.body&&!box.parentNode) document.body.appendChild(box); };
  if(document.body) mount(); else addEventListener('DOMContentLoaded',mount);

  /* FPS — count rendered frames over ~0.5 s windows */
  let frames=0, fpsMark=performance.now(), fps=0;
  (function loop(t){ frames++; const dt=t-fpsMark;
    if(dt>=500){ fps=Math.round(frames*1000/dt); frames=0; fpsMark=t; }
    requestAnimationFrame(loop); })(fpsMark);

  /* postMessage rate — capture-phase listener so it can't be stopped upstream */
  let msgs=0, msgMark=performance.now(), msgRate=0;
  addEventListener('message',()=>{ msgs++; }, true);

  function heapMB(){
    const m=performance.memory;
    return m ? (m.usedJSHeapSize/1048576).toFixed(0)+' MB' : 'n/a';
  }
  function livePanels(){
    let n=0;
    document.querySelectorAll('iframe[data-id]').forEach(f=>{
      const s=f.getAttribute('src'); if(s && s!=='about:blank') n++;
    });
    return n;
  }
  function pad(v){ return String(v).padEnd(6); }

  function tick(){
    const now=performance.now(), dt=now-msgMark;
    msgRate=Math.round(msgs*1000/dt); msgs=0; msgMark=now;
    mount();
    box.textContent=
      '⚡ PERF  ?perf=1\n'+
      'FPS   '+pad(fps)+'\n'+
      'heap  '+pad(heapMB())+'\n'+
      'msg/s '+pad(msgRate)+'\n'+
      'live  '+livePanels()+' panel(s)';
  }
  setInterval(tick,1000); tick();
})();
