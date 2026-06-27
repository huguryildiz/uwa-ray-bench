# Harness 7-Tab UI Redesign

Rewrite `harness/index.html` and surgically edit `harness/harness.js` to implement a 7-tab navigation layout that replaces the current fixed 2×2 + bottom-row layout.

---

## Context

- Vanilla JS + raw WebGL only. No framework, no CDN, no build step.
- CommSysLab design tokens already in `:root` — never hard-code hex/blur values.
- All 5 iframes (`fugu`, `opus`, `gpt`, `gemini`, `reference`) **must stay in DOM at all times** — removing them resets JS state and breaks `postMessage` flow.
- CRITICAL: Never read, edit, or open model panel files (`models/*/ray_view.html`). They are opaque iframe outputs only.
- Script tag: bump `?v=5` → `?v=6` on `harness.js` import.

---

## Layout Constants

Total fixed chrome = **132px**: `#bar` 56px + `#tabs-bar` 44px + `#foot` 32px.  
Grid height: `calc(100vh - 132px)`.

---

## 1. `harness/index.html` — Structural Changes

### `<body>` tag
```html
<body class="tab-overview">
```

### Add `#tabs-bar` after `#bar`, before `#grid`
```html
<nav id="tabs-bar">
  <button class="tab-btn act" data-tab="overview">Overview</button>
  <button class="tab-btn" data-tab="fugu">Fugu</button>
  <button class="tab-btn" data-tab="opus">Opus</button>
  <button class="tab-btn" data-tab="gpt">GPT</button>
  <button class="tab-btn" data-tab="gemini">Gemini</button>
  <button class="tab-btn" data-tab="reference">Reference</button>
  <button class="tab-btn" data-tab="scorecard">Scorecard</button>
</nav>
```

### `#grid` — 5 cells total (add reference cell; remove `#bottom-row`)
Each model cell needs a `.focus-overlay` div. Reference cell has none.
```html
<div id="grid">
  <div class="cell" data-id="fugu">
    <div class="focus-overlay" data-focus="fugu"></div>
    <iframe data-id="fugu" src="../models/fugu/ray_view.html" ...></iframe>
  </div>
  <div class="cell" data-id="opus">
    <div class="focus-overlay" data-focus="opus"></div>
    <iframe data-id="opus" src="../models/opus/ray_view.html" ...></iframe>
  </div>
  <div class="cell" data-id="gpt">
    <div class="focus-overlay" data-focus="gpt"></div>
    <iframe data-id="gpt" src="../models/gpt/ray_view.html" ...></iframe>
  </div>
  <div class="cell" data-id="gemini">
    <div class="focus-overlay" data-focus="gemini"></div>
    <iframe data-id="gemini" src="../models/gemini/ray_view.html" ...></iframe>
  </div>
  <div class="cell" data-id="reference">
    <iframe data-id="reference" src="../reference/ray_view_reference.html" ...></iframe>
  </div>
</div>
```

### Wrap scorecard content in `#scorecard-tab`
Remove `<div id="bottom-row">` entirely. Wrap `#score`, `#bars-panel`, `.sect-div`, `#glossary`, `#physics` in:
```html
<div id="scorecard-tab">
  <!-- #score, #bars-panel, .sect-div, #glossary, #physics go here -->
</div>
```
- Remove `class="show"` from `#glossary` (was hardcoded).
- Change `<button class="lnk act" id="scorebtn">` → remove `act` class.

---

## 2. New CSS to Add

```css
/* Tabs bar */
#tabs-bar{flex:none;height:44px;display:flex;align-items:center;gap:2px;
  padding:0 10px;background:rgba(4,6,20,.30);
  backdrop-filter:var(--blur-sm);-webkit-backdrop-filter:var(--blur-sm);
  border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none}
#tabs-bar::-webkit-scrollbar{display:none}
.tab-btn{appearance:none;background:none;border:0;cursor:pointer;
  color:var(--text-dim);font:600 12px var(--font);letter-spacing:.03em;
  padding:7px 14px;border-radius:var(--radius-sm);white-space:nowrap;
  transition:var(--tr);flex:none}
.tab-btn:hover{color:var(--text);background:rgba(255,255,255,.07)}
.tab-btn.act{color:var(--accent);background:rgba(57,255,133,.08);
  text-shadow:0 0 12px rgba(57,255,133,.40)}

/* Grid — replaces old 63vh + bottom-row layout */
#grid{flex:none;height:calc(100vh - 132px);min-height:320px;display:grid;
  position:relative;background:rgba(255,255,255,.04);margin:0 12px;
  border-radius:var(--radius);overflow:hidden;
  border:1px solid var(--border);box-shadow:var(--lift)}

/* Overview: 2x2, reference parked */
body.tab-overview #grid{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:3px}

/* Individual model/reference tabs: full single cell */
body.tab-fugu #grid,body.tab-opus #grid,body.tab-gpt #grid,
body.tab-gemini #grid,body.tab-reference #grid{
  grid-template-columns:1fr;grid-template-rows:1fr}

/* Scorecard: collapse grid, iframes still run */
body.tab-scorecard #grid{height:0;min-height:0;margin:0;border:0;box-shadow:none;overflow:hidden}

/* Cell parking — removes non-active cells from grid flow, keeps iframes alive */
body.tab-overview .cell[data-id="reference"],
body.tab-fugu .cell:not([data-id="fugu"]),
body.tab-opus .cell:not([data-id="opus"]),
body.tab-gpt .cell:not([data-id="gpt"]),
body.tab-gemini .cell:not([data-id="gemini"]),
body.tab-reference .cell:not([data-id="reference"]),
body.tab-scorecard .cell{
  position:absolute;top:0;left:-9999px;width:1px;height:1px;overflow:hidden;box-shadow:none}

/* Overview iframe scale: zoom to 3D canvas area only */
body.tab-overview .cell iframe{transform:scale(1.35);transform-origin:50% 8%}

/* Focus overlays — clickable in overview, hidden in other tabs */
.focus-overlay{position:absolute;inset:0;z-index:8;cursor:zoom-in;display:none;
  transition:background var(--tr)}
body.tab-overview .focus-overlay{display:block}
.focus-overlay:hover{background:rgba(57,255,133,.07)}

/* Scorecard tab wrapper */
#scorecard-tab{display:none}
body.tab-scorecard #scorecard-tab{display:contents}

/* Score/glossary/physics always block — wrapper controls visibility */
#score,#glossary,#physics{display:block}
```

### Remove from CSS
- All `#bottom-row` rules
- `#bottom-row #score` override and its scrollbar rules
- `#score.show`, `#glossary.show`, `#physics.show` rules
- `display:none` from `#score,#glossary,#physics` base rule

### Mobile CSS (`@media (max-width:680px)`)
- `#tabs-bar` scrolls horizontally already via `overflow-x:auto` — no change needed
- Grid: use `height:calc(100svh - 132px)`
- Remove any `#bottom-row` mobile rules

---

## 3. `harness/harness.js` — Surgical Edits

### After line 33 (`let focusId=null, curStop=...`), add:
```javascript
let curTab='overview';
```

### After the `broadcastExcept` function, add `switchTab`:
```javascript
function switchTab(name){
  curTab=name;
  document.body.className='tab-'+name;
  document.querySelectorAll('.tab-btn').forEach(b=>
    b.classList.toggle('act',b.dataset.tab===name));
  const active=name==='overview'?[...MODELS]:
    MODELS.includes(name)?[name]:name==='reference'?['reference']:[];
  PANELS.forEach(p=>{
    if(active.includes(p.id)){if(playing)send(p.id,{type:'play'});}
    else send(p.id,{type:'pause'});
  });
}
```

### Replace `scorebtn` and `physicsbtn` handlers with:
```javascript
document.querySelectorAll('.tab-btn').forEach(btn=>{btn.onclick=()=>switchTab(btn.dataset.tab);});
document.querySelectorAll('.focus-overlay').forEach(ov=>{ov.onclick=()=>switchTab(ov.dataset.focus);});
document.getElementById('scorebtn').onclick=()=>switchTab('scorecard');
document.getElementById('physicsbtn').onclick=()=>switchTab('scorecard');
```

### Remove from boot sequence:
```javascript
document.getElementById('score').classList.add('show');  // DELETE this line
```

---

## 4. Verify

- All 5 iframes present in DOM after load (check DevTools).
- Clicking Overview cells zooms to that model's individual tab.
- Scorecard tab shows all score/glossary/physics content; grid is gone.
- Non-visible panels receive `{type:'pause'}` on tab switch.
- No horizontal scrollbar on any tab (parked cells clipped by grid `overflow:hidden`).
- Mobile: tabs-bar scrolls horizontally; grid fills viewport.
