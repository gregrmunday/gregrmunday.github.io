# Reflect development

Reflect is a static browser experiment at `/reflect/`. Page markup is in
`_pages/reflect.html`, styles in `assets/css/reflect.css`, and documentation in
`scripts/REFLECT.md`.

## Ethos

Keep the project lightweight: native ES modules, Canvas 2D, typed arrays and one
short-lived Web Worker. Avoid frameworks, remote assets, image textures and
runtime dependencies unless a concrete benefit justifies their cost.

- Preserve the supplied SpeedyWeather C45 coefficients and quadrature. See
  `scripts/test_reflect.mjs` for independent Julia reference values.
- Calculate radiation at the full selected grid resolution (up to 256 × 256).
  Adapt drawing detail to screen pixels rather than reducing physics resolution.
- Cache angle-independent BRDF coefficients and static geometry/Path2D textures.
  Reuse frame and shadow buffers; never retain a per-cell history for every step.
- Integrate 1440 midpoint intervals independently of playback speed. Terminate
  workers after transferring results, and invalidate stale computations on edits.
- Cap canvas pixel count and device pixel ratio. Keep animation and DOM update
  rates separate. Release object URLs after CSV downloads.
- Procedural surface objects are decorative; the shadow model uses terrain
  heights, not vegetation geometry. Keep scientific assumptions visible.
- Fit desktop controls, landscape, irradiance gauges and energy totals in one
  viewport. Use dialogs for detailed inputs, and permit scrolling on small screens.

The terrain brush applies a bounded Gaussian lift over a circular neighborhood.
Its peak is 100 m, its radius scales with grid size, and its edge reaches zero.
Painting changes physical inputs and recalculates the day.

## Planet lab (October 2026)

The main `/reflect/` route now hosts the spherical energy balance model.
The terrain implementation above remains at `/reflect/terrain/`. See
`scripts/REFLECT.md` for the planet model and `REFLECT_TERRAIN.md` for terrain.

Planet modules use the `globe-` prefix. Its persistent worker integrates daily
steps and returns pooled Float32 snapshots; terminate it when replacing the
experiment or leaving the page. Keep at most one advance in flight and cap
batches, so controls can interrupt computation. Store bounded scalar history,
not globe frames. The default reduced spherical grid has 50,932 cells at ~100 km.

Scattering means redistribution of sunlight, not heat diffusion or clouds.
Its Gaussian approximation must preserve area-weighted power and positivity,
including across longitude seams and polar row changes. All means use true
spherical cell areas. Changes to orbit, CO₂ or albedo must retain the unchanged
reference; never recalibrate an experiment's forcing away.

Integrate three global deterministic FaIR thermal responses using ECS 2.5/3/4°C
per doubling. Feed CO₂ forcing plus area-weighted absorbed-shortwave change
into the three-layer equations, never the evolving imbalance itself. Use the
cached daily matrix exponential; keep the approximate regional pattern separate
and adjust its mean to the global FaIR result. Label the envelope as sensitivity scenarios,
not a transient probabilistic confidence interval. Show perturbation imbalance
and total seasonal imbalance distinctly. Local albedo edits must preserve the
experiment's temperatures and history. The baseline and physical C45 inputs are
prescribed; SpeedyWeatherAssets supplies the mask, vegetation, soil fields,
snow and fractional ice. Keep temperature proxies and coarse coastal fallbacks
explicit; source climatologies are not current observations. Preserve the Jin ocean coefficients from the pinned
SpeedyWeather gm/albedo source, its attribution and EUPL licence. Diagnose the
roughness input explicitly from Cox–Munk wind, and clamp the final mixture.

Native WebGL draws the globe, with a cached low-resolution ray-cast Canvas
fallback. Keep graphics and physics independent, cap pixel buffers, and draw
at most 30 times per second during annual display rotation; stop on pause, hidden
pages, editing or reduced-motion preference. Static surface textures need one
upload; only quantitative map modes change each snapshot. Autostart uses a dated
NOAA snapshot from co2-baseline.mjs and today's season. Never present that cached
value as a live feed, or the equilibrium initialisation as historical climate.
The future albedo game should use
this same model and keep its educational assumptions visible.

Centre both regional seasonal temperatures and regional perturbations before
adding their respective global FaIR responses. Different local land/ocean lags
must not introduce an extra global seasonal temperature. The unchanged reference
season uses a fourth, central FaIR response with a periodic initial state; its
forcing is global reference ASR minus its annual mean. Global net flux and heat
storage must use these global thermal states, not the uncentred local buckets.
The prescribed annual 280 ppm baseline is exactly 14°C, and is not observational
calibration. Keep the temperature map, inspector and tracker consistent.

## Geographic surface initialisation

The pinned SpeedyWeatherAssets boundary binaries are now connected through
`globe-boundary.mjs`. See `scripts/REFLECT.md` for active behaviour and
`REFLECT_NEXT.md` for checkpoint status. Keep learned C45 for land; the prescribed
albedo asset must not replace it. Preserve the two-layer swl1/swl2 convention,
snow mass-to-water-depth conversion, monthly missing masks, nonuniform latitudes,
longitude wrap and explicitly documented soil/air-temperature proxies.

Sample climatologies for the startup date and hold the physical input fields
fixed unless the user explicitly paints or edits them. An evolving monthly climatology would require matching changes in both
reference and experiment. Retain C45 inputs only for land cells and release the
source buffers after caching. Surface classification is visual; fractional sea ice
must remain continuous in the Jin radiation mixture.

## Physical surface brushes

The planet's “04 Paint a response” panel edits land cover, leaf area, elevation
and snow as C45 inputs. Original Float32 inputs and reference BRDF coefficients
are separate bounded arrays; never modify them when painting. Recompute C45
only for changed land tiles, clear manual albedo overrides in physical brush
footprints, and restore original inputs and coefficients without resetting
climate history. Vegetation conversion preserves total cover; LAI targets are
explicit illustrative presets. No carbon release or ecosystem feedback is implied.

Visit only brush-intersecting latitude rows, handle spherical seams and poles,
and use a bounded Gaussian footprint. Coalesce pointer samples with one paint
request in flight. Transfer visual classifications only on surface changes and
invalidate the cached surface texture then; ordinary rotation remains cached.
Preserve unsaved tile-editor values during climate snapshots. Enforce cover
totals at most one and keep ocean tiles out of the land editor.

Send partial land-input patches, preserving the exact unedited Float32 values.
An unchanged Apply must preserve prescribed albedo and radiation. Validate edits
before mutation and recover rejected edits without discarding the climate state.
Only explicit selection requests may change the selected tile; stale snapshots
must not overwrite the selection or unfinished coordinate drafts. Flush the last
distinct brush point on pointer-up while retaining one request in flight.

The project's purpose is to demonstrate learned land-albedo influence on global
climate and sensitivity to each physical input. Prioritise complete C45 input
controls, one-input sweeps and an unchanged control with edited-minus-control
temperature/forcing readouts. Keep these analyses bounded and distinguish the
surface experiment from warming relative to the 280 ppm reference. The tile
editor now exposes all eleven C45 inputs independently; moisture uses m³/m³ and
temperature uses kelvin. Temperature edits affect C45 reflection only and remain
prescribed during climate integration. Detect changes and restore originals across
all eleven fields, including soil and air inputs even when surface classification
stays unchanged. Bounds are exploration guardrails, not validated training ranges.
See `scripts/REFLECT_NEXT.md` for the remaining sweeps and control comparisons.

The user stopped offline simulations; do not resume them without a new request.
