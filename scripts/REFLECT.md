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
- `globe-boundary.mjs`: validated loader and source-grid interpolation at startup.
- `assets/data/reflect/boundary-*.bin`: compact surface input maps and source mask.
- `boundary-conditions.json`: format, coordinates, scales and pinned provenance.
- `scripts/build_reflect_boundary_conditions.py`: offline NumPy/NetCDF conversion.

## Grid and geography

Default ~100 km spacing gives 200 latitude rows and 50,932 cells. Reduced
longitude counts towards the poles avoid tiny polar cells. Areas use exact
spherical cell boundaries and double precision. Every global mean is area weighted.
Earth radius is 6,371 km; 200 and 400 km options reduce computation further.

Boundary data comes from SpeedyWeatherAssets commit
`e46cdef753200df4b1a9600ce0634ede80a6a19f`. The static 720×360 half-degree raster
contains high/low vegetation fractions, their leaf-area indices, and elevation.
The packed mask samples the asset's actual 0.1° binary land mask. Monthly fields
retain the source's 96×48 Gaussian grid: swl1, swl2, land-surface temperature,
snow mass, sea-ice concentration and SST. The loaded SST plane is currently unused;
the globe's temperature baseline remains prescribed, not an SST observation.
The old Natural Earth mask/generator remains an unused legacy resource.

Each model cell samples static fields and the mask at its centre. Vegetation
fractions are clamped and overlapping totals are normalised while preserving
their ratio. Elevation is in metres: the source history explicitly divided by
gravity, despite a stale geopotential units attribute. C45 multiplies height by
gravity itself. Snow mass is divided by 1000 kg/m³ for water-equivalent metres.

Monthly inputs use bilinear weights on the actual source latitudes and wrap
longitude. Missing samples are excluded and remaining weights renormalised.
Wholly missing coast/island stencils use the nearest valid source node on a sphere,
cached by nearest source node and field/month. The inspector labels both coastal
renormalisation and nearest-source fallback. Coarse source fields cannot resolve
all ~100 km geography, especially small islands; no extra observational detail
is created by interpolation. Polar queries clamp to the nearest source latitude.

At startup, the current and next month are interpolated using the fraction of
calendar days elapsed since the first of the month, matching SpeedyWeather's
initialisation convention. These input fields stay fixed through the experiment
unless the user explicitly paints or edits the land inputs. The original maps
and reference coefficients always remain unchanged.
Surface colours are derived from dominant vegetation and snow/ice cover; ocean
colours blend continuously with the sourced fractional sea ice. The seed only
changes the illustrative atmospheric scattering pattern, not geographic inputs.

**Land albedo still uses the supplied learned C45 equations.** The prescribed
`albedo.nc` map is never loaded. Moisture uses SpeedyWeather's swl1/swl2 two-layer
initialisation. No separate deep-soil or 2 m temperature is present in this bundle:
land-surface temperature supplies both soil-temperature inputs and the `t2m`
proxy. These are explicit modelling approximations, shown in the inspector and
science dialog. The source inputs are climatologies, not live current conditions.
The unchanged 280 ppm reference uses the same initialised maps as the experiment.

The manifest records layouts, quantisation scales and SHA-256 provenance. Rebuild
with `python scripts/build_reflect_boundary_conditions.py /path/to/netcdf/files`,
using NumPy and netCDF4 in an isolated offline conversion environment. The browser
loads native binary arrays with no NetCDF/Julia/Python dependency. Data attribution
is bundled: SpeedyWeatherAssets EUPL-1.2 and ECMWF ERA5 vegetation CC BY 4.0.

## Surface drawing and vegetation experiments

“04 Paint a response” now paints physical land inputs rather than only prescribed
albedo. Choose a brush, select **Draw surface**, and drag on the globe. Changing
the brush dropdown selects drawing automatically. **Focus Amazon** centres
5°S, 62°W and holds the globe's decorative rotation while drawing. Physics can
continue integrating; pausing lets users compare radiation at the same season.

The spherical brush has a truncated Gaussian weight, strongest at its centre and
zero at its radius. It respects the original land/ocean mask and longitude seam.
It visits only intersecting latitude rows and evaluates the angular distance
only for candidates inside the circle.

| Brush | Physical edit at full centre weight |
| --- | --- |
| Low vegetation | Transfer high cover to low, preserving total cover; high LAI → 0, low LAI → 2 m²/m² |
| High vegetation | Transfer low cover to high, preserving total cover; low LAI → 0, high LAI → 5 m²/m² |
| Bare ground | High/low cover and both LAIs → 0 |
| Add snow | Snow depth → at least 0.15 m water equivalent |
| Raise/lower terrain | Elevation ±100 m, bounded to 0–9000 m |

Targets are blended by Gaussian weight, so repeated strokes approach the preset.
Elevation increments accumulate. Vegetation conversion needs existing cover;
planting on a bare tile is possible by setting its cover in **Tile inputs**.
The LAI targets are illustrative brush presets, not sourced observations.
Snow, soil moisture and temperature are preserved by the vegetation brushes.
Elevation changes C45's physical elevation input; the displayed sphere is not
deformed and there is no spherical terrain-shadow model.

**Amazon example:** choose Low vegetation, click Focus Amazon and draw over the
forest. Watch **Sunlight forcing** for the area-weighted change in absorbed
radiation, and run the climate to follow FaIR's temperature response. Inspect a
tile to compare its current and original high/low cover, current C45 albedo and
local absorbed-sunlight change. This is the albedo contribution to a land-cover
experiment; it excludes carbon release, evapotranspiration and ecosystem feedbacks.

The tile dialog also edits high/low cover, leaf area, elevation and snow exactly.
Cover must total at most 100%; ocean tiles disable this form. Unsaved form values
survive running climate snapshots. Applying physical surface inputs clears a
manual albedo override for that land tile so learned C45 actually supplies the
new reflection. Direct albedo and scattering brushes remain in the dropdown.

Each changed land tile recalculates only its cached C45 broadband BRDF
coefficients and visual classification. The worker retains bounded copies of
the original Float32 land inputs and Float64 coefficients for reference radiation
and restoration, adding about 1 MiB at 100 km. It transfers a new ~50 KiB
classification array only when surface inputs change. Surface textures are
invalidated on these edits, with no re-upload during ordinary display rotation.
Drawing keeps one brush edit in flight and coalesces additional pointer samples
to the newest pending position; it does not create an unbounded worker queue.

**Restore tiles** restores the original land inputs, learned coefficients,
classification, albedo scheme and scattering in the patch. Edits and restoration
recalculate radiation immediately, preserving thermal states, integrated heat,
time and bounded climate history. The reference annual and seasonal climate
are never recalibrated to follow an edited surface.

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
The small grid quadrature offset is removed so the prescribed annual global
baseline is exactly 14°C. This value is an illustrative model reference, not a
calibration to observed contemporary global temperature.

Reference annual absorbed sunlight is estimated with 48 samples. The periodic
seasonal state is solved analytically at startup, then integrated daily:

```
Cs dTseason/dt = ASRreference − annualMeanASRreference − λcentral Tseason
```

A separate local single-layer anomaly supplies an approximate regional pattern,
using prescribed capacities 2.1e8 J/m²/K over ocean/ice and 2e7 over land. Its
area mean is removed and replaced by FaIR's central global surface anomaly.
The **seasonal regional response is centred in the same way**: its area mean
is removed, and a separate central three-layer FaIR response supplies the global
reference season. Its forcing is areaMean(ASRreference) minus the reference
annual mean. The 48 annual radiation samples also initialise this periodic
three-layer state by solving `(I − Ayear) Tstart = byear`; no multi-year spin-up
or retained per-cell history is needed. It then uses cached daily transitions.

The global absolute temperature is exactly 14°C plus the global reference
season and central CO₂/albedo response. The map, inspector and scalar tracker
share that same mean. Scenario global temperatures share the same reference.
The regional map is not a spatial FaIR model or resolved circulation; its simple
local buckets can still exaggerate regional seasonal amplitudes.

Main imbalance reports the change from the reference; total imbalance includes
reference seasonal storage. Heat change is the exact change in reference seasonal
FaIR heat plus the central perturbation FaIR layers' heat content, converted to ZJ.
Local reference fluxes use the centred seasonal pattern and global FaIR season,
so their area mean agrees with the global reference imbalance. The trailing
366-day mean uses integrated net fluxes. Monthly scalar history is capped at
1,200 records; CSV exports use ECS-envelope labels and append the current state.
No dynamic heat transport, ice feedback, interactive clouds or carbon cycle is
included. These assumptions are also visible in the app's “How it works” dialog.

## Lightweight implementation

Numerical state occupies roughly 11 MiB at 100 km, excluding transient graph
construction, browser overhead and render buffers. FaIR adds only twelve thermal
states and four small cached matrices. C45 inputs and BRDF coefficients are retained only for land cells; fractional ice and coastal flags
are small per-cell arrays. Source data totals 2,251,152 bytes and is released after
startup sampling and coefficient caching. No per-cell timestep history is retained.
Five Float32 fields form each ~1 MiB transferable snapshot, returned to a small
pool. At most one advance is in flight, with batches capped at eight requested
days. Worker snapshots and DOM updates target at most 12 per second; display
rotation is capped near 30 fps and needs no texture upload on the surface view.
Slower devices can run below the selected playback speed without skipping daily
physics. Hidden pages pause; restart/page exit terminates the worker.

Native WebGL uses one shader and a 720×360 texture. Pixel count is capped at
1.2 million and DPR at 1.5. Canvas fallback ray-casts a reusable 512×384 image.
Paused views have no idle animation loop. No runtime libraries, remote textures,
API calls or uploads are needed; the compact boundary maps are same-origin static assets.

## Sources

- [FaIR 2.2.4 thermal source](https://github.com/OMS-NetZero/FAIR/blob/v2.2.4/src/fair/energy_balance_model.py)
- [FaIR n-layer example / parameter provenance](https://docs.fairmodel.net/en/v2.2.4/examples/n-layer-ebm.html)
- [Jin et al. (2011)](https://doi.org/10.1364/OE.19.026429)
- [Pinned SpeedyWeather source](https://github.com/SpeedyWeather/SpeedyWeather.jl/blob/b5eaa01a76d1ce6b083592a1e4c94f419385c77c/SpeedyWeather/src/parameterizations/albedo.jl)
- [Cox–Munk roughness and ocean formulation](https://gmd.copernicus.org/articles/11/321/2018/)
- [Pinned SpeedyWeatherAssets inputs](https://github.com/SpeedyWeather/SpeedyWeatherAssets/tree/e46cdef753200df4b1a9600ce0634ede80a6a19f/data/boundary_conditions)
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
