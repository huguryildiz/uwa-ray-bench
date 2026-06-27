#!/usr/bin/env python3
"""Offline BELLHOP3D reference run (genuine 3D, NOT Nx2D).

Computes the ground-truth solve on the IDENTICAL scenario as the model panels
(same c(z), D(x,y), source S, receiver R, launch fan) and ships, per snap-grid
stop, a `reference/data/<elev>x<azim>.bin` file plus `reference/data/manifest.json`.

Each .bin holds, for one beam-fan stop:
  - the TL field resampled onto the CANONICAL comparison grid
    101 (x) x 49 (y) x 31 (z), Float32 dB, row-major x-fastest, and
  - the 3D ray paths (Int16-quantized x,y,z + Float32 cumulative travel time),
    downsampled to <=120 pts/ray, for the wavefront animation.

Why genuine 3D (run-type digit '3', not '2'): the off-centerline seamount at
y=9 km needs true out-of-plane bottom reflection; an Nx2D solve traces each
azimuth as an independent vertical plane and cannot deflect a ray between planes.

----------------------------------------------------------------------------
DESIGN DECISIONS (orchestration; the verbatim model prompt is unaffected)
----------------------------------------------------------------------------
* Source FREQUENCY is unspecified by the prompt (TL is defined geometrically:
  spreading + dB/lambda boundary loss, both frequency-independent). BELLHOP needs
  one; it only sets Gaussian-beam width. Default below; `--freq-compare` runs the
  canonical stop at 50 and 100 Hz so a value can be locked before the batch.
* Beams: Gaussian beams in Cartesian ('B'), the toolbox standard for a smooth TL
  reference. Run type 'C' (coherent) + 'B' + dimensionality '3'.
* SSP: 'CVW' = C-linear interp, Vacuum (pressure-release) surface = perfect
  reflection (matches the prompt), attenuation in dB/wavelength ('W'). c(z) is
  piecewise-linear with a kink at z=200 m, so nodes at {0,200,3000} reproduce it
  EXACTLY under C-linear interpolation.
* Seabed: acousto-elastic half-space 'A' + bathymetry from .bty ('~'):
  cp=1600 m/s, cs=0, rho=1.8 g/cc, alpha=0.5 dB/lambda (the prompt's canonical bottom).
* Receiver lattice for the TL solve is POLAR about the source (bearing theta,
  range r, depth rd); we resample it to the Cartesian comparison grid afterwards.
  Cartesian nodes outside the insonified bearing wedge, or below the seabed, get
  TL_SHADOW (no field there -> that is correctly "shadow").
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

# --------------------------------------------------------------------------
# Scenario constants (verbatim from docs/benchmark_spec.md prompt block)
# --------------------------------------------------------------------------
X_MAX_KM, Y_MAX_KM, Z_MAX_M = 50.0, 24.0, 3000.0
SRC = (0.0, 12.0, 50.0)        # (x km, y km, z m)
RCV = (40.0, 9.0, 1000.0)      # receiver R (marked target): behind offset seamount-2

ELEV_DEG = (-20.0, 20.0)       # elevation/declination launch-angle limits
AZIM_DEG = (-15.0, 15.0)       # azimuth launch-angle limits (about +x)

SEABED_CP, SEABED_CS, SEABED_RHO, SEABED_ALPHA = 1600.0, 0.0, 1.8, 0.5  # dB/lambda

DEFAULT_FREQ = 50.0            # Hz (see --freq-compare; orchestration-only)

# Snap-grid (5x5 = 25 stops). Canonical = 41 elevation x 31 azimuth.
ELEV_STOPS = [11, 21, 41, 61, 81]
AZIM_STOPS = [9, 16, 31, 46, 61]
CANON_ELEV, CANON_AZIM = 41, 31

# Canonical comparison grid (Float32 dB, x-fastest).
NX, NY, NZ = 101, 49, 31

# Polar receiver lattice for the BELLHOP TL solve (resampled to Cartesian after).
N_THETA = 181                  # bearings -90..90 deg (covers the whole box)
THETA_DEG = (-90.0, 90.0)
N_RANGE = 213                  # ranges 0..53 km (corner range ~ sqrt(50^2+12^2)=51.4)
RANGE_KM = (0.0, 53.0)
N_RD = 61                      # receiver depths 0..3000 m
RD_M = (0.0, 3000.0)

TL_SHADOW = 120.0              # dB floor assigned to unreachable / sub-seabed nodes
RAY_MAX_PTS = 120              # downsample target per ray

BIN = str(Path.home() / ".local/bin/bellhop3d.exe")
HERE = Path(__file__).resolve().parent
RUN_DIR = HERE / "_run"
DATA_DIR = HERE.parent / "data"


# --------------------------------------------------------------------------
# Analytic scenario fields
# --------------------------------------------------------------------------
def sound_speed(z):
    """c(z) in m/s; z in metres (downward positive)."""
    z = np.asarray(z, dtype=float)
    return np.where(z <= 200.0, 1520.0 - 0.10 * z, 1500.0 + 0.018 * (z - 200.0))


def bathymetry(x_km, y_km):
    """Seabed depth D(x,y) in metres; x_km,y_km in km."""
    x = np.asarray(x_km, dtype=float)
    y = np.asarray(y_km, dtype=float)
    d = (2500.0
         - 1500.0 * np.exp(-(((x - 18.0) / 2.5) ** 2 + ((y - 12.0) / 3.0) ** 2))
         - 1900.0 * np.exp(-(((x - 34.0) / 2.0) ** 2 + ((y - 9.0) / 2.5) ** 2)))
    return d


# --------------------------------------------------------------------------
# BELLHOP3D input file writers
# --------------------------------------------------------------------------
def write_bty(path: Path, dx_km=0.25, dy_km=0.25):
    """3D bathymetry grid (interp 'RS'); depth matrix is ny rows x nx cols.

    The grid extends a margin BEYOND the domain/trace-box on every side so the
    source (x=0 edge) and far rays never sit on the bathy boundary -- otherwise
    BELLHOP's GetBotSeg3D reports "Bathymetry undefined below the ray" and kills
    the ray at step 1. D(x,y) is analytic, so extrapolating the margin is exact.
    """
    xs = np.arange(-3.0, X_MAX_KM + 4.0 + 1e-9, dx_km)   # -3 .. 54 km
    ys = np.arange(-4.0, Y_MAX_KM + 6.0 + 1e-9, dy_km)   # -4 .. 30 km
    # bathymetry(x,y) broadcast to (ny, nx): row=y, col=x
    Z = bathymetry(xs[None, :], ys[:, None])
    with path.open("w") as f:
        f.write("'RS'\n")
        f.write(f"{len(xs)}\n")
        f.write(" ".join(f"{v:.4f}" for v in xs) + "\n")
        f.write(f"{len(ys)}\n")
        f.write(" ".join(f"{v:.4f}" for v in ys) + "\n")
        for row in Z:
            f.write(" ".join(f"{v:.3f}" for v in row) + "\n")


def _runtype(kind: str) -> str:
    """6-char run-type token with dimensionality digit '3' at column 6."""
    if kind == "tl":
        return "CB   3"   # Coherent, Gaussian beams (Cartesian), 3D
    if kind == "ray":
        return "R    3"   # Ray trace, 3D
    raise ValueError(kind)


def write_env(path: Path, n_elev: int, n_azim: int, freq: float, kind: str):
    """Write a BELLHOP3D .env for a TL ('tl') or ray ('ray') run."""
    sx, sy, sz = SRC
    # c(z) sample nodes that reproduce the piecewise-linear profile exactly.
    ssp_nodes = [(0.0, float(sound_speed(0.0))),
                 (200.0, float(sound_speed(200.0))),
                 (Z_MAX_M, float(sound_speed(Z_MAX_M)))]
    lines = []
    lines.append(f"'uwa-ray-bench {kind} {n_elev}x{n_azim} {freq:g}Hz'")
    lines.append(f"{freq:g}")
    lines.append("1")                       # NMEDIA
    lines.append("'CVW'")                    # C-linear, vacuum top, dB/lambda
    lines.append(f"0  0.0  {Z_MAX_M:g}")     # NMESH(auto) SIGMA depth
    for z, c in ssp_nodes:
        lines.append(f"   {z:g}  {c:.4f} /")
    lines.append("'A~' 0.0")                 # acousto-elastic half-space + bathy
    lines.append(f"{Z_MAX_M:g}  {SEABED_CP:g}  {SEABED_CS:g}  {SEABED_RHO:g}  {SEABED_ALPHA:g} /")
    # --- source coordinates ---
    lines.append("1")
    lines.append(f"{sx:g} /")                # Sx km
    lines.append("1")
    lines.append(f"{sy:g} /")                # Sy km
    lines.append("1")
    lines.append(f"{sz:g} /")                # source depth m
    # --- receivers ---
    if kind == "tl":
        lines.append(f"{N_RD}")
        lines.append(f"{RD_M[0]:g} {RD_M[1]:g} /")
        lines.append(f"{N_RANGE}")
        lines.append(f"{RANGE_KM[0]:g} {RANGE_KM[1]:g} /")
        lines.append(f"{N_THETA}")
        lines.append(f"{THETA_DEG[0]:g} {THETA_DEG[1]:g} /")
    else:  # ray run: receivers are irrelevant to ray geometry -> minimal lattice
        lines.append("1")
        lines.append(f"{RCV[2]:g} /")
        lines.append("1")
        lines.append(f"{RCV[0]:g} /")
        lines.append("1")
        lines.append("0 /")
    # --- run type + beam fan + box ---
    lines.append(f"'{_runtype(kind)}'")
    lines.append(f"{n_elev}")
    lines.append(f"{ELEV_DEG[0]:g} {ELEV_DEG[1]:g} /")
    lines.append(f"{n_azim}")
    lines.append(f"{AZIM_DEG[0]:g} {AZIM_DEG[1]:g} /")
    # STEP(0=auto) Box%x Box%y Box%z  (generous box so rays are not clipped early)
    lines.append("0  55.0 28.0 3100.0")
    path.write_text("\n".join(lines) + "\n")


def run_bellhop(fileroot: Path):
    """Invoke bellhop3d.exe <fileroot>; raise on failure (with .prt tail)."""
    proc = subprocess.run([BIN, fileroot.name], cwd=fileroot.parent,
                          capture_output=True, text=True)
    prt = fileroot.with_suffix(".prt")
    tail = prt.read_text()[-1500:] if prt.exists() else "(no .prt)"
    if proc.returncode != 0 or "Fatal" in (proc.stdout + proc.stderr):
        raise RuntimeError(f"bellhop3d failed ({fileroot.name}):\n{proc.stdout}\n{proc.stderr}\n--- prt tail ---\n{tail}")
    return proc


# --------------------------------------------------------------------------
# Output parsers (binary .shd, ASCII .ray) -- formats from the toolbox readers
# --------------------------------------------------------------------------
def read_shd(path: Path):
    """Parse a BELLHOP3D binary shade file.

    Returns (theta_deg, ranges_m, rd_m, pressure[Ntheta, Nrd, Nrr] complex).
    Layout per read_shd_bin.m: recl(int32 #floats/record); header records
    1..10; data record (10 + itheta*Nrd + irz) holds 2*Nrr float32 (re,im).
    Nsx=Nsy=Nsz=1 here.
    """
    raw = np.fromfile(path, dtype=np.int32)
    recl = int(raw[0])                       # floats per record
    f32 = raw.view(np.float32)
    i32 = raw

    def rec_i32(rec, off, n):
        return i32[rec * recl + off: rec * recl + off + n]

    def rec_f64(rec, off, n):
        # float64 view aligned to the record start
        b = raw[rec * recl: rec * recl + recl].tobytes()
        return np.frombuffer(b, dtype=np.float64, count=n, offset=off * 4)

    # record 3 (index 2): Nfreq Ntheta Nsx Nsy Nsz Nrz Nrr (int32), freq0 atten (f64)
    Nfreq, Ntheta, Nsx, Nsy, Nsz, Nrz, Nrr = (int(v) for v in rec_i32(2, 0, 7))
    # record 5 (index 4): theta (f64)
    theta = rec_f64(4, 0, Ntheta)
    # record 9 (index 8): r.z (f32);  record 10 (index 9): r.r (f64)
    rd = f32[8 * recl: 8 * recl + Nrz].astype(float)
    rr = rec_f64(9, 0, Nrr)
    # data
    press = np.empty((Ntheta, Nrz, Nrr), dtype=np.complex64)
    for it in range(Ntheta):
        for iz in range(Nrz):
            rec = 10 + (it * Nsz * Nrz) + iz   # Nsz=1
            seg = f32[rec * recl: rec * recl + 2 * Nrr]
            press[it, iz, :] = seg[0::2] + 1j * seg[1::2]
    return theta, rr, rd, press


def read_ray3d(path: Path):
    """Parse a BELLHOP3D ASCII ray file.

    Returns (nalpha, nbeta, rays) where rays is a list of dicts
    {xyz:(N,3) metres, ntop:int, nbot:int}, in fan order (beta outer, alpha inner).

    Header: TITLE / FREQ / Nsx Nsy Nsz / Nalpha Nbeta / DEPTHT / DEPTHB / Type.
    Per beam: alpha0 / nsteps NumTopBnc NumBotBnc / then nsteps rows of x y z.
    """
    toks = path.read_text().split("\n")
    it = iter(toks)
    next(it)  # TITLE line (skip)
    stream = " ".join(list(it)).split()
    p = 0

    def take(n):
        nonlocal p
        vals = stream[p:p + n]
        p += n
        return vals

    take(1)                                   # FREQ
    take(3)                                    # Nsx Nsy Nsz
    nalpha, nbeta = (int(v) for v in take(2))
    take(2)                                    # DEPTHT DEPTHB
    # Type token (e.g. 'xyz') -- a quoted string; consume tokens until closing quote.
    tok = take(1)[0]
    while not (tok.endswith("'") and len(tok) > 1):
        tok = take(1)[0]

    rays = []
    nbeams = nalpha * nbeta
    for _ in range(nbeams):
        if p >= len(stream):
            break
        take(1)                                # alpha0
        nsteps = int(take(1)[0])
        ntop, nbot = (int(v) for v in take(2))
        flat = take(3 * nsteps)
        arr = np.array(flat, dtype=float).reshape(nsteps, 3)
        rays.append({"xyz": arr, "ntop": ntop, "nbot": nbot})
    return nalpha, nbeta, rays


# --------------------------------------------------------------------------
# Resampling polar TL -> Cartesian comparison grid
# --------------------------------------------------------------------------
def polar_tl_to_cartesian(theta_deg, ranges_m, rd_m, press):
    """Trilinear-interpolate TL(theta,range,depth) onto the 101x49x31 grid.

    Source at (SRC.x, SRC.y); bearing/range computed relative to it. Nodes whose
    bearing/range fall outside the polar lattice, or below the seabed, -> TL_SHADOW.
    Returns Float32 array, x-fastest flat order (length NX*NY*NZ).
    """
    amp = np.abs(press).astype(np.float64)
    with np.errstate(divide="ignore"):
        tl = -20.0 * np.log10(np.maximum(amp, 1e-30))
    tl = np.clip(np.nan_to_num(tl, nan=TL_SHADOW, posinf=TL_SHADOW, neginf=TL_SHADOW),
                 0.0, TL_SHADOW)               # tl shape (Ntheta, Nrd, Nrr)

    th = np.asarray(theta_deg, float)
    rr = np.asarray(ranges_m, float)
    zz = np.asarray(rd_m, float)

    xs = np.linspace(0.0, X_MAX_KM, NX) * 1000.0
    ys = np.linspace(0.0, Y_MAX_KM, NY) * 1000.0
    zs = np.linspace(0.0, Z_MAX_M, NZ)
    sx, sy = SRC[0] * 1000.0, SRC[1] * 1000.0

    out = np.full((NX, NY, NZ), TL_SHADOW, dtype=np.float64)
    seabed = bathymetry(xs[:, None] / 1000.0, ys[None, :] / 1000.0)  # (NX,NY) metres

    def axis_idx(grid, q):
        """fractional index of q along monotonic-increasing grid, clamped."""
        i = int(np.searchsorted(grid, q) - 1)
        i = min(max(i, 0), len(grid) - 2)
        frac = (q - grid[i]) / (grid[i + 1] - grid[i])
        return i, min(max(frac, 0.0), 1.0)

    for ix, x in enumerate(xs):
        dx = x - sx
        for iy, y in enumerate(ys):
            dy = y - sy
            rng = math.hypot(dx, dy)
            brg = math.degrees(math.atan2(dy, dx))
            if rng < rr[0] or rng > rr[-1] or brg < th[0] or brg > th[-1]:
                continue
            it, ft = axis_idx(th, brg)
            ir, fr = axis_idx(rr, rng)
            zcap = seabed[ix, iy]
            for iz, z in enumerate(zs):
                if z > zcap:
                    continue                   # below seabed -> shadow
                iz0, fz = axis_idx(zz, z)
                c000 = tl[it, iz0, ir];        c100 = tl[it + 1, iz0, ir]
                c010 = tl[it, iz0 + 1, ir];    c110 = tl[it + 1, iz0 + 1, ir]
                c001 = tl[it, iz0, ir + 1];    c101 = tl[it + 1, iz0, ir + 1]
                c011 = tl[it, iz0 + 1, ir + 1]; c111 = tl[it + 1, iz0 + 1, ir + 1]
                c00 = c000 * (1 - ft) + c100 * ft
                c01 = c001 * (1 - ft) + c101 * ft
                c10 = c010 * (1 - ft) + c110 * ft
                c11 = c011 * (1 - ft) + c111 * ft
                c0 = c00 * (1 - fz) + c10 * fz
                c1 = c01 * (1 - fz) + c11 * fz
                out[ix, iy, iz] = c0 * (1 - fr) + c1 * fr

    # x-fastest flat order: index = ix + NX*(iy + NY*iz)
    return np.ascontiguousarray(out.transpose(2, 1, 0).ravel(), dtype=np.float32)


# --------------------------------------------------------------------------
# Ray travel-time + quantized packing
# --------------------------------------------------------------------------
def ray_traveltime(arr):
    """Cumulative travel time (s) along an (N,3) ray polyline in metres."""
    seg = np.diff(arr, axis=0)
    ds = np.linalg.norm(seg, axis=1)
    zmid = 0.5 * (arr[:-1, 2] + arr[1:, 2])
    cmid = sound_speed(zmid)
    dt = ds / cmid
    return np.concatenate([[0.0], np.cumsum(dt)])


def downsample_ray(arr, t, max_pts=RAY_MAX_PTS):
    n = len(arr)
    if n <= max_pts:
        return arr, t
    idx = np.unique(np.linspace(0, n - 1, max_pts).round().astype(int))
    return arr[idx], t[idx]


# .bin quantization box (metres)
QBOX = dict(xmin=0.0, xmax=X_MAX_KM * 1000.0,
            ymin=0.0, ymax=Y_MAX_KM * 1000.0,
            zmin=0.0, zmax=Z_MAX_M)


def quantize_xyz(arr):
    q = np.empty(arr.shape, dtype=np.int16)
    for k, (lo, hi) in enumerate([(QBOX["xmin"], QBOX["xmax"]),
                                  (QBOX["ymin"], QBOX["ymax"]),
                                  (QBOX["zmin"], QBOX["zmax"])]):
        v = np.clip((arr[:, k] - lo) / (hi - lo), 0.0, 1.0)
        q[:, k] = np.round(v * 65534.0 - 32767.0).astype(np.int16)
    return q


def write_bin(path: Path, n_elev, n_azim, freq, tl_flat, rays):
    """Write the per-stop .bin: [magic][u32 hdrlen][json hdr][TL f32][ray blocks].

    Ray block stream: for each ray, int32 npts, then npts*3 int16 xyz, then
    npts float32 time. Header carries the quantization box + grid metadata so the
    reference panel can decode without re-deriving constants.
    """
    rays_q, npts = [], []
    for r in rays:
        arr = r["xyz"]
        t = ray_traveltime(arr)
        a, t = downsample_ray(arr, t)
        rays_q.append((quantize_xyz(a), t.astype(np.float32)))
        npts.append(int(len(a)))

    header = {
        "format": "uwa-ray-bench reference .bin v1",
        "stop": {"elev": n_elev, "azim": n_azim},
        "freq_hz": freq,
        "grid": {"nx": NX, "ny": NY, "nz": NZ, "order": "x-fastest",
                 "x_km": [0, X_MAX_KM], "y_km": [0, Y_MAX_KM], "z_m": [0, Z_MAX_M],
                 "units": "dB", "tl_shadow": TL_SHADOW},
        "quant_box_m": QBOX,
        "n_rays": len(rays_q),
        "ray_pts": npts,
        "source": {"x_km": SRC[0], "y_km": SRC[1], "z_m": SRC[2]},
        "receiver": {"x_km": RCV[0], "y_km": RCV[1], "z_m": RCV[2]},
    }
    hdr = json.dumps(header).encode("utf-8")
    with path.open("wb") as f:
        f.write(b"URB1")
        f.write(np.uint32(len(hdr)).tobytes())
        f.write(hdr)
        f.write(tl_flat.astype("<f4").tobytes())
        for q, t in rays_q:
            f.write(np.int32(len(q)).tobytes())
            f.write(q.astype("<i2").tobytes())
            f.write(t.astype("<f4").tobytes())
    return header


# --------------------------------------------------------------------------
# Per-stop driver
# --------------------------------------------------------------------------
def compute_stop(n_elev, n_azim, freq, tag=None):
    """Run TL + ray solves for one stop; write the .bin; return summary dict."""
    tag = tag or f"{n_elev}x{n_azim}"
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    bty = RUN_DIR / "scenario.bty"
    if not bty.exists():
        write_bty(bty)

    # --- TL run ---
    tl_root = RUN_DIR / f"tl_{tag}"
    (tl_root.parent / f"{tl_root.name}.bty").write_bytes(bty.read_bytes())
    write_env(tl_root.with_suffix(".env"), n_elev, n_azim, freq, "tl")
    run_bellhop(tl_root)
    theta, rr, rd, press = read_shd(tl_root.with_suffix(".shd"))
    tl_flat = polar_tl_to_cartesian(theta, rr, rd, press)

    # --- ray run ---
    ray_root = RUN_DIR / f"ray_{tag}"
    (ray_root.parent / f"{ray_root.name}.bty").write_bytes(bty.read_bytes())
    write_env(ray_root.with_suffix(".env"), n_elev, n_azim, freq, "ray")
    run_bellhop(ray_root)
    _, _, rays = read_ray3d(ray_root.with_suffix(".ray"))

    out = DATA_DIR / f"{n_elev}x{n_azim}.bin"
    write_bin(out, n_elev, n_azim, freq, tl_flat, rays)

    # TL(R): nearest comparison-grid node to R
    tl_grid = tl_flat.reshape(NZ, NY, NX)
    ix = int(round(RCV[0] / X_MAX_KM * (NX - 1)))
    iy = int(round(RCV[1] / Y_MAX_KM * (NY - 1)))
    iz = int(round(RCV[2] / Z_MAX_M * (NZ - 1)))
    tl_R = float(tl_grid[iz, iy, ix])
    insonified = float(np.mean(tl_flat < TL_SHADOW))

    return {"stop": f"{n_elev}x{n_azim}", "freq_hz": freq, "file": out.name,
            "bytes": out.stat().st_size, "n_rays": len(rays),
            "tl_R_dB": round(tl_R, 2), "insonified_frac": round(insonified, 4)}


# --------------------------------------------------------------------------
# Validation: pure refraction must stay in its launch vertical plane
# --------------------------------------------------------------------------
def validate_inplane(freq):
    """Spec check: a purely refractive ray stays in its LAUNCH vertical plane.

    Out-of-plane distance of a point is its perpendicular offset from the
    vertical plane through the source at the ray's launch bearing beta:
        perp = |(x-sx)*sin(beta) - (y-sy)*cos(beta)|.
    For rays that never reflect off the seabed (nbot==0) this must be ~0 (only
    numerical noise); rays WITH bottom bounces may leave the plane (the genuine
    3D effect). Fan order is beta-outer / alpha-inner, so we recover each ray's
    beta from its index.
    """
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    bty = RUN_DIR / "scenario.bty"
    if not bty.exists():
        write_bty(bty)
    ray_root = RUN_DIR / "validate_ray"
    (ray_root.parent / f"{ray_root.name}.bty").write_bytes(bty.read_bytes())
    write_env(ray_root.with_suffix(".env"), CANON_ELEV, CANON_AZIM, freq, "ray")
    run_bellhop(ray_root)
    nalpha, nbeta, rays = read_ray3d(ray_root.with_suffix(".ray"))

    sx_m, sy_m = SRC[0] * 1000.0, SRC[1] * 1000.0
    betas = np.linspace(AZIM_DEG[0], AZIM_DEG[1], nbeta)
    perp_norefl, perp_withrefl, max_range = 0.0, 0.0, 0.0
    for i, r in enumerate(rays):
        arr = r["xyz"]
        beta = math.radians(betas[i // nalpha])
        perp = np.abs((arr[:, 0] - sx_m) * math.sin(beta)
                      - (arr[:, 1] - sy_m) * math.cos(beta))
        pmax = float(np.max(perp))
        max_range = max(max_range, float(np.max(arr[:, 0])) / 1000.0)
        if r["nbot"] == 0:
            perp_norefl = max(perp_norefl, pmax)
        else:
            perp_withrefl = max(perp_withrefl, pmax)
    return {"max_outplane_no_bottom_bounce_m": round(perp_norefl, 4),
            "max_outplane_with_bottom_bounce_m": round(perp_withrefl, 1),
            "max_range_reached_km": round(max_range, 2),
            "n_rays": len(rays),
            "note": "in-plane drift ~0 validates refraction; out-of-plane "
                    "with bottom bounce is the genuine 3D effect"}


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="BELLHOP3D reference precompute")
    ap.add_argument("--stop", default=f"{CANON_ELEV}x{CANON_AZIM}",
                    help="single stop 'ELExAZ' (default canonical 41x31)")
    ap.add_argument("--freq", type=float, default=DEFAULT_FREQ)
    ap.add_argument("--all", action="store_true", help="compute all 25 stops")
    ap.add_argument("--freq-compare", action="store_true",
                    help="canonical stop at 50 and 100 Hz; print TL(R) + insonified")
    ap.add_argument("--validate", action="store_true",
                    help="in-plane (pure-refraction) sanity check at canonical")
    args = ap.parse_args()

    if not Path(BIN).exists():
        sys.exit(f"bellhop3d.exe not found at {BIN}")

    if args.freq_compare:
        for fq in (50.0, 100.0):
            print(json.dumps(compute_stop(CANON_ELEV, CANON_AZIM, fq, tag=f"canon_{int(fq)}")))
        return

    if args.validate:
        print(json.dumps(validate_inplane(args.freq), indent=2))
        return

    if args.all:
        manifest = {"canonical": f"{CANON_ELEV}x{CANON_AZIM}", "freq_hz": args.freq,
                    "grid": {"nx": NX, "ny": NY, "nz": NZ, "order": "x-fastest"},
                    "elev_stops": ELEV_STOPS, "azim_stops": AZIM_STOPS, "stops": []}
        for ne in ELEV_STOPS:
            for na in AZIM_STOPS:
                s = compute_stop(ne, na, args.freq)
                manifest["stops"].append(s)
                print(json.dumps(s))
        (DATA_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
        print(f"wrote {DATA_DIR/'manifest.json'}")
        return

    ne, na = (int(v) for v in args.stop.lower().split("x"))
    print(json.dumps(compute_stop(ne, na, args.freq), indent=2))


if __name__ == "__main__":
    main()
