# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] — 2026-07-03

First tagged release of the UWA Ray-Propagation Benchmark: a five-way LLM
benchmark (Fugu Ultra, Opus 4.8 Max, GPT 5.5 XH, Gemini 3.1 Pro, Fable 5 Max)
scored against a genuine 3D BELLHOP3D reference solve on a shared TL grid.

### Added
- Harness chrome with Gallery / Compare / Scorecard tabs, a centralized
  Simulation Control sidebar (fan beams, playback, TL volume, camera), and
  a collapsible sidebar with a floating re-open tab.
- Precomputed BELLHOP3D reference panel (`reference/`), lazy-loaded per
  snap-grid combo, matching the harness's dark-glassmorphism design system.
- Live scoring pipeline (TL RMSE, TL(R) error, coverage, boundary Δ,
  composite score) computed from each panel's exported TL field, with
  per-column winner highlighting in the scorecard table.
- Cinema mode — hides all panel chrome to show only the ray fans.
- Mobile-portrait support throughout: 6-panel stacking in Overview
  (5 models + BELLHOP3D reference), a
  hamburger drawer for the toolbar, and vertical (1×2) stacking of the
  Compare tab's reference/model panels instead of a cramped side-by-side
  split.
- `tools/perf_check.mjs` — a headless-Chrome perf regression probe (FPS,
  heap, live-iframe count, canonical scores vs. a stored baseline).

### Fixed
- Restored `Play all` after a regression from a `{type:'play'}` restart bug;
  removed the flawed hover-play behavior.
- Corrected `vercel.json` static routing so `/` resolves to
  `harness/index.html`.
- Six targeted fixes for a severe FPS regression in the harness (reverted
  a costly 200%-scale overview-iframe experiment after profiling showed
  4× GPU overhead).

### Changed
- Restructured the harness from its original layout into the current
  3-tab (Gallery / Compare / Scorecard) design.
- Reconciled README and `docs/benchmark_spec.md` with the 3-tab harness
  refactor to remove doc/code drift.
- Renamed the browser tab title to `Underwater Acoustic Ray Bench`.
