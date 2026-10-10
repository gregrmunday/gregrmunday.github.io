# Reflect planet lab

`/reflect/` is a static globe energy balance explorer. The previous terrain
experiment remains at `/reflect/terrain/`; see `REFLECT_TERRAIN.md`.

## Files

- `_pages/reflect.html`: globe page, controls, scientific explanation and sources.
- `assets/css/reflect-globe.css`: planet layout overrides; the terrain styles
  remain in `reflect.css`.
- `assets/js/reflect/globe-model.mjs`: grid, orbit, scattering, paired temperature
  integration, surface generation and edits.
- `globe-worker.mjs`: persistent numerical worker, bounded batches and pooled
  transferable snapshots.
- `globe-render.mjs`: native WebGL sphere and reusable Canvas 2D fallback.
- `globe-app.mjs`: interaction, playback, inspection, diagnostics and CSV.
- `model.mjs`: unchanged supplied C45 BRDF equations shared with the terrain lab.

## Grid and solar geometry

Default spacing is approximately 100 km, with 200 latitude rows and 50,932
cells. Reduced longitude counts towards the poles avoid tiny polar cells. Each
cell's area is computed from spherical latitude boundaries and longitude width;
its solid angle is stored in double precision. Every global mean is area weighted.
Continents, vegetation, sea ice and snow are generated illustrative fields,
not geospatial observations. Earth's radius is 6,371 km.

Kepler's equation determines orbital phase and distance. The calendar starts
near 1 January, with perihelion near 3 January and its solar longitude fixed at
282.94°. Defaults are eccentricity 0.0167, tilt 23.44° and a 365.2422-day period.
The orbital clock uses a fixed period when eccentricity changes. Solar irradiance
is 1361/r² W/m². Latitude-dependent daily insolation treats polar day and night;
a small quadrature correction gives an exact global incoming mean of S(r)/4.
Display illumination is decorative; physics uses 24-hour means, not a rotating
sub-daily atmosphere or a terrain horizon/shadow calculation.

For C45 land, unchanged supplied coefficients are combined into broadband BRDF
parameters once per cell. Eight-point Gauss–Legendre daylight quadrature computes
irradiance-weighted black-sky kernels by latitude. Band-combined daily black-sky
albedo is clamped after averaging; white-sky albedo uses the supplied kernels.
This daily averaging is an approximation to evaluating and clamping each
individual sun angle. Physical BRDF inputs, snow and ice remain prescribed;
simulated temperature does not automatically alter them. User overrides replace
both direct and diffuse surface reflectivity with one prescribed albedo.

## Gaussian scattering

The global scattering dial multiplies a heterogeneous per-cell field. The local
scattered fraction is clamped to 0–0.95; the rest remains direct sunlight. The
scattered irradiance field evolves under the spherical heat equation for
τ = (σ/R)² / 2, whose local kernel approaches a Gaussian of standard deviation σ.
Widths range from 80 to 200 km. This is a discrete Gaussian approximation,
particularly when its width is comparable to cell spacing.

A finite-volume neighbor graph connects zonal periodic cells and overlapping
longitude intervals on adjoining latitude rows. Every edge transfers equal and
opposite power. Explicit substeps satisfy a positivity bound based on the largest
diagonal transport rate. This conserves the area integral without a stored large
Gaussian weight matrix. There is no cloud model, atmospheric absorption,
backscatter, or thermal diffusion. The global scattering dial redistributes
incoming solar power and changes direct/diffuse surface reflection.

## Paired temperature integration and reference

The unmodified reference planet runs simultaneously at 280 ppm and fixed
Earth-like orbital/scattering settings. Its annual shortwave field is estimated
from 48 evenly spaced model-time quadrature samples. A prescribed baseline
T₀ = 14 − 40(sin²(latitude) − 1/3) °C has a global mean near 14°C. Reference
seasonal anomalies integrate a linear calibrated radiation law:

```
Cₛ dTseason/dt = ASRreference(day) − meanAnnualASRreference − λcentral Tseason
```

All scenario warming anomalies start at zero and integrate:

```
Cₛ dΔT/dt = ASRexperiment − ASRreference + 5.35 ln(CO₂ / 280) − λ ΔT
λ = 5.35 ln(2) / ECS
```

ECS scenarios are 2.5, 3 and 4°C per doubling. Each daily step samples shortwave
at its midpoint and integrates the linear temperature equation analytically.
Capacity is 2.1×10⁸ J/m²/K over initial ocean/ice cells and 2×10⁷ over land.
Capacity remains prescribed when albedo is edited. Changing playback speed
changes how many daily steps are requested, never the numerical timestep.

Absolute scenario temperature is T₀ + Tseason + ΔT. These are paired anomaly
models with a common evolving reference, not three full climate forecasts.
Their global range is a sensitivity envelope; using assessed ECS percentiles
does not make it a probabilistic transient temperature interval.

The main imbalance reports the perturbation from the unchanged reference.
Total global imbalance includes reference seasonal storage. Integrated stored
heat is computed exactly as Σ Cₛ ΔTtotal × cell area over each step and tracked
in ZJ. The trailing mean uses 366 daily integrated net fluxes, rather than sampling
instantaneous diagnostic flux. Monthly history is bounded to 1,200 entries
(about 100 years), and CSV exports label lower/upper columns as ECS envelopes.
The current state is appended to exports when between monthly records.

This reference calibration represents prescribed unresolved baseline processes;
it is not an observational Earth energy budget. No atmospheric/ocean circulation,
deep ocean, dynamic heat transport, ice feedback or carbon cycle is simulated.
Future temperature-goal gameplay can use the existing anomaly and local albedo
brushes, without confusing reference changes with real-world policy predictions.

## Performance

At 100 km spacing, retained numerical typed arrays total about 10.2 MiB in the
worker. This excludes transient construction arrays, browser/graphics overhead
and the main-thread snapshot/render buffers. Snapshots contain five Float32
fields per cell (about 1 MiB) and their buffers are returned to a small pool.
Worker batches are capped at eight requested days from the UI, with one advance
in flight. No per-cell timestep history is stored. The worker persists for the
running experiment and is terminated when regenerated or the page is left.

The globe uses one small native shader, a 720×360 texture and a reusable texture
lookup map. Canvas pixel count is capped at 1.2 million and device pixel ratio at
1.5. A ray-cast Canvas fallback has a capped 512×384 image and caches projection
geometry; it remains usable without WebGL. Updates happen when state or view
changes, with no idle animation loop. Hidden pages pause climate playback.
There are no runtime libraries, downloaded textures, APIs or uploads.

## Sources

- [Climlab insolation documentation](https://climlab.readthedocs.io/en/latest/api/climlab.radiation.insolation.html)
- [Climlab linear longwave formulation](https://climlab.readthedocs.io/en/stable/api/climlab.radiation.AplusBT.html)
- [IPCC AR6 assessed ECS](https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/)
- [IPCC logarithmic CO₂ forcing expression](https://archive.ipcc.ch/ipccreports/tar/wg1/222.htm)

## Local preview

```
bundle exec jekyll build
bundle exec jekyll serve
```

Open `http://127.0.0.1:4000/reflect/`. Module workers require HTTP.
