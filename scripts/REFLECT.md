# Reflect planet lab

`/reflect/` is a static browser energy balance explorer. The earlier terrain
experiment remains at `/reflect/terrain/`; see `REFLECT_TERRAIN.md`.

## Files

- `_pages/reflect.html`: controls and scientific explanation.
- `assets/css/reflect-globe.css`: viewport layout, with shared `reflect.css` styles.
- `assets/js/reflect/globe-model.mjs`: spherical grid, orbit, radiation,
  approximate regional temperature pattern, reference seasons and edits.
- `fair-ebm.mjs`: deterministic three-layer FaIR thermal equations in JavaScript.
- `jin-ocean.mjs`: Jin ocean albedo port from SpeedyWeather `gm/albedo`.
- `co2-baseline.mjs`: editable dated NOAA concentration snapshot.
- `globe-worker.mjs`: persistent worker, bounded batches, pooled snapshots.
- `globe-render.mjs`: native WebGL sphere and capped Canvas fallback.
- `globe-app.mjs`: playback, inspection, Gaussian brushes and CSV history.
- `model.mjs`: unchanged supplied C45 equations shared with the terrain lab.
- `assets/data/reflect/land-mask.bin`: packed Natural Earth coastline raster.
- `scripts/build_reflect_land_mask.py`: stdlib-only offline mask generator.

## Grid and geography

Default ~100 km spacing gives 200 latitude rows and 50,932 cells. Reduced
longitude counts towards the poles avoid tiny polar cells. Areas use exact
spherical cell boundaries and double precision. Every global mean is area weighted.
Earth radius is 6,371 km; 200 and 400 km options reduce computation further.

The land mask rasterises public-domain Natural Earth `ne_110m_land`, repository
v5.1.2, at 720 × 360 half-degree cell centres. It occupies 32,400 bytes, with
south-to-north rows and least-significant-bit-first packing. Each model cell
samples the mask at its centre. Major coastlines and islands are geographic;
narrow islands, inland waters and fractional coast cells are simplified.
`land-mask.json` records provenance. To rebuild, download the pinned GeoJSON and
run `python3 scripts/build_reflect_land_mask.py /path/ne_110m_land.geojson`.

Vegetation, snow, sea ice and physical C45 inputs are prescribed illustrative
fields. Polar ocean cells have fixed full ice cover; land temperatures and
vegetation are not observed maps. Seed varies prescribed input fields, not coastlines.

## Orbit, daily radiation and ocean reflection

Kepler's equation sets orbital speed and distance. Perihelion is near 3 January,
with fixed solar longitude 282.94°, eccentricity 0.0167, tilt 23.44° and period
365.2422 days. Changing eccentricity retains that period. Insolation is 1361/r²
W/m². Latitude-dependent daily means include polar day/night; a small spatial
quadrature correction gives exact global incoming S(r)/4.

The calendar begins in the visitor's current UTC season. Default playback is
one model year in ten seconds. Display rotation makes one turn per model year,
with ray-cast lighting kept in viewing coordinates. This is decorative: the
physics averages 24-hour rotation and is independent of display orientation.
Reduced-motion preferences disable automatic display rotation; selecting a
painting/inspection tool also holds the globe still.

C45 coefficients, normalisation and noise quadrature are unchanged. Broadband
BRDF coefficients are cached per land cell. Eight-point Gauss–Legendre daylight
quadrature averages irradiance-weighted black-sky kernels by latitude; diffuse
reflection uses white-sky kernels. Clamping the averaged land albedo rather than
each individual solar angle is a daily averaging approximation.

Jin et al. (2011) ocean reflection preserves the coefficients and defaults of
SpeedyWeather `gm/albedo`, commit `b5eaa01a76d1ce6b083592a1e4c94f419385c77c`:
refractive index 1.34, foam reflectance 0.55, volume scattering 0.006 and sea-ice
albedo 0.6. The module is an attributed EUPL-1.2 adaptation; its licence is bundled
as `assets/data/reflect/SpeedyWeather-EUPL-1.2.txt`.

Direct reflection is Fresnel reflectance minus the Jin roughness regression.
Diffuse reflection uses the branch's clear/isotropic expression; no cloud option
is enabled. The global 10 m wind dial defaults to 5 m/s. Unlike SpeedyWeather,
which expects an external roughness field, this app diagnoses the RMS slope
using Cox–Munk σ = sqrt(0.003 + 0.00512 U). Whitecaps occupy
clamp(2.95e-6 U^3.52, 0, 1). Volume scattering and foam are included in both direct
and diffuse components, then mixed with ice and bounded after the final mixture.
Eight-point daylight quadrature averages direct ocean albedo before mixing.
This is a broadband daily approximation, not a spectral ocean or wave model.
User albedo overrides replace both direct and diffuse reflectivities.

## Gaussian atmospheric scattering

The global dial multiplies a smooth heterogeneous field. Scattered fractions
are clamped to 0–0.95. Scattered irradiance evolves under the spherical heat
kernel for τ = (σ/R)² / 2, approaching a Gaussian of standard deviation σ.
Widths are 80–200 km; the discrete approximation is coarse at large cell spacing.

A finite-volume neighbor graph wraps longitude and joins overlapping intervals
on adjoining latitude rows. Every edge transfers equal and opposite power;
explicit substeps satisfy a positivity bound. This conserves the area integral
without storing a large Gaussian weight matrix. Scattering redistributes sunlight
and changes direct/diffuse surface reflection. It includes no clouds, atmospheric
absorption, backscatter to space or thermal diffusion.

## FaIR global thermal response

The JavaScript implementation uses FaIR 2.2.4's deterministic thermal equations,
specialised to three layers. It does not import the full Python model, carbon
cycle or stochastic forcing process. With time measured in model years:

```
F = 5.35 ln(CO₂ / 280) + areaMean(ASRexperiment − ASRreference)
C0 dT0/dt = F − λ T0 − k1(T0 − T1)
C1 dT1/dt = k1(T0 − T1) − ε k2(T1 − T2)
C2 dT2/dt = k2(T1 − T2)
N = F − λ T0 + (1 − ε) k2(T1 − T2)
λ = 5.35 ln(2) / ECS
```

Capacities `[3.62, 9.47, 98.66]` W yr/m²/K and exchanges `[2.39, 0.63]` W/m²/K
come from the HadGEM2-ES example in FaIR's n-layer documentation. This app changes
the example feedback to ECS 2.5, 3 and 4°C per doubling, and sets ε=1 for conservative
exchange. These illustrative configurations are not that model's calibration
or a posterior FaIR ensemble. The shaded range is a sensitivity scenario envelope,
not a probabilistic transient interval from IPCC percentiles.

Daily forcing is sampled at the midpoint. A cached 4×4 augmented matrix
exponential integrates the three-layer constant-forcing update exactly. The input
is the change in absorbed sunlight plus CO₂ forcing: evolving imbalance is never
fed back as an additional forcing. Surface edits and orbit changes retain the
unchanged reference and temperatures, so their forcing is not recalibrated away.

## Startup, seasons and regional temperatures

Automatic startup uses the dated NOAA global trend snapshot in
`co2-baseline.mjs`: 428.00 ppm for 9 October 2026, checked 10 October 2026.
The displayed date and “Recent” button refer to this bundled value; there is no
live request. Update that file and the HTML fallback when refreshing the value.

All three thermal layers start at equilibrium with the selected CO₂. This is an
idealised equilibrium-at-present-CO₂ experiment, not historical climate or observed
present-day warming. The unchanged 280 ppm reference uses the original surfaces,
wind, orbit and scattering. Its prescribed baseline is
Tbase = 14 − 40(sin²(latitude) − 1/3) °C, averaging near 14°C.

Reference annual absorbed sunlight is estimated with 48 samples. The periodic
seasonal state is solved analytically at startup, then integrated daily:

```
Cs dTseason/dt = ASRreference − annualMeanASRreference − λcentral Tseason
```

A separate local single-layer anomaly supplies an approximate regional pattern,
using prescribed capacities 2.1e8 J/m²/K over ocean/ice and 2e7 over land. Its
area mean is removed and replaced by FaIR's central global surface anomaly.
The regional map is not a spatial FaIR model or resolved circulation.
Absolute temperature is the reference baseline plus seasonal temperature and
this adjusted anomaly. Scenario global temperatures share the same reference.

Main imbalance reports the change from the reference; total imbalance includes
reference seasonal storage. Heat change is the exact change in reference seasonal
heat plus the central FaIR layers' heat content, converted to ZJ. The trailing
366-day mean uses integrated net fluxes. Monthly scalar history is capped at
1,200 records; CSV exports use ECS-envelope labels and append the current state.
No dynamic heat transport, ice feedback, interactive clouds or carbon cycle is
included. These assumptions are also visible in the app's “How it works” dialog.

## Lightweight implementation

Numerical state occupies roughly 10 MiB at 100 km, excluding transient graph
construction, browser overhead and render buffers. FaIR adds only nine thermal
states and three small cached matrices. No per-cell timestep history is retained.
Five Float32 fields form each ~1 MiB transferable snapshot, returned to a small
pool. At most one advance is in flight, with batches capped at eight requested
days. Worker snapshots and DOM updates target at most 12 per second; display
rotation is capped near 30 fps and needs no texture upload on the surface view.
Slower devices can run below the selected playback speed without skipping daily
physics. Hidden pages pause; restart/page exit terminates the worker.

Native WebGL uses one shader and a 720×360 texture. Pixel count is capped at
1.2 million and DPR at 1.5. Canvas fallback ray-casts a reusable 512×384 image.
Paused views have no idle animation loop. No runtime libraries, remote textures,
API calls or uploads are needed; the coastline mask is a tiny same-origin asset.

## Sources

- [FaIR 2.2.4 thermal source](https://github.com/OMS-NetZero/FAIR/blob/v2.2.4/src/fair/energy_balance_model.py)
- [FaIR n-layer example / parameter provenance](https://docs.fairmodel.net/en/v2.2.4/examples/n-layer-ebm.html)
- [Jin et al. (2011)](https://doi.org/10.1364/OE.19.026429)
- [Pinned SpeedyWeather source](https://github.com/SpeedyWeather/SpeedyWeather.jl/blob/b5eaa01a76d1ce6b083592a1e4c94f419385c77c/SpeedyWeather/src/parameterizations/albedo.jl)
- [Cox–Munk roughness and ocean formulation](https://gmd.copernicus.org/articles/11/321/2018/)
- [Natural Earth source](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson)
- [Natural Earth public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/)
- [NOAA global trend estimate](https://gml.noaa.gov/ccgg/trends/gl_trend.html)
- [Seasonal insolation](https://climlab.readthedocs.io/en/latest/api/climlab.radiation.insolation.html)
- [IPCC AR6 ECS assessment](https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/)
- [Logarithmic CO₂ forcing](https://archive.ipcc.ch/ipccreports/tar/wg1/222.htm)

## Local preview

```
bundle exec jekyll build
bundle exec jekyll serve
```

Open `http://127.0.0.1:4000/reflect/`. Module workers require HTTP.
