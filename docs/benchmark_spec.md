# Underwater Acoustic Ray-Propagation Benchmark (3D) — Model Prompt

**Purpose:** Four-way model comparison — Fugu Ultra vs Opus 4.8 (max reasoning
effort) vs GPT 5.5 (Extra High) vs Gemini 3.1 Pro High, all scored
against a BELLHOP3D reference (ground truth). The same prompt goes to all four LLMs;
each produces a self-contained `ray_view.html` that drops into the comparison
harness as an isolated `<iframe>`. The BELLHOP3D reference is precomputed offline
and rendered by the same engine in a fifth `<iframe>`, giving the otherwise
qualitative task a quantitative anchor (TL RMSE vs Bellhop on a shared grid).

**Crux:** continuous refraction per the sound-speed profile (NOT straight-line
rays) + correct seabed reflection off 3D sloped terrain, producing both the
refractive surface shadow zone and the 3D geometric shadows behind the seamounts.
Because c depends only on depth z, refraction alone keeps each ray in its own
vertical azimuthal plane — the genuinely 3D effect is out-of-plane deflection
when rays reflect off the sloped seabed. That coupling is the discriminator.

---

## Prompt (give verbatim to each model)

```
TASK: Build a self-contained animated HTML page that visualises acoustic wave
propagation from a single source through a 3D ocean volume, correctly producing
the acoustic SHADOW ZONES caused by (a) sound-speed refraction and (b) the
seabed terrain. Output EXACTLY one file named ray_view.html.

DOMAIN (3D: range x, cross-range y, depth z; z increases downward)
- Range      x: 0 to 50 km   (source-to-receiver axis)
- Cross-range y: 0 to 24 km   (source and seabed features on the centerline y = 12 km)
- Depth      z: 0 to 3000 m

SOUND SPEED PROFILE c(z)  (depth-only; downward-refracting surface layer over a deep duct)
- For 0 <= z <= 200 m:   c(z) = 1520 - 0.10 * z          (1520 -> 1500 m/s)
- For z > 200 m:         c(z) = 1500 + 0.018 * (z - 200)
  Note: this profile has a sound-speed minimum at z = 200 m. c does NOT depend
  on x or y, so refraction alone keeps each ray in a vertical plane through its
  launch azimuth; only seabed reflection can move a ray between planes.

SYNTHETIC BATHYMETRY  seabed depth D(x,y), two 3D seamounts (domes) over a flat base:
- D(x,y) = 2500
          - 1500 * exp( -( ((x_km - 18)/2.5)^2 + ((y_km - 12)/3.0)^2 ) )
          - 1900 * exp( -( ((x_km - 34)/2.0)^2 + ((y_km -  9)/2.5)^2 ) )
  where x_km, y_km are in km. (Two underwater "mountains" rising toward the
  surface near (x=18, y=12) km and (x=34, y=9) km. The second seamount is
  deliberately OFFSET from the centerline so the bathymetry is asymmetric in
  cross-range; both are finite in BOTH horizontal directions so they cast true
  3D shadows.) Acoustic energy must not pass through the seabed.

TWO MARKED POINTS
- SOURCE S at (x = 0 km, y = 12 km, z = 50 m), inside the surface layer. Emitter.
- RECEIVER R at (x = 40 km, y = 9 km, z = 1000 m). R is only a marked target; do
  not move it. Your visualisation must compute and make it visually clear whether
  R is reached by at least one traced ray under your implemented ray model, or is
  unreached (shadowed). Do NOT assume in advance that R must be shadowed.

PHYSICS — MANDATORY (this is the crux; do not shortcut it)
- Trace a fan of rays launched from S over a 2D launch grid: elevation angles
  -20 deg to +20 deg AND azimuth angles -15 deg to +15 deg about the +x axis
  (state how many rays in each dimension). Rays MUST refract continuously
  according to c(z): apply Snell's law / the 3D ray equations so that rays bend
  toward lower sound speed. STRAIGHT-LINE propagation is NOT acceptable and will
  be considered wrong — refraction is the whole point.
- Rays reflect off the pressure-release SURFACE (z = 0) and off the SEABED
  D(x,y) using the local 3D surface normal (specular reflection about that
  normal). Because the seabed is sloped in both x and y, reflection can deflect
  a ray out of its original vertical plane — model this; do not collapse it to a
  2D bounce. Rays cannot penetrate the seabed.
- Compute and display insonified versus unreached regions from the traced-ray
  coverage mask. The setup is intended to reveal both a refractive near-surface
  shadow mechanism and 3D geometric shadows associated with the seamounts, but do
  not fabricate either effect: show only the regions implied by your traced rays,
  launch fan, integration method, and reflection model.
- TRANSMISSION LOSS (light): estimate TL in dB from geometric spreading via
  ray-tube divergence (track the cross-sectional area / Jacobian of each ray tube
  along the path; TL = -20*log10(p) relative to 1 m). Apply boundary losses:
  pressure-release surface = perfect reflection (no loss); seabed = the canonical
  half-space (c = 1600 m/s, rho = 1.8 g/cc, alpha = 0.5 dB/lambda) — use its
  Rayleigh reflection coefficient, or a constant per-bounce loss that matches it,
  stated in comments. Report
  TL(R) in dB. Do NOT implement full wave/caustic corrections — state in comments
  that this is a geometric-spreading approximation and clamp intensity at caustics
  so values stay finite. The shadow threshold MUST be defined in terms of TL
  (e.g. a voxel is "shadow" if TL exceeds a stated dB cutoff); state the cutoff.

CANONICAL CONFIG (the scored operating point — identical for all three panels)
- Launch fan: elevation -20 to +20 deg with 41 beams (1 deg step); azimuth -15 to
  +15 deg with 31 beams (1 deg step) => 1271 rays. This is the canonical fan.
- Seabed half-space: c = 1600 m/s, rho = 1.8 g/cc, alpha = 0.5 dB/lambda.
- TL comparison grid: 101 (x) x 49 (y) x 31 (z) nodes over the full domain.
- ALL metric-card numbers and the TL RMSE vs BELLHOP3D are computed at THIS
  canonical setting. Sliders may move OFF canonical for live human exploration,
  but the metric card MUST flag its numbers as "off-canonical" whenever any
  control differs from the values above, and a "Reset to canonical" control MUST
  restore them. The official score/screenshot is always taken at canonical.

RECEIVER ANALYSIS & SELF-CHECKS (run once, not per frame)
- Eigenrays: from the traced fan, identify the rays that actually connect S to R
  within the canonical eigenray tolerance (state the tolerance). HIGHLIGHT these
  eigenrays distinctly and draw a small ARRIVALS stem plot at R (travel time vs
  amplitude / TL per arrival) so the multipath structure is visible. If none
  connect within tolerance, say so explicitly.
- Reciprocity self-check: re-trace with S and R swapped; for a correct model
  TL(R from S) must equal TL(S from R). Report the reciprocity error in dB.
- Convergence self-check: recompute the insonified fraction and TL(R) at 2x the
  canonical beam counts; report how much each moves. Large movement means the
  canonical fan is under-resolved.

ANIMATION & RENDERING
- Render the 3D scene with your own perspective/isometric projection (no 3D
  library). The camera MUST orbit freely around the volume: drag to rotate up/down
  (pitch) and left/right (yaw), and scroll/pinch to zoom in/out. Rotation and zoom
  must keep working while the animation plays.

- VISUAL ENVIRONMENT (underwater scene):
  * Water: dark blue VERTICAL gradient — lighter cyan-blue near the surface
    (z = 0) fading to near-black navy at depth (z = 3000 m). Not a flat fill.
  * Draw a thin lit bounding box with axis ticks/labels (range x in km,
    cross-range y in km, depth z in m) for spatial reference, and a faint
    semi-transparent water-surface plane at z = 0.
  * Seamounts: render the bathymetry as a shaded SURFACE in a warm earth tone
    (sand / olive) with rim lighting, so BOTH seamounts stand out clearly against
    the blue water. Label the surface and the seabed.
  * Rays: colour each ray by its LAUNCH ANGLE (a fan / rainbow mapping) so the
    refractive bending and fan structure are visible, with faded trails behind
    the advancing front.
  * SOURCE S and RECEIVER R: glowing spheres with text labels (S warm/white,
    R cyan). Ring R GREEN if it is reached by >= 1 ray, RED if unreached.
  * Short legend identifying water, seabed, rays, shadow, S and R.

- PLAYBACK: the animation does NOT auto-start. A PLAY button starts it; on Play,
  rays emit from S and advance GRADUALLY by travel time, a coherent wavefront
  sweeping outward in 3D toward R and leaving the traced ray paths behind it.
  Play toggles to Pause. Reset returns to the initial pre-emission state.

- Shadow / coverage: mark the unreached SHADOW regions from a reproducible 3D
  ray-coverage voxel mask, distinct from insonified regions. Show insonified space
  as a translucent glowing volume and leave shadow / unreached space empty and
  dark; a voxel is shadow when its TL exceeds the stated dB cutoff. Provide a
  toggle to colour the insonified volume by TL on a dB colormap (with a colorbar)
  instead of the flat glow. State the voxel resolution and the exact reachability
  criterion in comments. Compute the mask ONCE after ray tracing (it is static);
  do NOT recompute it per animation frame.

- Provide at least one reference cross-section view through the centerline
  (y = 12 km) for clarity. Dark background.

- CONTROLS: Play / Pause, Reset, camera reset, "Reset to canonical", and four
  sliders — (1) elevation beams and (2) azimuth beams (fan density, split like the
  reference tool; both DEFAULT to the canonical 41 / 31 and define a labelled
  canonical tick), (3) playback time-scrub + speed, (4) shadow / insonified-volume
  opacity. The beam sliders may move off canonical for exploration, but doing so
  flags the metric card "off-canonical" (see CANONICAL CONFIG). Do NOT expose
  sliders that change the scenario itself (sound-speed profile, bathymetry, S/R
  positions, launch-angle limits): those stay fixed so the three panels remain
  directly comparable.

- METRICS PANEL: render a compact card in a corner showing this model's own
  computed metrics, and also send them to the parent via
  window.parent.postMessage({type:'ray_metrics', ...}, '*') so the harness can lay
  the three cards side by side (postMessage only — no network). Report:
  * Reachability: is R reached (yes/no) + nearest-ray miss distance to R (m) + TL(R) in dB
  * Coverage: insonified voxel fraction (%) and shadow fraction (%)
  * 3D fidelity: max out-of-plane deflection of any ray |Δy| from its launch
    plane (m), and max drift of the Snell invariant cos(theta)/c along rays
  * Performance: FPS, file size (KB), and ray count (elevation x azimuth)
  * Eigenrays: number of S->R eigenrays found + their arrival times and per-arrival TL
  * Reciprocity error (dB) from the S<->R swap self-check
  * Convergence: insonified-fraction delta and TL(R) delta at 2x canonical beams
  Also include in the payload your TL field sampled on the CANONICAL COMPARISON
  GRID — 101 (x) x 49 (y) x 31 (z) nodes evenly spanning the full domain, as a
  flat Float32 array in dB, row-major x-fastest — so the harness can compute TL
  RMSE against the BELLHOP3D reference on the identical grid. Do NOT bake the
  Bellhop reference into your file or try to match it; just trace your own physics
  and report your own field. The harness owns the comparison.

HARD CONSTRAINTS (so it drops into a comparison harness)
- Single self-contained file. Plain <canvas> + vanilla JS only. NO external
  library, CDN, font, or network fetch (no three.js / WebGL helper libs). You may
  use raw WebGL or 2D canvas, but all projection/math must be in-page. All data
  computed in-page.
- Must render correctly inside an <iframe> with no parent-page assumptions:
  no reliance on global names from a host page, no top-level margins, dark
  background.
- List every assumption (elevation/azimuth ray counts, time step, reflection
  model, voxel resolution, seabed reflection-loss dB, TL shadow-cutoff dB) as
  comments at the top of the file.
```

---

## Why it is built this way (discriminators)

- **Refraction is the main discriminator.** A weak model draws straight rays and
  only a stylised geometric shadow behind the seamounts appears; it misses the
  near-surface coverage structure created by the sound-speed minimum at 200 m.
  Straight-line rays are explicitly banned, so a lazy model cannot skip the
  governing physics. The benchmark should judge the computed coverage mask, not
  require a pre-scripted visual outcome at a particular receiver.
- **3D bathymetry interaction.** Two analytic Gaussian seamount domes
  (reproducible, finite in x and y). Rays must reflect off the local 3D slope,
  cannot pass through the seabed, and CAN be deflected out of their launch plane
  by the sloped terrain. A model that reflects off a flat bottom, or that keeps
  every ray in a fixed vertical plane, puts the shadow in the wrong place and
  misses the cross-range (y) shadow structure.
- **Render architecture.** The differentiator here is a genuine 3D wavefront /
  trail with working camera controls versus a faked 2D bundle or a static ray
  cloud. R is placed at (40 km, 9 km, 1000 m), in the geometric shadow behind the
  offset seamount (y = 9 km) — occluded for an in-plane / Nx2D solve, yet reachable
  in the genuine-3D reference (TL ≈ 83 dB) via out-of-plane paths that negotiate the
  sloped flank — to force a concrete reachability decision that doubles as the 3D
  discriminator; the model must report whether it is insonified or unreached under
  its own stated numerical assumptions, rather than assuming a shadow classification
  in advance.

## Reference panel (BELLHOP3D — ground truth)

The third `<iframe>` is NOT a language model. It shows a BELLHOP3D reference run
on the IDENTICAL scenario (same c(z), D(x,y), S, R, launch fan). Because Bellhop
cannot run in the browser, produce it offline and export to a JSON file both the
3D ray paths and the TL field on the CANONICAL COMPARISON GRID (101 x 49 x 31,
dB, x-fastest). The third iframe loads that JSON and draws it with the SAME
renderer the models use, so all three panels share one visual language and the
Bellhop TL grid can be diffed cell-for-cell against each model's exported field.
Prerequisite: genuine BELLHOP3D (acoustics toolbox) installed locally; the
harness ships the precomputed JSON, not a live solver. NOTE: an Nx2D approach
(trace 2D in the source->R plane then rotate in azimuth — what many tools do) is
NOT sufficient here, because each radial is an independent 2D plane and cannot
reflect a ray out of plane. The off-centerline seamount (y = 9 km) requires a
true 3D bottom-reflection solve so the reference actually exhibits the out-of-
plane deflection the models are judged on. Label this panel clearly as the
reference so it is not mistaken for a model output.

## Scoring note

With the BELLHOP3D reference in place this task now HAS a quantitative anchor:
the harness computes each model's TL RMSE (dB) and TL(R) error versus Bellhop on
the shared grid. Treat that as the primary score, but keep the consistency checks
too — correctness is whether each model's 3D ray paths, local-slope reflections
(including out-of-plane deflection), and derived coverage mask are internally
consistent with the stated profile and bathymetry AND track the reference. RMSE
is most trustworthy where rays are dense and away from caustics; the geometric-
spreading TL is approximate, so large isolated spikes near caustics are expected
and should not dominate the score. Visual inspection remains useful but must not
replace the physics-based checks. A useful sanity check: a purely
refractive ray that never touches the seabed must stay in its launch vertical
plane and trace the same path as the 2D problem (c depends only on z). The
bathymetry is intentionally asymmetric in cross-range (seamount 2 offset to
y = 9 km), so once seabed reflections matter the centerline no longer reduces to
2D — out-of-plane deflection should appear downrange of the offset seamount.

## Benchmark validity & scoring calibration (NOT part of the verbatim prompt)

This task is the richest of the candidate benchmarks (real independent ground truth
via BELLHOP3D, a stable non-chaotic metric, multi-axis discrimination, hard to
memorize). Its failure mode is the OPPOSITE of an easy benchmark like the double
pendulum: not a ceiling effect (everyone passes) but a **floor effect** — the task
is so demanding that BOTH models fail the hardest parts and the comparison returns
a null result. The points below exist to keep the benchmark discriminating. They
guide whoever runs and scores it; they do NOT change the verbatim prompt.

### Known risks

- **The headline discriminator (true 3D out-of-plane reflection) may not fire for
  either model.** Genuine 3D reflection off the sloped seabed is what separates a
  real 3D solve from Nx2D — hard enough that it distinguishes BELLHOP3D itself from
  Nx2D tools. If all three models collapse to in-plane / Nx2D in the browser, that axis
  is dead for everyone and yields no discrimination. Do not let the whole score depend
  on it.
- **Single-shot over-scope.** Refraction + 3D reflection + TL ray-tube Jacobian +
  eigenrays + reciprocity + convergence + premium 3D render + sliders + postMessage,
  in one self-contained file with zero libraries, is a large surface. If the models
  all ship partial/broken physics you end up comparing wrongs. High output variance:
  results may hinge on whether a model "got organized," not on true capability.
- **Reference verification burden (fragile).** The quantitative anchor is only as
  good as the BELLHOP3D run. It must be configured in genuine-3D mode (NOT Nx2D);
  misconfigure it and the entire TL RMSE anchor is wrong. This is specialist setup.
- **TL / caustic noise.** The geometric-spreading TL is approximate; near caustics
  it spikes and RMSE there is unreliable (the prompt itself says so). The "primary
  score" has known soft spots and must not be read as exact.

### De-risk mitigations (apply when scoring)

1. **Tiered scoring — keep the core achievable, make out-of-plane a bonus axis.**
   Weight the score on the *core* that a competent model can plausibly reach in one
   shot — centerline refraction structure, coverage/shadow mask, and TL on the
   shared grid away from caustics. Treat true 3D out-of-plane deflection (|Δy| off
   the launch plane downrange of the y = 9 km seamount) as a **bonus / tiebreaker
   axis**, reported separately, NOT as the dominant term. This prevents a both-fail
   null result on the hardest axis from collapsing the whole comparison.
2. **Validate the reference before trusting it.** Before using BELLHOP3D as judge,
   sanity-check it against a known case: a purely refractive ray that never touches
   the seabed must stay in its launch vertical plane and match the 2D solution
   (c depends only on z). Only once the reference passes such checks does the TL
   RMSE anchor mean anything.
3. **Preserve partial credit.** The many metrics already specified (reachability,
   coverage, eigenrays, reciprocity, convergence, 3D fidelity, TL RMSE) are the best
   insurance against the floor effect — they let a model be *partially* right and be
   graded continuously rather than pass/fail. Do not reduce the verdict to a single
   number; report the full scorecard so a model that nails refraction but misses
   out-of-plane is distinguished from one that misses both.

**Calibration principle:** a good benchmark discriminates in the *middle* of the
difficulty range. The double pendulum sits at the easy floor (ceiling effect);
this task risks the hard ceiling (floor effect). Tiered scoring + partial credit
pull the effective difficulty back into the discriminating middle without watering
down the physics the prompt demands.

## Harness fit

Five panels in a **4+1 layout** of isolated `<iframe>`s: four model panels in a
top row (**Fugu Ultra** | **Opus 4.8 (max)** | **GPT 5.5 (Extra High)** |
**Gemini 3.1 Pro High**) and the **BELLHOP3D reference** spanning the
full bottom row — the fixed anchor each model is read against. Layout is a CSS
grid in `harness/index.html`; the synced camera/beam-stop and scorecard span all
five cells. The four model files are produced from the verbatim prompt; the
reference panel renders the precomputed Bellhop JSON with the same engine. Each
model file self-reports its metric card and pushes its numbers + canonical-grid
TL field to the harness via `postMessage({type:'ray_metrics', ...})`; the harness
aggregates the cards and computes each model's TL RMSE / TL(R) error against the
Bellhop grid. Scenario parameters (profile, bathymetry, S/R, launch-angle limits)
are identical across all four so only the models' physics and rendering differ.

Harness-only features (built once by the harness, NOT required of the model files):

- **Synchronized camera:** orbit/zoom on any one panel drives all three together,
  so the three volumes are always viewed from the same angle for fair comparison.
  (The model files must expose set/get camera pose via postMessage to allow this.)
- **Diff overlay (model − BELLHOP3D):** a per-cell TL-error volume on the shared
  canonical grid, colour-mapped (e.g. blue = under, red = over), so where each
  model deviates from the reference is visible at a glance.
- **Final scorecard / ranking:** one table aggregating every model's TL RMSE,
  TL(R) error, reciprocity error, convergence delta, coverage, and 3D-fidelity
  numbers, ranking the models against the reference.
- **Cursor readout tooltip:** hovering the focused panel shows depth, bathymetry
  D(x,y), and local sound speed c(z) at the cursor. The scenario is analytic, so
  the harness computes these directly from c(z) and D(x,y) using only the cursor's
  world position reported by the focused panel — no per-model data needed.

## Run layout & orchestration (NOT part of the verbatim prompt)

This section is for whoever runs the benchmark — it MUST NOT be pasted into the
model prompt. Each model still outputs exactly one file named `ray_view.html`;
the folder it lands in is an orchestration concern the model never sees.

**Why separate folders.** The three models receive the byte-identical prompt and
each emit a file named `ray_view.html`. They must stay isolated — no model
may see another's output, or the comparison is contaminated — and files of
the same name cannot share a directory. So each model run gets its own working
folder, and a neutral harness folder references all three panels at the end.

**Run each model OUTSIDE this repo — not in `models/fugu/` or `models/opus/`.**
A model run launched inside this repository can see the repo root: `CLAUDE.md`, the
spec, the harness, the reference, and the other model — total contamination. The
fairness rule is not "separate sub-folder," it is "sees nothing but the verbatim
prompt." So:

- Run each model in a **clean, isolated directory outside this repo**, containing
  only the verbatim prompt (nothing else). Then copy the resulting `ray_view.html`
  into `models/fugu/` or `models/opus/`.
- Fugu runs in **Codex**, whose instructions file is **`AGENTS.md`** (not
  `CLAUDE.md`). Do NOT place an `AGENTS.md` in this repo — Codex would read it and
  leak orchestration into the model. `CLAUDE.md` here is infra-side only and must
  never reach a model run.

```
uwa-ray-bench/
├── benchmark_spec.md   # single source of truth (the verbatim prompt)
│
├── models/
│   ├── fugu/ray_view.html                # produced by Codex → Fugu Ultra (isolated)
│   ├── opus/ray_view.html                # produced by a separate Opus 4.8 (max) chat (isolated)
│   ├── gpt/ray_view.html                 # produced by a separate GPT 5.5 (Extra High) session (isolated)
│   └── gemini/
│       ├── prompt.md                     # verbatim prompt ready to paste into Gemini 2.5 Pro Deep Think
│       └── ray_view.html                 # produced by a separate Gemini 3.1 Pro High session (isolated)
│
├── reference/
│   ├── bellhop3d/
│   │   ├── compute_reference.py          # offline BELLHOP3D run (acoustics toolbox)
│   │   └── bellhop_reference.json        # precomputed: 3D ray paths + TL grid 101×49×31, dB, x-fastest
│   └── ray_view_reference.html           # draws the JSON with the SAME renderer the models use
│
└── harness/
    ├── index.html                        # 4 iframes side by side (3 models + reference)
    └── harness.js                        # postMessage aggregation, TL RMSE vs Bellhop,
                                          #   synced camera, diff overlay, scorecard, cursor tooltip
```

**Model tiers (orchestration parameter, NOT a prompt change).** The scored matchup
is **Fugu Ultra vs Opus 4.8 (max) vs GPT 5.5 (Extra High) vs Gemini 2.5 Pro (Deep
Think)** — best-vs-best, each model run at its own ceiling (each named tier is that
model's maximal reasoning effort, so the comparison is ceiling-vs-ceiling, not a
lower tier like high). The tier only sets how each model is run; the verbatim prompt
is byte-identical regardless of tier, so a "max" run and a "high" run produce the
same file from the same input — only reasoning effort differs. If the goal were
instead a controlled equal-effort experiment, all sides would be pinned to the same
tier; here we deliberately compare ceilings.

**Build ownership — who builds what.** Four separate, isolated builders (three model
runs + infra); do not collapse them into one session:

- **Fugu model panel** (`models/fugu/ray_view.html`) — produced by **Codex → Fugu
  Ultra** from the verbatim prompt, in its own isolated run. No sight of the other
  models, the reference, or the harness internals.
- **Opus model panel** (`models/opus/ray_view.html`) — produced by a **separate,
  isolated Opus 4.8 (max) chat** from the verbatim prompt. No sight of the other
  models, the reference, or the harness internals.
- **GPT model panel** (`models/gpt/ray_view.html`) — produced by a **separate,
  isolated GPT 5.5 (Extra High) session** from the verbatim prompt. No sight of the
  other models, the reference, or the harness internals.
- **Gemini model panel** (`models/gemini/ray_view.html`) — produced by a **separate,
  isolated Gemini 3.1 Pro High session** from the verbatim prompt
  (`models/gemini/prompt.md`). No sight of the other models, the reference, or the
  harness internals.
- **Infrastructure = the "final UI"** (`harness/` + `reference/` + the shared WebGL
  renderer + `compute_reference.py`) — built by a **model-agnostic infra session**
  (this one). This is the shell the user actually opens: it frames the five panels,
  syncs the camera, and runs the scoring. It builds the reference panel too.

**Critical isolation rule.** The infra session and the three model runs MUST be
different sessions. Whoever builds the harness/reference has seen the comparison
machinery and the reference physics, so that session must NOT also author a model
panel — it would contaminate the model output. The infra builder only ever touches
a model file as an opaque `<iframe>` it loads at the end; it never reads or edits
the model panels' internals.

```text
                 HARNESS CHROME  ← infra session (the "final UI" shell)
   ┌────────────┬────────────┬────────────┬────────────────────┐
   │  Fugu UI   │  Opus UI   │  GPT UI    │    Gemini UI       │
   │(Fugu Ultra)│(Opus 4.8mx)│(GPT 5.5 XH)│(Gemini 2.5 DThink)│
   ├────────────┴────────────┴────────────┴────────────────────┤
   │              Reference UI (BELLHOP3D — infra sess)        │
   └────────────────────────────────────────────────────────────┘
    isolated run  isolated run  isolated run  isolated run   model-agnostic
```

The reference panel reuses the shared infra renderer (per the "same renderer"
clarification); the model files stay fully self-contained.

**Merge point: harness only.** No mid-run cross-checking. Each agent produces its
`ray_view.html` independently; the three panels are brought together exactly once,
at the end, by `harness/index.html`, which loads the three model files plus the
reference panel as isolated `<iframe>`s and runs the scoring. The shared contract
between every panel and the harness is the `postMessage({type:'ray_metrics', ...})`
payload + the canonical-grid TL field (101×49×31 Float32, dB, x-fastest).

## Precomputed reference grid, data contract & rendering architecture (NOT part of the verbatim prompt)

This section records the implementation decisions for the **reference panel** and
the **harness**. It MUST NOT be pasted into the model prompt. It explains how the
beam sliders, the precomputed BELLHOP3D data, and the renderer fit together so the
comparison stays fair, fast, and visually consistent ("premium").

### Renderer ownership & comparison contract (clarification)

The phrase "the SAME renderer the models use" elsewhere in this doc is loose and
must be read as follows. **Each model builds its OWN renderer/UI** — that is what
the verbatim prompt requires (self-contained file, own projection/camera/sliders/
metric card), and render quality is itself one of the compared axes. The **shared
renderer** is a single engine **we build once for the reference panel and the
harness chrome only**; it is NOT injected into the model panels and does not
homogenize them. "Shared visual language" is achieved by the reference panel + the
harness frame (synced camera, scorecard, diff overlay) wrapping all three equally,
not by making the model panels look identical.

**Comparison happens on the data contract, not the UI.** Every panel — all three
models and the reference — emits, via `postMessage`, the metric-card numbers plus its TL
field sampled on the identical canonical grid (101×49×31, Float32 dB, x-fastest).
The harness scores everyone on that shared grid (TL RMSE and TL(R) error vs
BELLHOP3D), so the verdict is apples-to-apples regardless of how differently each
model draws its scene. The four panels side by side + synchronized camera are for
human inspection; the scorecard + diff overlay are the objective result.

```text
                         HARNESS CHROME  (one shared frame)
          synced camera · beam-stop · playback · scorecard · diff overlay
  ┌─────────────┬─────────────┬─────────────┬─────────────┬──────────────────┐
  │ models/fugu │ models/opus │  models/gpt │models/gemini│reference/bellhop │
  │ray_view.html│ray_view.html│ray_view.html│ray_view.html│ray_view_ref.html │
  │own renderer │own renderer │own renderer │own renderer │shared renderer   │
  │(traces live)│(traces live)│(traces live)│(traces live)│(precomputed)     │
  └──────┬──────┴──────┬──────┴──────┬──────┴──────┬──────┴──────┬───────────┘
         │ postMessage │ postMessage │ postMessage │ postMessage │ postMessage
         │ {metrics+TL}│ {metrics+TL}│ {metrics+TL}│ {metrics+TL}│ {metrics+TL}
         └──────┬───────┴─────────────┴─────────────┴─────────────┘
                ▼
    harness.js  →  TL RMSE & TL(R) error vs BELLHOP3D
                   (identical 101×49×31 grid for all five panels)
                   diff overlay · scorecard · ranking across the 4 models
```

**Fairness rule — no UI mockup to the models.** The three models receive only the
byte-identical verbatim prompt. Do NOT hand them a UI mockup: it would narrow the
benchmark from "design+build the whole viz" to "implement this layout" (erasing the
render-architecture discriminator), and any mockup that depicts the ray fan, shadow
zones, R's reachability, or TL values would contaminate the physics result. Any
mockup we draw is for OUR side only — the harness chrome / reference panel — never
as model input.

### Sliders are discrete and snap to a shared grid

BELLHOP3D cannot run in the browser, so the reference panel can only show fan
densities that were solved **offline in advance**. To keep all three panels
showing the *same* fan at every slider position, the two beam sliders (elevation
beams, azimuth beams) are **discrete and snap to a shared grid of stops**. The
slider can have many visual positions but always reads from the nearest
precomputed stop — it *feels* continuous while the data stays finite.

Why not "every combination": with independent fine-grained sliders the beam count
itself becomes the slider value (~11..81 elevation × ~9..61 azimuth ≈ 3,760
combinations). At ~1–5 min per genuine-3D BELLHOP3D solve that is days of compute
and GBs of data — infeasible. A curated snap-grid gives the same UX for a fraction
of the cost.

**Working snap-grid (5×5 = 25 stops; tunable):**

| Axis      | Stops (beam counts) | Angle limits (fixed) |
|-----------|---------------------|----------------------|
| Elevation | 11, 21, 41, 61, 81  | −20° … +20°          |
| Azimuth   | 9, 16, 31, 46, 61   | −15° … +15°          |

(Canonical stop = **41 / 31**.)

Beam counts are the values where the step size evenly divides the fixed angular
range. **41/31 (the canonical stop) is in the grid.** The official score/screenshot
is always taken at canonical (per CANONICAL CONFIG); the other stops are for live
visual exploration only and do not change the scored numbers.

- **Reference panel:** precomputes a real BELLHOP3D solve at each of the 25 stops;
  the slider does a table lookup (no solving in-browser).
- **Model panels:** trace live, so any stop is cheap — but the harness **constrains
  all three panels to the same active stop** so they always show the same fan
  (fair comparison). The harness syncs the active beam-stop across panels the same
  way it syncs the camera: via `postMessage`. The model files must expose set/get
  of the active beam-stop the same way they expose camera pose.

### Cost of the precomputed grid (offline, one-time)

- **Compute:** 25 genuine-3D solves, most fast, a few minutes each →
  **~30–90 min total, one-time.** Run once, ship the JSON; the browser never solves.
- **Storage:** coarse stops are tiny, so the total is dominated by — but not equal
  to — the densest fan. Total rays across all 25 stops =
  (11+21+41+61+81) × (9+16+31+46+61) = 215 × 163 ≈ 35k rays → **~35–50 MB**
  including TL grids. (A 7×7 = 49-stop grid would be ~60–90 MB and ~1–2 h offline.)
- The single densest fan (81/61 = 4,941 rays) is ~5 MB on its own with the
  encoding below.

### Bellhop reference data contract (per-combo files + `manifest.json`)

Shipped as one file per snap-grid combo plus a manifest (see "Build stack &
hosting" below), not a single monolithic JSON. The size driver is **ray paths**,
not the TL grid. Encode for size:

- **Ray paths** — per stop, a set of **time-stamped polylines**. Each ray point
  carries position **and travel time** so the wavefront animation can sweep by
  time (geometry alone is not enough). Encode positions as **Int16, quantized**
  over the domain box (50 km × 24 km × 3 km → ~1 m resolution, ample for
  visualization), travel time as **Float32**, ~**80–120 points per ray**
  (rays bend smoothly; no need for 300+). Store as **base64 of the binary buffer**,
  not JSON number text (saves ~40%).
- **TL field** — 101×49×31 Float32 dB, row-major **x-fastest**, base64 binary
  (~600 KB). Required at the **canonical stop** for scoring (TL RMSE vs models).
  Optionally include TL grids at other stops to enrich the diff overlay, but
  scoring only ever uses canonical.
- This is the reference's analogue of each model's `postMessage` payload; the
  reference panel reads it and renders with the **shared reference/harness
  renderer** (see "Renderer ownership" above) — its own consistent visual language,
  not the model panels', which each render themselves.

### Rendering architecture (premium + fast)

Two separate loads: parsing the JSON once, and drawing every frame.

- **Parse/load (one-time):** only the **reference panel** carries the ~50 MB JSON;
  the model panels trace live and load no big file. Decode lazily — only the
  **active** snap-stop's fan is decoded from base64 into typed arrays (~few ms);
  the other 24 stay as base64 until selected.
- **Per-frame draw — use raw WebGL, not Canvas2D.** The dense fan is ~4,941 rays ×
  ~100 points ≈ 500k line segments; across three panels Canvas2D (CPU) would drop
  to ~10–15 FPS, but raw WebGL (GPU) handles it comfortably at 60 FPS. Upload ray
  vertices to a VBO once per stop; apply the projection matrix in the vertex
  shader; drive the wavefront animation with a `currentTime` uniform compared
  against each vertex's travel-time attribute. The verbatim prompt already allows
  raw WebGL (only helper libs like three.js are banned) and asks for FPS in the
  metric card — WebGL is the intended path.
- **Insonified volume — point-splat, not raymarch.** Render the translucent glowing
  insonified voxels as **point sprites / billboards** (~153k points is cheap on the
  GPU) rather than full volumetric raymarching, which would be the expensive part.
  Clamp intensity at caustics so values stay finite.
- **On slider change:** reference = instant table lookup; model panels = a brief
  live re-trace (≤~1 s for the dense fan) then smooth cached render — a short
  "computing…" state on the model panels is expected and acceptable.

**Bottom line:** discrete snap-grid + lazy per-stop decode + raw WebGL +
point-splat volume keeps ~50 MB of precomputed data and the dense fan smooth and
premium across all three panels. The trap to avoid is falling back to Canvas2D for
the dense fan.

### Build stack & hosting (decided)

- **Build stack:** vanilla JS + raw WebGL for all three panels and the harness. The
  model files are *required* to be self-contained vanilla (no libs); the reference
  panel and harness use the same stack so they share one visual language and need no
  build step. No framework (React/etc.) — this is a visualization, not an app with
  routing/state.
- **Hosting:** the whole project is **100% static** (HTML/JS + static data; the
  models trace in-browser, the reference loads precomputed data). Deploy to **Vercel
  as a static site** — no backend, no serverless functions. Relative-path iframes and
  same-origin `postMessage` work as-is on Vercel's CDN.
- **Reference data layout (hosting):** do NOT ship one ~50 MB JSON. Split the
  precomputed data **per snap-grid combo** — e.g. `reference/data/<elev>x<azim>.bin`
  (25 files) plus a small `manifest.json` listing the stops and the canonical TL
  grid. The reference panel fetches only the **active** combo on demand (~0.3–5 MB);
  the canonical combo loads first, the rest lazy-load on slider change — initial load
  is tiny instead of a 50 MB upfront download. (Vercel auto-compresses; base64 binary
  still gzips ~25–30%.) This supersedes the single-file `bellhop_reference.json` named
  in the orchestration tree above.
- **No-fetch rule:** the verbatim prompt's "no network fetch" constraint applies to
  the **model files only**. The reference panel MAY fetch its data files (it is not a
  model output), so this layout does not violate the prompt.

## Reference implementation — BELLHOP3D pipeline (LOCKED, NOT part of the verbatim prompt)

`reference/bellhop3d/compute_reference.py` (arm64 venv at `.venv/`, numpy) is the
offline precompute. It drives the installed `~/.local/bin/bellhop3d.exe`
(Acoustics-Toolbox, vendored at `uwsn-ankc/vendor/Acoustics-Toolbox`). Locked
orchestration decisions:

- **Genuine 3D, not Nx2D.** Run-type token digit at column 6 = `'3'` (`'CB   3'`
  for TL, `'R    3'` for rays). Validated below.
- **Source frequency = 50 Hz (locked).** The verbatim prompt omits frequency (TL is
  geometric → frequency-independent); BELLHOP requires one only to set Gaussian-beam
  width. At the canonical stop the insonified fraction was identical at 50 vs
  100 Hz (0.4854) and TL moved <1.5 dB — immaterial, so 50 Hz (smoother,
  toolbox-standard). (Frequency choice is independent of where R sits.)
- **SSP `'CVW'`** (C-linear interp, **V**acuum pressure-release surface = perfect
  reflection, d**W**/λ attenuation). c(z) nodes at {0, 200, 3000} m reproduce the
  piecewise-linear profile exactly. **Seabed** `'A~'` acousto-elastic half-space +
  `.bty`: cp=1600, cs=0, rho=1.8, α=0.5 dB/λ (the canonical bottom).
- **Bathymetry `.bty`** (`'RS'`, depth matrix `ny×nx`) is generated from analytic
  D(x,y) on a 0.25 km grid, extended to x∈[−3,54], y∈[−4,30] km — a margin beyond
  the trace box so the source (x=0) and far rays never sit on the grid edge
  (otherwise `GetBotSeg3D` kills rays at step 1).
- **TL solve lattice is polar** about the source (181 bearings −90..90°, 213 ranges
  0..53 km, 61 depths 0..3000 m), then **resampled (trilinear) to the Cartesian
  101×49×31 canonical grid**, x-fastest, Float32 dB. Nodes outside the insonified
  bearing wedge or below the seabed → `TL_SHADOW = 120 dB`.

**Per-stop file `reference/data/<elev>x<azim>.bin`** (raw little-endian; supersedes
base64-in-JSON for the shipped files):

```text
[4B  magic "URB1"]
[4B  uint32 headerLen]
[headerLen  JSON header: stop, freq_hz, grid{nx,ny,nz,order:x-fastest,tl_shadow},
            quant_box_m, n_rays, ray_pts[], source, receiver]
[NX*NY*NZ  Float32  TL field, x-fastest, dB]
[per ray:  int32 npts | int16[npts*3] xyz (quantized to quant_box) | float32[npts] travel-time(s)]
```
Ray positions are Int16-quantized over the domain box (~0.8 m resolution), ≤120
pts/ray; travel time is integrated as ∫ds/c(z) along each path. `manifest.json`
lists `canonical` (41×31), `freq_hz`, grid, the stop lists, and a summary per stop.

**Reference validation (passed) — proves it is genuine 3D and refraction-correct:**
- Purely refractive rays (no bottom bounce) stay in their launch vertical plane:
  max out-of-plane offset = **0.0 m**. (Matches the 2D solution, as required.)
- Rays that reflect off the sloped seabed deflect out of plane by up to **~20 km** —
  the genuine-3D effect an Nx2D solve cannot produce.
- Rays propagate the full box (max range 54 km); near-source TL ≈ spreading law
  (54.7 dB @1 km); centerline shows the expected convergence-zone/shadow oscillation.

Regenerate: `./.venv/bin/python reference/bellhop3d/compute_reference.py --all`
(`--validate`, `--freq-compare`, `--stop ELExAZ` also available). BELLHOP scratch
files live in `reference/bellhop3d/_run/` (not shipped).
