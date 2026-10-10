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

Integrate three paired temperature anomalies using ECS 2.5/3/4°C per doubling
and prescribed heat capacities. Label their envelope as sensitivity scenarios,
not a transient probabilistic confidence interval. Show perturbation imbalance
and total seasonal imbalance distinctly. Local albedo edits must preserve the
experiment's temperatures and history. The baseline and physical C45 inputs are
prescribed; do not imply observational geography or automatic climate feedback.

Native WebGL draws the globe, with a cached low-resolution ray-cast Canvas
fallback. Keep graphics and physics independent, cap pixel buffers, and draw
only when simulation or view state changes. The future albedo game should use
this same model and keep its educational assumptions visible.
