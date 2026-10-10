# Reflect

The standalone explorer lives at `/reflect/` (GitHub Pages also redirects
`/reflect` to that route). No framework, external CDN, API key, or server-side
simulation is required. Canvas 2D draws the isometric heightfield; a module Web
Worker precomputes the day's radiation with transferable typed arrays. The
largest grid is 48 × 48. Albedo and shadow frames occupy about
2 MiB at that size; per-tile incoming flux is not stored. Rendering runs at up to 30 frames per second; reduced
motion disables decorative light packets and pulsing markers.

## Where to edit

- `_pages/reflect.html`: page copy, options, and the science explanation.
- `assets/css/reflect.css`: colours, typography, and responsive layout.
- `assets/js/reflect/app.mjs`: seeded world generation, surface presets and
  painting, inspector input ranges, canvas drawing, playback and CSV export.
- `assets/js/reflect/model.mjs`: the equation port, horizon shadows and energy
  integration. Constants match the supplied SpeedyWeather Julia implementation.
- `assets/js/reflect/worker.mjs`: background computation and transferable results.

The model consumes twelve values per cell in the order documented by `FIELDS`.
The eleven learned land inputs include elevation, converted to geopotential with
9.80665 m/s², and snow depth, converted to percentage snow cover using the 0.05 m
scale. The twelfth field is sea-ice concentration, used only over water.
Vegetation fractions sum to at most 1. Temperatures are kelvin; soil moisture is
m³/m³. Physical tile edits preserve other values, except vegetation adjustments
which reduce the other cover when necessary. Painting replaces a tile's surface
properties with the brush preset; raising land adds 100 m up to 3000 m.

The 0–180° display is a **solar arc**, not zenith. Zenith is 90° → 0° → 90°.
Midpoint integration uses 180 intervals over the chosen daylight duration and
is independent of animation timing. Cells are horizontal patches with terrain
heights: shadows use east–west horizons, direct sunlight is blocked in shadow,
and diffuse sunlight is not. This is not a latitude/date astronomical model,
a full atmospheric radiation model, or a terrain-slope/vegetation shadow model.
The original broadband weights (which sum to 1.0084) are preserved, followed by
the original final clamp. No renormalisation is applied.

The chart shows interval-midpoint irradiance; accumulated energy at each point
includes all completed intervals. kWh/m² is the area mean across every cell.
Each cell is 10,000 m²; the MWh figure is the landscape total. CSV exports contain
the 181 cumulative timeline points. Edits invalidate results and reset energy.

## Validation and preview

```sh
node scripts/test_reflect.mjs
bundle exec jekyll build
bundle exec jekyll serve
```

Open `http://127.0.0.1:4000/reflect/`. ES modules and Web Workers require HTTP;
opening the HTML directly with `file://` will not run the application.

Numerical checks cover analytical flat-day irradiation, energy conservation,
snow/ice endpoints, daylight scaling, terrain shadows, diffuse-only invariance,
and Julia-derived C45 fixtures. Three reference BRDF cases were independently
evaluated using Julia 1.12 and matched the JavaScript implementation to machine
precision. Local Chrome checks covered worker startup, scrubbing, tile editing,
preset generation, positive daily totals, and a 390 px mobile viewport.
