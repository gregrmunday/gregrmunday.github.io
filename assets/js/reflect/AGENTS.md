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
