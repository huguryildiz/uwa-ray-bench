# uwa-ray-bench — Project Rules

A three-way LLM benchmark: **Fugu Ultra vs Opus 4.8 (max) vs GPT 5.5 (Extra High)**
each build a self-contained 3D underwater acoustic ray-propagation viz, scored against a
**BELLHOP3D** reference (ground truth) on a shared TL grid.

**Single source of truth:** [docs/benchmark_spec.md](docs/benchmark_spec.md).
Read it before touching anything. If this file and the spec disagree, the spec wins
— and fix the disagreement.

---

## 🚨 Fairness & isolation — the rules that protect the benchmark

Breaking any of these silently invalidates the comparison. Treat them as hard stops.

1. **NEVER read, edit, or "improve" the model panels.**
   `models/fugu/ray_view.html` and `models/opus/ray_view.html` are **model outputs**.
   The infra side only ever loads them as opaque `<iframe>`s. Do not open them to
   "check," copy patterns from them, or fix them.
2. **The infra session must not author a model panel.** Whoever builds
   `harness/` + `reference/` has seen the comparison machinery and the reference
   physics; that knowledge would contaminate a model output. Model panels are
   produced in **separate, isolated** sessions.
3. **Each model run is blind:** byte-identical verbatim prompt, no sight of the other
   model, the reference, or the harness internals.
4. **Only the verbatim prompt block goes to models.** Everything in the spec under
   a heading marked `(NOT part of the verbatim prompt)` is orchestration — never
   paste it into a model prompt.
5. **No UI mockup to the models.** Any mockup is for our side (harness/reference)
   only. A mockup that depicts the ray fan, shadow zones, R's reachability, or TL
   values would contaminate the physics result.

```text
            HARNESS CHROME  ← infra session (this repo's build work)
   ┌──────────────┬──────────────┬──────────────┐
   │   Fugu UI    │   Opus UI    │ Reference UI │   ← never touch the two
   │ (Fugu Ultra) │ (Opus 4.8max)│ (infra sess) │     model panels' internals
   └──────────────┴──────────────┴──────────────┘
```

---

## What WE build (the infra / "final UI")

`harness/index.html` + `harness/harness.js` + `reference/ray_view_reference.html` +
the shared WebGL renderer + `reference/bellhop3d/compute_reference.py`.

### Build stack — non-negotiable
- **Vanilla JS + raw WebGL only.** No framework (React/Vue/etc.), no external library,
  no CDN, no build step. Model panels are *required* to be vanilla; harness +
  reference match so all three share one visual language.
- **Raw WebGL, not Canvas2D** for the scene (the dense 81/61 fan is ~500k line
  segments — Canvas2D can't hold 60 FPS across three panels).
- **Insonified volume = point-splat / billboards**, not volumetric raymarch.
- **100% static.** No backend, no serverless. Deploy target: **Vercel static site.**

### Design system — shared theme tokens (reuse, don't hard-code)

All infra surfaces share ONE token set (CommSysLab: dark glassmorphism, neon signal
palette). Always style from these CSS custom properties; never inline raw hex/blur values.

- **Harness chrome** (`harness/index.html` `:root`): bg `--bg #03030d`; glass
  `--glass`/`--glass-2`; text `--text #eaeefc`/`--text-dim`/`--text-faint`; borders
  `--border`/`--border-strong`; neon accents `--accent #39ff85`, `--accent-blue #7b8cff`,
  `--accent-cyan #2dd4bf`, `--accent-2 #ff8c42`; status `--ok`/`--warn`/`--err`,
  `--marker #ff4f9a`; geometry `--radius 18px`/`--radius-sm 10px`; glass blur
  `--blur`/`--blur-sm`; motion `--tr`; elevation `--lift`/`--lift-sm`; type `--font`
  IBM Plex Sans · `--head` Newsreader (serif headings) · `--mono` IBM Plex Mono.
- **Reference panel** (`reference/ray_view_reference.html` `:root`): its own aligned
  subset — `--glass`, `--hair`, `--cyan`/`--green`, `--ink`/`--muted`, `--blur`, `--fmono`,
  `--head`. Keep it visually consistent with the chrome.

### Mobile portrait is first-class — verify every UI change at phone width

Not desktop-only. The required portrait behavior:

- Harness (`@media (max-width:680px)`): the 4 panels stack **4×1**, the scorecard
  bar-charts stack **9×1**, and the toolbar collapses into a **hamburger drawer**
  (`#bar-actions` + `#hamburger`, toggled by `#bar.nav-open`).
- Reference panel (`@media (max-width:460px)`, on its own iframe width): the floating
  metric card + control HUD **auto-collapse to pills** on boot (reusing the `.min-collapsed`
  toggle), expandable on tap, so they don't bury the 3D scene. `matchMedia` evaluates the
  iframe width — test inside the harness (or a width-constrained iframe), not standalone.

### Reference data
- Precomputed offline by `compute_reference.py` (genuine **3D** BELLHOP3D — NOT Nx2D).
- Shipped **per snap-grid combo**: `reference/data/<elev>x<azim>.bin` (25 files) +
  `manifest.json`. The reference panel lazy-fetches only the active combo. No 50 MB
  monolith.
- Encoding: ray paths as Int16-quantized x,y,z + Float32 travel-time, base64,
  ~80–120 pts/ray. TL field 101×49×31 Float32 dB, row-major **x-fastest**.
- **Validate the reference before trusting it:** a purely refractive ray that never
  hits the seabed must stay in its launch vertical plane and match the 2D solution.

---

## The shared contract (how comparison works)

Comparison is on **data, not pixels**. Every panel emits via
`window.parent.postMessage({type:'ray_metrics', ...}, '*')`:
- metric-card numbers, **and**
- its TL field on the **canonical grid** (101×49×31, Float32 dB, x-fastest).

The harness scores everyone on that identical grid: **TL RMSE** + **TL(R) error** vs
BELLHOP3D. The model panels render however they like; the verdict comes from the
exported numbers.

- **Snap-grid:** 5×5 = 25 discrete stops. Elevation {11,21,**41**,61,81} × azimuth
  {9,16,**31**,46,61}. Canonical = **41/31** — the only scored operating point.
- **Scoring is tiered:** weight the core (centerline refraction, coverage mask, TL
  away from caustics); treat true 3D out-of-plane deflection as a **bonus/tiebreaker
  axis**, not the whole score. Preserve partial credit — report the full scorecard,
  never a single number.

---

## Conventions
- **Python:** native **arm64** only (Apple Silicon). Use a venv from Homebrew
  `/opt/homebrew/bin/python3.12`; never the x86_64 anaconda default. Verify:
  `python3 -c "import platform; print(platform.machine())"` → `arm64`.
- **Surgical edits.** Touch only what the task needs; match existing style; don't
  refactor working code or delete pre-existing dead code unasked.
- **Git:** commit/push directly to `main`, no PRs, no feature branches unless asked.
  (Not yet a git repo — `git init` first if/when versioning.)
- Record locked design decisions in the spec, not just in chat — the spec is the
  durable memory.
