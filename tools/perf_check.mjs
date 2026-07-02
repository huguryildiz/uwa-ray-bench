#!/usr/bin/env node
/* ============================================================================
 WP5 — Performance regression harness (uwa-ray-bench)

 Turns the audit's §7 acceptance table into an executable, reproducible check.
 Drives a REAL headless Chrome over the DevTools Protocol using only Node 24
 built-ins (global WebSocket + fetch + http + child_process) — no Puppeteer,
 no npm install, no build step, matching this repo's zero-dependency rule.

 Model panels (models/<id>/ray_view.html) are never opened or read. Every probe
 is parent-side only — the same black-box measurements the audit used:
   • parent-page FPS            (rAF throughput)
   • live iframe / WebGL count  (§7 proxy: "count mounted iframes")
   • JS heap peak + sawtooth    (performance.memory, precise-memory-info)
   • gross allocation rate      (sum of positive heap deltas / s, GC-robust)
   • postMessage traffic        (capture-phase message counter)
   • mount behavior             (Quick View = 1 live, Compare = 2 live, ≤2 ever)
   • canonical score equivalence(sessionStorage uwarb_scores_41x31 vs baseline)

 It FAILS (exit 1) with a clear per-check report when any agreed threshold
 regresses. The architectural gates (live≤2, overview==1, compare==2, scores
 unchanged, msg-rate low) are hardware-independent — they go RED on the
 pre-WP2 all-mounted build and GREEN on the current one. The hardware-sensitive
 gates (FPS floor, heap ceiling, alloc ceiling) are set as generous CEILINGS
 with env overrides, per WP5's own risk note ("assert ratios/ceilings, not
 exact FPS") — headless SwiftShader is far slower/heavier than bare-metal, so
 these are regression tripwires, not the §7 bare-metal targets.

 Default = a REAL, on-GPU Chrome window (NOT --headless). The reference panel's
 WP3 decode/render is compositor-gated and never delivers its TL field under
 --headless=new (verified), so the scientific score check needs a GPU run; and
 FPS/heap are only §7-comparable on a real renderer, not SwiftShader.

 USAGE
   node tools/perf_check.mjs                 # local static server + full check (real GPU)
   node tools/perf_check.mjs --url <URL>     # check a deployed URL (e.g. Vercel)
   node tools/perf_check.mjs --update-baseline   # capture canonical scores as golden
   node tools/perf_check.mjs --strict        # promote FPS/heap/alloc to hard exit gates
   node tools/perf_check.mjs --headless      # CI smoke run (SwiftShader; score check downgraded to advisory)
   node tools/perf_check.mjs --keep-open     # leave the browser up after the run
   node tools/perf_check.mjs --help

 HARD gates (fail the run, exit 1 — reproducible & architectural): canonical
 scores == baseline, Quick View == 1 live, Compare == 2 live, live ≤ MOUNT_CAP,
 postMessage rate. ADVISORY by default (measured + WARN, promote with --strict):
 parent FPS, heap peak, gross alloc — Quick View heap is dominated by the opaque
 model panel's own GC churn, so absolute MB is noisy run-to-run.

 ENV OVERRIDES (adjust for your hardware / CI)
   CHROME_PATH           explicit Chrome/Chromium binary
   PERF_FPS_MIN          parent FPS floor (default 50 GPU / 15 headless)
   PERF_HEAP_MAX_MB      heap peak ceiling MB (default 700 GPU / 1600 headless)
   PERF_ALLOC_MAX_MB     idle gross-alloc ceiling MB/s (default 40 GPU / 120 headless)
   PERF_MSG_MAX          idle postMessage rate ceiling /s (default 8)
   PERF_SCORE_TOL        canonical coreRMSE tolerance dB (default 0.05)
   PERF_WARMUP_MS        max wait for scores to populate (default 90000)
============================================================================ */
"use strict";

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, "perf_baseline.json");

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/* ---- args ------------------------------------------------------------------ */
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) { printHelp(); process.exit(0); }
const opt = {
  url:        argVal("--url"),
  headless:   args.includes("--headless"),   // opt-in; default is a real (GPU) Chrome — see below
  strict:     args.includes("--strict") || process.env.PERF_STRICT === "1",
  updateBase: args.includes("--update-baseline"),
  keepOpen:   args.includes("--keep-open"),
};
function argVal(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }

/* ---- config: agreed thresholds (env-overridable) ---------------------------
 Default runs a REAL, on-GPU Chrome (not --headless). That matters for two
 reasons the audit's numbers depend on:
   • The reference panel's WP3 decode/render path is compositor-gated
     (IntersectionObserver + visibility); under --headless=new it silently
     never delivers its TL field, so no model can be scored. A real window
     posts it — verified. So the scientific score check REQUIRES a GPU run.
   • FPS/heap only mean anything on the same class of renderer as §7's
     bare-metal targets. --headless forces SwiftShader (software WebGL),
     which is far slower/heavier — its numbers are not comparable.
 Hence two threshold profiles; --headless relaxes the GPU-bound ceilings and
 downgrades the reference-dependent score check to an advisory warning (so a
 CI smoke run still exercises mount/lifecycle without false failures). ------- */
const CFG = {
  liveMax:        2,                                     // MOUNT_CAP — architectural, hard, mode-independent
  overviewLive:   1,                                     // Quick View strict 1 live
  compareLive:    2,                                     // Compare strict 2 live
  msgRateMax:     num(process.env.PERF_MSG_MAX, 8),      // idle postMessage rate ceiling /s
  scoreTolDB:     num(process.env.PERF_SCORE_TOL, 0.05), // canonical coreRMSE tolerance (dB)
  warmupMs:       num(process.env.PERF_WARMUP_MS, 90000),// max wait for scores
  sampleMs:       4000,                                  // idle sampling window
  // GPU-bound ceilings — profile by mode, still env-overridable.
  fpsMin:         num(process.env.PERF_FPS_MIN,     opt.headless ? 15  : 50),
  heapPeakMaxMB:  num(process.env.PERF_HEAP_MAX_MB, opt.headless ? 1600 : 700),
  allocRateMaxMB: num(process.env.PERF_ALLOC_MAX_MB, opt.headless ? 120 : 40),
};

/* ============================================================================
 Static file server — mirrors vercel.json's "/" -> "/harness/index.html"
 rewrite so a local run exercises the same path prod does (and would catch a
 WP0-class broken script URL). Serves the repo root read-only.
============================================================================ */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".bin": "application/octet-stream",
  ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};
function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent(req.url.split("?")[0]);
        if (urlPath === "/") urlPath = "/harness/index.html";           // the vercel rewrite
        const abs = path.join(REPO_ROOT, path.normalize(urlPath));
        if (!abs.startsWith(REPO_ROOT)) { res.writeHead(403).end(); return; }
        const buf = await fsp.readFile(abs);
        res.writeHead(200, { "content-type": MIME[path.extname(abs)] || "application/octet-stream" });
        res.end(buf);
      } catch { res.writeHead(404).end("404"); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/* ============================================================================
 Minimal CDP client — flat-session protocol over the built-in WebSocket.
============================================================================ */
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function chromeBinary() {
  const cands = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  throw new Error("Chrome not found. Set CHROME_PATH to your Chrome/Chromium binary.");
}
async function launchChrome() {
  const bin = chromeBinary();
  const port = await freePort();
  const userDir = await fsp.mkdtemp(path.join(os.tmpdir(), "uwarb-perf-"));
  const flags = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    "--window-size=1440,900", "--no-first-run", "--no-default-browser-check",
    "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio", "--hide-scrollbars",
    // precise heap numbers + keep background rAF/timers unthrottled so probes are honest.
    "--enable-precise-memory-info", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    // --headless forces software WebGL so panels still render; the real-GPU default
    // needs none of this and gives §7-comparable numbers + a working reference.
    ...(opt.headless
      ? ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
      : []),
  ].filter(Boolean);
  const proc = spawn(bin, flags, { stdio: "ignore" });
  proc.on("error", (e) => { console.error("Failed to launch Chrome:", e.message); process.exit(2); });

  // wait for the DevTools HTTP endpoint, then the browser ws.
  const deadline = Date.now() + 20000;
  let wsUrl = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; if (wsUrl) break; }
    } catch {}
    await sleep(150);
  }
  if (!wsUrl) { proc.kill("SIGKILL"); throw new Error("Chrome DevTools endpoint never came up."); }
  return { proc, userDir, wsUrl };
}

function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const rpc = {
    ready: new Promise((res, rej) => { ws.addEventListener("open", () => res()); ws.addEventListener("error", rej); }),
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(msg));
      });
    },
    close() { try { ws.close(); } catch {} },
  };
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message} (${m.method || ""})`));
      else resolve(m.result);
    }
  });
  return rpc;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- session helpers ------------------------------------------------------- */
function makeSession(rpc, sessionId) {
  return {
    async evaluate(expression, awaitPromise = false) {
      const r = await rpc.send("Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise }, sessionId);
      if (r.exceptionDetails)
        throw new Error("page eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result?.value;
    },
    click(selector) {
      return this.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.click();return true;}return false;})()`);
    },
  };
}

/* ---- browser-side probe expressions (parent page only) --------------------- */
const P = {
  readyComplete: `document.readyState==='complete'`,
  expectedModels: `[...document.querySelectorAll('iframe[data-id]')].map(f=>f.dataset.id).filter(id=>id!=='reference')`,
  liveCount: `(()=>{let n=0;document.querySelectorAll('iframe[data-id]').forEach(f=>{const s=f.getAttribute('src');if(s&&s!=='about:blank')n++;});return n;})()`,
  scores: `(()=>{try{const raw=sessionStorage.getItem('uwarb_scores_41x31');if(!raw)return null;const o=JSON.parse(raw);const out={};for(const id in (o.models||{})){const s=o.models[id]&&o.models[id].s;if(s&&s.coreRmse!=null&&isFinite(s.coreRmse))out[id]=s.coreRmse;}return out;}catch(e){return null;}})()`,
  // One shared window measuring fps / heap / alloc / msg-rate / max-live.
  idleSampler: (W) => `new Promise(res=>{
    const W=${W}; let frames=0; const start=performance.now();
    let heapMin=Infinity,heapMax=0,prev=null,allocSum=0,maxLive=0,msgs=0;
    const onMsg=()=>{msgs++;}; addEventListener('message',onMsg,true);
    const live=()=>{let n=0;document.querySelectorAll('iframe[data-id]').forEach(f=>{const s=f.getAttribute('src');if(s&&s!=='about:blank')n++;});return n;};
    const heap=()=>{const m=performance.memory;if(!m)return;const h=m.usedJSHeapSize/1048576;heapMin=Math.min(heapMin,h);heapMax=Math.max(heapMax,h);if(prev!=null&&h>prev)allocSum+=h-prev;prev=h;};
    const iv=setInterval(()=>{heap();maxLive=Math.max(maxLive,live());},200);
    (function loop(t){frames++;if(t-start>=W){clearInterval(iv);removeEventListener('message',onMsg,true);heap();const dt=(t-start)/1000;
      res({fps:Math.round(frames/dt),heapMinMB:isFinite(heapMin)?+heapMin.toFixed(1):null,heapPeakMB:heapMax?+heapMax.toFixed(1):null,heapAvail:!!performance.memory,allocRateMB:+(allocSum/dt).toFixed(1),msgRate:+(msgs/dt).toFixed(2),maxLive,secs:+dt.toFixed(2)});return;}
      requestAnimationFrame(loop);})(start);
  })`,
};

/* ============================================================================
 Main
============================================================================ */
(async function main() {
  const checks = [];
  // hard=true → a failure fails the run (exit 1); hard=false → advisory (WARN only).
  const add = (name, pass, detail, hard = true) => checks.push({ name, pass, detail, hard });
  const scoreHard = !opt.headless;   // reference TL only arrives on a real GPU run

  let staticSrv = null, chrome = null, rpc = null;
  try {
    // resolve target URL
    let targetUrl = opt.url;
    if (!targetUrl) {
      staticSrv = await startStaticServer();
      targetUrl = `http://127.0.0.1:${staticSrv.port}/`;
    }
    console.log(`\n⚡ WP5 perf check → ${targetUrl}\n`);

    chrome = await launchChrome();
    rpc = connectCDP(chrome.wsUrl);
    await rpc.ready;

    const { targetId } = await rpc.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await rpc.send("Target.attachToTarget", { targetId, flatten: true });
    const S = makeSession(rpc, sessionId);
    await rpc.send("Page.enable", {}, sessionId);
    await rpc.send("Runtime.enable", {}, sessionId);
    await rpc.send("Page.navigate", { url: targetUrl }, sessionId);

    // wait for document complete
    await waitFor(() => S.evaluate(P.readyComplete), (v) => v === true, 30000, 250, "page load");

    // discover which models this deployment ships (prod=4, local=5)
    const expected = await S.evaluate(P.expectedModels);
    console.log(`  models present: ${expected.join(", ")}`);

    // wait for the sequential warm-up to score every model into the cache.
    // (headless never completes — its reference stalls — so cap the dead-wait there.)
    const waitMs = opt.headless ? Math.min(CFG.warmupMs, 25000) : CFG.warmupMs;
    console.log(`  waiting for canonical scores (≤${(waitMs / 1000) | 0}s warm-up)…`);
    const scores = await waitFor(
      () => S.evaluate(P.scores),
      (v) => v && expected.every((id) => id in v),
      waitMs, 1000, "canonical scores",
    ).catch(async () => await S.evaluate(P.scores)); // fall through with partial scores for reporting

    const haveAll = scores && expected.every((id) => id in scores);
    const missingNote = opt.headless
      ? "reference panel does not deliver its TL field under --headless (compositor-gated); re-run WITHOUT --headless for the score check"
      : `missing: ${expected.filter((id) => !(scores && id in scores)).join(", ") || "all"}`;
    add("scores collected", !!haveAll,
      haveAll ? `all ${expected.length} models scored` : missingNote, scoreHard);

    /* ---- canonical score equivalence (scientific regression) ---- */
    if (opt.updateBase) {
      if (!haveAll) throw new Error(`refusing to write baseline: ${missingNote}`);
      const baseline = { note: "WP5 golden canonical (41x31) coreRMSE per model", capturedFrom: targetUrl, capturedAt: new Date().toISOString(), models: scores || {} };
      await fsp.writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
      console.log(`\n  ✔ baseline written → ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
      add("baseline updated", true, `${Object.keys(scores || {}).length} models captured`);
    } else if (!haveAll && !scoreHard) {
      add("canonical scores == baseline", true, "skipped — " + missingNote, false);
    } else {
      const baseline = await loadBaseline();
      if (!baseline) {
        add("canonical scores == baseline", false, "no tools/perf_baseline.json (run --update-baseline first)");
      } else {
        const rows = [], overlap = expected.filter((id) => id in baseline.models);
        let ok = overlap.length > 0;
        for (const id of overlap) {
          const cur = scores?.[id], base = baseline.models[id];
          const d = (cur == null) ? Infinity : Math.abs(cur - base);
          if (!(d <= CFG.scoreTolDB)) ok = false;
          rows.push(`${id} cur=${fmt(cur)} base=${base.toFixed(3)} Δ=${cur == null ? "n/a" : d.toFixed(4)}`);
        }
        const skipped = expected.filter((id) => !(id in baseline.models));
        add("canonical scores == baseline", ok,
          `tol ±${CFG.scoreTolDB} dB · ${rows.join(" | ")}${skipped.length ? ` · skipped(no baseline): ${skipped.join(",")}` : ""}`, scoreHard);
      }
    }

    /* ---- settle: let the harness's own sequential warm-up finish before we
       measure mount counts, so the two don't race (warm-up transiently
       mounts/unmounts panels). Default tab is Quick View → 1 live once settled. ---- */
    await S.click(`.tab-btn[data-tab="overview"]`);
    await waitFor(
      async () => { const a = await S.evaluate(P.liveCount); await sleep(700); const b = await S.evaluate(P.liveCount); return { a, b }; },
      ({ a, b }) => a === b && a <= CFG.liveMax,
      15000, 300, "warm-up to settle",
    ).catch(() => {}); // best-effort; the assertions below still report the truth

    /* ---- mount behavior: Quick View = 1 live, Compare = 2 live, ≤2 ever ---- */
    let maxLiveSeen = 0;
    async function tabLive(tab) {
      await S.click(`.tab-btn[data-tab="${tab}"]`);
      await sleep(400);
      const n = await S.evaluate(P.liveCount);
      maxLiveSeen = Math.max(maxLiveSeen, n);
      return n;
    }
    const ovLive = await tabLive("overview");
    const cmpLive = await tabLive("compare");
    const scLive = await tabLive("scorecard");
    add(`Quick View live == ${CFG.overviewLive}`, ovLive === CFG.overviewLive, `measured ${ovLive}`);
    add(`Compare live == ${CFG.compareLive}`, cmpLive === CFG.compareLive, `measured ${cmpLive}`);
    add(`live panels ≤ ${CFG.liveMax} (MOUNT_CAP)`, maxLiveSeen <= CFG.liveMax,
      `max live seen ${maxLiveSeen} (scorecard held ${scLive})`);

    /* ---- idle steady-state sampling on Quick View (the default landing = 1 live
       panel — the state §7's FPS/heap targets describe; scorecard holds 2 warm
       LRU panels whose churn is opaque-model cost, not the harness's) ---- */
    await S.click(`.tab-btn[data-tab="overview"]`);
    await sleep(1500);                                   // let the leader settle + GC
    console.log(`  sampling Quick View steady-state (${CFG.sampleMs / 1000}s, 1 live panel)…`);
    const s = await S.evaluate(P.idleSampler(CFG.sampleMs), true);

    // GPU-bound metrics: advisory by default (Quick View heap/alloc is dominated by
    // the OPAQUE model panel's own GC churn — run-to-run noisy, and the audit warns
    // against scoring the model). --strict promotes them to hard gates on a machine
    // you've calibrated the ceilings for. The mount/score gates above stay hard.
    const perfHard = opt.strict;
    add(`parent FPS ≥ ${CFG.fpsMin}`, s.fps >= CFG.fpsMin, `measured ${s.fps} FPS over ${s.secs}s`, perfHard);
    add(`postMessage rate ≤ ${CFG.msgRateMax}/s`, s.msgRate <= CFG.msgRateMax, `measured ${s.msgRate}/s`);
    add(`live during sampling ≤ ${CFG.liveMax}`, s.maxLive <= CFG.liveMax, `max ${s.maxLive}`);
    if (s.heapAvail) {
      const amp = (s.heapPeakMB != null && s.heapMinMB != null) ? +(s.heapPeakMB - s.heapMinMB).toFixed(1) : null;
      add(`heap peak < ${CFG.heapPeakMaxMB} MB`, s.heapPeakMB < CFG.heapPeakMaxMB,
        `peak ${s.heapPeakMB} MB · sawtooth ±${amp} MB (heap floor ${s.heapMinMB} MB)`, perfHard);
      add(`gross alloc ≤ ${CFG.allocRateMaxMB} MB/s`, s.allocRateMB <= CFG.allocRateMaxMB,
        `measured ${s.allocRateMB} MB/s`, perfHard);
    } else {
      add("heap peak", true, "performance.memory unavailable — skipped (non-Chromium?)");
    }

    if (opt.keepOpen) { console.log("\n  --keep-open: leaving browser up. Ctrl-C to exit.\n"); await sleep(1e9); }
  } catch (err) {
    add("harness ran", false, err.message);
  } finally {
    try { rpc?.close(); } catch {}
    try { chrome?.proc.kill("SIGKILL"); } catch {}
    try { staticSrv?.server.close(); } catch {}
    if (chrome?.userDir) fsp.rm(chrome.userDir, { recursive: true, force: true }).catch(() => {});
  }

  /* ---- report ---- */
  console.log(`\n──────────── WP5 PERF SCORECARD (${opt.headless ? "headless/SwiftShader" : "real-GPU"}) ────────────`);
  let failed = 0;
  for (const c of checks) {
    const warn = !c.pass && !c.hard;              // advisory failure → WARN, does not gate exit
    if (!c.pass && c.hard) failed++;
    const tag = c.pass ? "\x1b[32mPASS\x1b[0m" : warn ? "\x1b[33mWARN\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(` ${c.pass ? "✔" : warn ? "•" : "✗"} ${tag}  ${c.name}\n        ${c.detail}`);
  }
  console.log("────────────────────────────────────────────────────");
  console.log(failed === 0
    ? `\x1b[32m✓ ALL ${checks.length} CHECKS PASSED\x1b[0m\n`
    : `\x1b[31m✗ ${failed}/${checks.length} CHECK(S) FAILED\x1b[0m\n`);
  process.exit(failed === 0 ? 0 : 1);
})();

/* ---- utilities ------------------------------------------------------------- */
async function waitFor(probe, ok, timeoutMs, intervalMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await probe(); if (ok(last)) return last; } catch {}
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}
async function loadBaseline() {
  try { return JSON.parse(await fsp.readFile(BASELINE_PATH, "utf8")); } catch { return null; }
}
function fmt(v) { return v == null ? "n/a" : Number(v).toFixed(3); }
function printHelp() {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("============================================================================")[1]);
}
