# Reflectance

`/reflect/` is a static browser energy balance explorer. The earlier terrain
experiment remains at `/reflect/terrain/`; see `REFLECT_TERRAIN.md`.

## Files

- `_pages/reflect.html`: controls and scientific explanation.
- `assets/css/reflect-globe.css`: viewport layout, with shared `reflect.css` styles.
- `assets/js/reflect/globe-model.mjs`: spherical grid, orbit, radiation,
  approximate regional temperature pattern, reference seasons and edits.
- `fair-ebm.mjs`: deterministic three-layer FaIR thermal equations in JavaScript.
- `fair-calibration.mjs`: three pinned, jointly selected published thermal sets.
- `cack-kernel.mjs`: compact monthly CACK sampler and hourly weighting.
- `radiative-transfer.mjs`: illustrative two-stream baseline/comparison budget.
- `sensitivity.mjs`: bounded one-input radiation preview, independent of climate state.
- `assets/images/reflect-model.svg`: attributed, downloadable model diagram.
- `jin-ocean.mjs`: Jin ocean albedo port from SpeedyWeather `gm/albedo`.
- `co2-baseline.mjs`: editable dated NOAA concentration snapshot.
- `globe-worker.mjs`: persistent worker, bounded batches, pooled snapshots.
- `globe-render.mjs`: native WebGL sphere and capped Canvas fallback.
- `globe-app.mjs`: playback, inspection, Gaussian brushes and CSV history.
- `model.mjs`: unchanged supplied learned albedo equations shared with the terrain lab.
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
gravity, despite a stale geopotential units attribute. learned albedo multiplies height by
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

**Land albedo still uses the supplied learned equations.** The prescribed
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
Elevation changes learned albedo's physical elevation input; the displayed sphere is not
deformed and there is no spherical terrain-shadow model.

**Amazon example:** choose Low vegetation, click Focus Amazon and draw over the
forest. Watch **Sunlight forcing** for the area-weighted change in absorbed
radiation, and run the climate to follow FaIR's temperature response. Inspect a
tile to compare its current and original high/low cover, current learned albedo and
local absorbed-sunlight change. This is the albedo contribution to a land-cover
experiment; it excludes carbon release, evapotranspiration and ecosystem feedbacks.

The tile dialog edits all eleven learned albedo inputs independently: high/low cover,
high/low leaf area, elevation, snow depth, top/deep soil moisture, top/deep soil
temperature and near-surface air temperature. Moisture uses m³/m³ (0–1) and
temperature uses kelvin (150–350 K; 273.15 K = 0°C). These bounds are exploration
guardrails, not validated training ranges. Temperature edits change the albedo
inputs, not FaIR's thermal state; they remain fixed during climate integration.
The three temperature inputs initially share the sourced land-temperature proxy,
but editing one does not change either of the others. Top/deep moisture retain
the initial swl1/swl2 source convention.

Only changed fields are sent, so display rounding cannot rewrite any other input.
All eleven fields participate in coefficient invalidation and exact restoration,
including edits that leave the visual vegetation classification unchanged.
Cover must total at most 100%; ocean tiles disable this form. Unsaved form values
survive running climate snapshots. Applying physical surface inputs clears a
manual albedo override for that land tile so learned actually supplies the
new reflection. Direct albedo and scattering brushes remain in the dropdown.

Each changed land tile recalculates only its cached learned albedo broadband BRDF
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

## Orbit, hourly radiation and ocean reflection

Kepler's equation sets orbital speed and distance. Perihelion is near 3 January,
with fixed solar longitude 282.94°, eccentricity 0.0167, tilt 23.44° and period
365.2422 days. Changing eccentricity retains that period. Insolation is 1361/r²
W/m². One-hour steps evaluate each cell at the midpoint solar zenith angle,
including polar day/night. The subsolar longitude is `π − 2π × UTC_day_fraction`:
Greenwich solar noon is fixed at 12 UTC; the equation of time is omitted. A small
spatial quadrature correction makes global incoming exactly S(r)/4 while leaving
direct sunlight zero on the night side.

Regional albedo edits are weighted by their actual incoming sunlight and spherical
cell areas. learned albedo's black-sky reflection uses each hour's solar-zenith kernels;
the diffuse component uses white-sky reflection. Latitude, longitude, UTC hour
and season therefore affect the available sunlight and angular reflection.
Longitude shifts local solar time, so an edit's instantaneous forcing follows its
region into daylight and night. Sourced land inputs and scattering also vary
geographically. The visible annual viewing turn does not set physical irradiance.
A regional forcing comparison is
meaningful; the approximate regional temperature map is not a resolved circulation
or geographically calibrated climate-impact model.

The calendar begins in the visitor's current UTC season at 12 UTC. Playback
retains the one-year-in-ten-seconds target, with new 1-hour/s and 6-hour/s choices
and a **+1 hour** button. Every radiation and thermal step is one model hour;
faster playback changes how many steps are requested, never their duration.
Slower devices take longer than the selected target. The UTC clock and displayed
fields show the last published endpoint; integrated radiation uses hourly midpoints.
Automatic outputs occur at elapsed-hour multiples of 24. Map fields and temperatures are instantaneous
endpoint snapshots. The radiation budget separately offers the actual mean of
the last completed 24 hourly intervals, with its interval explicitly labelled. All intervening hours still contribute to
FaIR and accumulated heat. Pausing, edits, inspection, CSV export and manual
**+1 hour** steps force a fresh endpoint output. Daily snapshots sample the same
UTC hour, so the displayed terminator does not sweep through a diurnal cycle;
manual hour stepping exposes it.

Display orientation makes one decorative viewing turn per model year. The actual
day/night shading now uses the physical subsolar point in Earth coordinates in
both WebGL and Canvas; orbiting the camera does not move the Sun geographically.
Reduced-motion preferences disable automatic viewing rotation; selecting a
painting/inspection tool also holds the camera orientation still. Automatic
viewing rotation advances only with daily outputs; there is no continuous redraw
loop between them. Camera interaction redraws immediately.

learned albedo coefficients, normalisation and noise quadrature are unchanged. Broadband
BRDF coefficients are cached per land cell. Black-sky kernels use the hourly
zenith angle; diffuse reflection uses white-sky kernels. Direct/diffuse powers
are blended before clamping the final broadband albedo, following the supplied
learned albedo formulation. No daylight average replaces these runtime kernels.

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
Direct ocean reflectivity is linearly interpolated from a 4097-point cosine-zenith
lookup evaluated with the unchanged Jin equations at the prescribed wind. Keep
at most two tables (reference wind and current wind). This bounded numerical
approximation reduces per-cell exponentials; it is not a spectral wave model.
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
and changes direct/diffuse surface reflection. The Gaussian operator itself includes no clouds or thermal diffusion. The
separate radiation transfer schemes handle prescribed atmospheric screening;
CACK does not derive screening from this scattering dial.

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

Thermal parameters now come from published FaIR calibration 1.4.1, pinned at
`4c6571c712693b5355df4b818730c7a3fab2144a`. Sets 1235755, 528199 and 1358225
retain their feedback, all three capacities, both exchanges and deep-ocean efficacy
**together**, giving ECS 2.4904, 2.9964 and 4.0033°C under Reflectance's forcing form.
The source's complete carbon-cycle parameters, stochastic configuration,
`forcing_4co2`, forcing scale and historical forcing are not used. These thermal
subsets do not reproduce the full calibrated FaIR posterior. The envelope is a
sensitivity scenario range, not a probabilistic IPCC transient interval.

`scripts/build_reflect_fair.py` reproduces the selection from the pinned CSV,
checking its SHA-256. For each target ECS 2.5/3/4, take the twenty closest rows
under `5.35 ln(2) / ocean_heat_transfer[0]`; minimise squared ECS error divided
by 0.04² plus squared log deviations from the table-wide medians of each
capacity, exchange and efficacy. Selection is an explicit representative heuristic,
not a new statistical calibration. Source attribution and the upstream Apache 2.0
licence are bundled; the browser loads only the three small numeric sets.

Hourly forcing is sampled at the midpoint. A cached 4×4 augmented matrix
exponential integrates the three-layer constant-forcing update exactly. The input
is the change in absorbed sunlight plus CO₂ forcing: evolving imbalance is never
fed back as an additional forcing. Land and ocean forcing both enter the global
surface/mixed-layer box; heat reaches the deeper boxes through exchange. FaIR's
efficacy term is retained in both the global TOA imbalance and heat accounting.

## Learned land albedo and CACK

Learned land albedo remains the supplied symbolic equations, normalisation,
quadrature and BRDF kernels. **CACK converts a change in that albedo to TOA
forcing; it does not replace the learned model.** Its default monthly atmosphere
is prescribed rather than driven by the diffuse-illumination slider.

The user supplied `CACKv1.0/CACKv1.0.nc` locally and authorised publication of
**a compact derived monthly mean kernel only**. The entire raw directory and
NetCDF inputs are excluded from both Git and Jekyll. Do not stage or publish
those original files or the supplied usage/derivation programs.

Rebuild with `python scripts/build_reflect_cack.py CACKv1.0/CACKv1.0.nc` in an
isolated environment with NumPy/netCDF4. The converter validates the source
coordinate convention, layout and units, extracts `CACK CM` (2001–2016), changes
north-to-south/0–360 coordinates to south-to-north/−180–180, and takes spherical
area means of 2×2 native 1° cells. Twelve 90×180 uint16 planes at 0.01 W/m² per
unit albedo occupy **388,800 bytes**. The quantisation error at each derived node
is at most 0.005 W/m² per unit albedo. Source and derivative hashes, attribution,
units and all conversion choices are recorded in `cack-monthly.json`.

The source's missing values lie in polar-night bands. They become zero before
area averaging; no sunlit value is extrapolated across that missing band. The
runtime bilinearly samples the 2° centres, wraps longitude and clamps polar
coordinates. Kernels are piecewise calendar-month values, with a repeating
365-day calendar scaled to the model year. Year-specific and all uncertainty
variables are omitted. The thermal scenario envelope therefore does **not**
include CACK uncertainty, learned-model uncertainty or a full model uncertainty.

The supplied CACK usage program implements `ΔF = −K × Δα` in W/m², with albedo
on a 0–1 scale. The kernel already includes prescribed all-sky atmospheric
screening. To retain hourly angular learned albedo without treating a monthly
mean as hourly irradiance, Reflectance approximates:

```
K_hour(i) = K_month(i) × J_hour(i) / mean_reference_TOA_solar_month(latitude_i)
F_land(i) = −K_hour(i) × (alpha_edited(i) − alpha_original(i))
```

`J_hour` is direct plus redistributed diffuse illumination, before the
illustrative uniform transmission. `alpha` is the clamped first-pass broadband
black/white-sky mixture. Both edited and original land coefficients see the same
edited illumination when isolating the albedo term. Reference monthly solar
means use analytic daily insolation integrated across calendar days at the
original Earth-like orbit. Monthly means below 1 W/m² have zero sensitivity,
preventing division by almost-zero polar-night insolation. Artificial lit seasons
there are outside the data constraint. Two bounded per-grid monthly factor planes
are cached; the 389 kB source stays quantised.

This distributes the monthly response over an approximate hourly sunlight cycle;
it is **not** an observed hourly cloud kernel. Latitude, season, local solar time,
angular reflection, area and the geographic monthly CACK value all influence the
edit's global forcing. Altering orbit or diffuse illumination retains the observed
atmosphere; this is a conditional extrapolation, not a new climate calibration.

For edited land, the idealised albedo contribution is **replaced** by CACK's
contribution. It is not multiplied by another transmission factor. Any local
scattering-only effect retains the idealised baseline budget. Ocean albedo,
orbital forcing and the absolute reference budget also retain that illustrative
budget. CACK is a differential kernel and does not supply an observed absolute
TOA planetary energy balance or effective radiative forcing including adjustments.

The comparison selector can use the idealised two-stream land forcing instead.
With screening `s`, downward/upward transmission is `1 − 0.25s`, atmospheric
reflection `0.20s`, and absorption `0.05s`. Returned surface-reflected light is
assumed diffuse; its infinite bounce series is summed analytically. At `s=0`
the **idealised** comparison recovers the unscreened limit. These coefficients are
illustrative and spatially uniform. The default CACK land contribution already
contains atmospheric screening regardless of this separate baseline-budget dial.

## Matched control and one-input explorer

An extra set of three FaIR responses follows an unchanged control with the same
CO₂, orbit, wind and global atmospheric settings through time, retaining original
land inputs, ocean overrides and local scattering. The experiment evolves from
the same initial temperatures. The headline temperature, forcing and heat stores
are **edited minus control**; global controls affect both. The original immutable
280 ppm Earth-like reference remains available in expanded climate context.
Undo/redo restores surfaces without resetting thermal states or time, so a past
intervention's thermal response can remain after its forcing is removed.

The inspector can preview any of the eleven learned-albedo inputs over one land
tile or land within the current brush radius. The preview snapshots the current
physical inputs, atmosphere and day, calculates 24 midpoint solar phases, then
samples 25 uniform input values. All other inputs stay fixed. For regional cover
sweeps, bounds enforce cover totals for every selected tile, not only the centre.
Manual albedo overrides are ignored by this **learned-albedo** preview and cleared
when a physical input is applied. Its baseline retains current heterogeneous land
inputs; a uniformly set curve point need not match that baseline at the mean input.

Charts offer irradiance-weighted daily albedo, regional surface-absorption change,
area-weighted global TOA forcing and conditional equilibrium `ΔF / feedback`.
The equilibrium estimate assumes the sampled day's mean forcing persists forever;
it is not the live transient response or a seasonally integrated equilibrium.
The actual simulation integrates climate temperatures after applying the edit
and resuming playback. The preview pauses the climate and leaves it paused.
Clipping reports the fraction of sampled daylight-area intervals reaching physical
bounds. Training ranges are unavailable; field limits are exploration guardrails.
Separate deep-soil/air-temperature data are still unavailable, so the initial
prescribed temperature proxies remain explicit.

Preview regions are capped at 4096 land cells, with one bounded radiation workspace
and solar-phase cache released afterwards. Configuration changes and new edits
cancel stale computations. No climate timestep or offline drift simulation is
performed by the preview. Radiation maps remain instantaneous; the budget selector
separately shows daily means from completed hourly integration, not the last frame.

## Interface and reproducibility

The main Reflectance page is a fixed, viewport-sized dashboard, with no page or
panel scrolling. Painting tools sit beside the globe on desktop. Settings, saved
surface setups and climate context open in native dialogs; compact viewports move
the same painting controls into a Paint dialog without duplicating inputs. The
history chart is omitted in short windows, with history still available by CSV.
Only detailed dialogs permit scrolling when their contents exceed the viewport.
The inspector is a nonmodal side panel (a lower sheet on mobile).
Native flat-map mode allows editing anywhere without rotating the sphere; arrow
keys move its selection and Enter inspects. Colour keys show units and fixed limits,
including edited-minus-control albedo, surface absorption and illustrative local
response. Regional temperature maps still use the illustrative centred local
buckets, not resolved climate dynamics.

Undo and redo retain at most 24 local edit entries and 4 MiB combined surface
history. Painting samples are separate entries, not whole multi-sample strokes.
A surface setup JSON includes settings, the original sampling date, sparse edited
inputs/overrides/scattering and model/boundary/kernel version identifiers. Loading
validates it before replacing the run, then starts a fresh CO₂-equilibrium climate
and applies the saved intervention; it **does not resume thermal history**.
Monthly CSV history includes the matched-control temperature/scenario response,
instantaneous surface forcing and surface-edit heat. Export forces a current
endpoint first. The hourly annual ring supplies a completed trailing-year mean.

“How it works” includes a small native SVG diagram with source links for surface
assets, learned equations, Jin, CACK, NOAA and FaIR. It can be opened and saved
separately. Its arrows explicitly route total forcing through FaIR's global
surface/mixed-layer box, then into deeper heat stores by exchange.

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

Reference annual absorbed sunlight is estimated with 48 seasonal samples, each
averaging 24 hourly solar phases using the same instantaneous reflection and
scattering as runtime. One daily-mean buffer is reused; no radiation archive is
retained. The periodic seasonal state is solved analytically at startup:

```
Cs dTseason/dt = ASRreference − annualMeanASRreference − λcentral Tseason
```

A separate local single-layer anomaly supplies an approximate regional pattern,
using prescribed capacities 2.1e8 J/m²/K over ocean/ice and 2e7 over land. Its
area mean is removed and replaced by FaIR's central global surface anomaly.
The **seasonal regional response is centred in the same way**: its area mean
is removed, and a separate central three-layer FaIR response supplies the global
reference season. Its forcing is areaMean(ASRreference) minus the reference
annual mean. The 48 seasonal daily means initialise this periodic three-layer
state by solving `(I − Ayear) Tstart = byear`. Another 24 startup-hour samples
supply an additive periodic diurnal perturbation to the local buckets and global
reference layers, with its daily mean removed. Seasonal-plus-diurnal initialisation
is approximate, not a full annual hourly periodic solution or historical spin-up.
Thereafter every global FaIR and local bucket step uses one hour. Hourly FaIR
transitions and local thermal decay factors are cached. No multi-year spin-up or
per-cell history is retained.

The global absolute temperature is exactly 14°C plus the global reference
season and central CO₂/albedo response. The map, inspector and scalar tracker
share that same mean. Scenario global temperatures share the same reference.
The regional map is not a spatial FaIR model or resolved circulation; its simple
local buckets can still exaggerate regional seasonal amplitudes.

Expanded climate context reports imbalance relative to the original reference; total imbalance includes
reference seasonal storage. Heat change is the exact change in reference seasonal
FaIR heat plus the central perturbation FaIR layers' heat content, converted to ZJ.
Local reference fluxes use the centred seasonal pattern and global FaIR season,
so their area mean agrees with the global reference imbalance. The trailing
one-model-year mean uses integrated hourly net fluxes in an 8766-slot scalar
ring, with the oldest sample fractionally weighted to cover 365.2422 days.
Monthly scalar history is capped at
1,200 records; CSV exports use ECS-envelope labels and append the current state.
No dynamic heat transport, ice feedback, interactive clouds or carbon cycle is
included. These assumptions are also visible in the app's “How it works” dialog.

## Lightweight implementation

Persistent state uses bounded typed arrays, cached thermal transitions and no
per-cell timestep history. The matched control adds three tiny global responses
and bounded local/diagnostic planes; seven global perturbation/reference FaIR
responses hold only 21 thermal values. Startup adds temporary quadrature buffers.
Learned inputs and BRDF coefficients are retained only for land cells. The
2,251,152-byte boundary source is released after sampling and coefficient caching;
CACK retains its 388,800-byte quantised source plus at most two Float32 model-grid
factor planes. Source conversion uses Python only offline.

Eight Float32 fields form each **1,629,824-byte** snapshot at 100 km, returned to
a pool of at most two worker buffers. The main thread retains only its current
snapshot. Undo history and previews have explicit limits. No measured total-browser
memory/performance claim is made; browser and graphics overhead vary.
At most one advance is in flight, with at most 192 requested hours and a
32 ms processing budget checked after each hour. Automatic batches also stop at
the next 24-hour output boundary. Intermediate replies carry only a completed-hour
count; the caller carries remaining demand forward without globe frames, endpoint
radiation diagnostics, inspector rebuilding or graph updates. Full diagnostics and
pooled frames are published at daily boundaries and explicit interaction requests;
monthly scalar history remains independent. The scheduler uses requestAnimationFrame
for bounded requests, with a 34 ms gap after a full output to cap automatic drawing
below 30 fps. There is no automatic rendering between outputs, and surface mode
still needs no texture upload for viewing rotation.
Slower devices can run below the selected playback speed without skipping hourly
physics. Hidden pages pause; restart/page exit terminates the worker.

Native WebGL uses one shader and a 720×360 texture. Pixel count is capped at
1.2 million and DPR at 1.5. Canvas fallback ray-casts a reusable 512×384 image.
Paused views have no idle animation loop. No runtime libraries, remote textures,
API calls or uploads are needed; the compact boundary maps are same-origin static assets.

## Sources

- [FaIR 2.2.4 thermal source](https://github.com/OMS-NetZero/FAIR/blob/v2.2.4/src/fair/energy_balance_model.py)
- [FaIR published calibration](https://docs.fairmodel.net/en/stable/examples/calibrated_constrained_ensemble.html)
- [Pinned thermal parameter table](https://github.com/OMS-NetZero/FAIR/blob/4c6571c712693b5355df4b818730c7a3fab2144a/examples/data/calibrated_constrained_ensemble/calibrated_constrained_parameters_calibration1.4.1.csv)
- [CACK model description](https://doi.org/10.5194/gmd-12-3975-2019)
- [CACK dataset](https://doi.org/10.6073/pasta/d77b84b11be99ed4d5376d77fe0043d8)
- [Jin et al. (2011)](https://doi.org/10.1364/OE.19.026429)
- [Pinned SpeedyWeather source](https://github.com/SpeedyWeather/SpeedyWeather.jl/blob/b5eaa01a76d1ce6b083592a1e4c94f419385c77c/SpeedyWeather/src/parameterizations/albedo.jl)
- [Cox–Munk roughness and ocean formulation](https://gmd.copernicus.org/articles/11/321/2018/)
- [Pinned SpeedyWeatherAssets inputs](https://github.com/SpeedyWeather/SpeedyWeatherAssets/tree/e46cdef753200df4b1a9600ce0634ede80a6a19f/data/boundary_conditions)
- [NOAA global trend estimate](https://gml.noaa.gov/ccgg/trends/gl_trend.html)
- [Seasonal insolation](https://climlab.readthedocs.io/en/latest/api/climlab.radiation.insolation.html)
- [IPCC AR6 ECS assessment](https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/)
- [Logarithmic CO₂ forcing](https://archive.ipcc.ch/ipccreports/tar/wg1/222.htm)

## Local preview

Focused surface-edit regressions (no climate integration or offline drift study):

```
node scripts/test_reflect_surface.mjs
```

```
bundle exec jekyll build
bundle exec jekyll serve
```

Open `http://127.0.0.1:4000/reflect/`. Module workers require HTTP.
