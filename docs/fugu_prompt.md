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
