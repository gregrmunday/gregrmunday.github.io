# Reflectance

**Purpose:** demonstrate learned land-albedo sensitivity and its global climate response.
**Ethos:** explicit science, clear controls, lightweight native code, bounded memory;
optimize computation/rendering without weakening physics. Read the detailed docs below.

## Implemented

- ~100 km sphere; SpeedyWeatherAssets surfaces; eccentric orbit and hourly sunlight.
- Learned land albedo + Jin (2011) ocean/sea ice; monthly CACK land-albedo
  perturbations → area-weighted TOA forcing → calibrated three-layer FaIR.
- Matched control, response maps, eleven-input editor/sensitivity previews,
  Gaussian painting, undo/redo, saved setups, CSV and an attributed SVG diagram.
- Fixed dashboard without main-page/panel scrolling; details use native dialogs.
  Painting/inspection stays evenly lit; physical sunlight is unchanged.

## Preserve

- Say **learned albedo**; retain equations, coefficients, licences and attribution.
- Keep original surfaces/reference immutable and thermal history through edits.
  Control shares global settings; use spherical area weights, FaIR efficacy and
  centred regional patterns. Feed forcing into FaIR, not evolving imbalance.
- CACK screens land perturbations independently of scattering; never double-screen.
  Gaussian scattering conserves sunlight and does not represent interactive clouds.
- Label equilibrium startup, 14°C prescribed baseline, temperature proxies,
  approximate hourly kernels, unknown training ranges and sensitivity scenarios.
- Validate partial edits; preserve drafts, cover limits and selection. Saved
  setups start new runs. Keep raw CACK/NetCDF out of Git and the published site.

## Performance

- Native ES modules, typed arrays, one worker, WebGL/Canvas; no runtime libraries.
- Integrate every hour, output every 24; bounded batches/history/undo/previews,
  pooled frames, one advance/paint request in flight and stale-work cancellation.
- Reuse illumination for albedo edits; scattering edits retain the full solve.
- Optional 265-byte Float64 WASM scattering helper: fixed heap, JS fallback,
  ~2.1× local operator speedup (not a browser-wide claim); offline compiler only.
- Coalesce drawing independently of physics; cache BRDFs/textures, cap pixels/DPR,
  pause hidden pages and release workers/buffers. Never archive per-hour globe frames.

## Documentation

`scripts/REFLECT.md`: equations, caveats, provenance, memory limits and WASM build.
`scripts/REFLECT_NEXT.md`: progress/remaining work; `scripts/REFLECT_TERRAIN.md`: legacy terrain.
Main files: `_pages/reflect.html`, `assets/css/reflect-globe.css`, `globe-*.mjs` here.
**Cancelled offline simulations require a fresh user request before resuming.**
