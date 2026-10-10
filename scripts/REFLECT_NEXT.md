# Reflect work status — 10 October 2026

## Boundary integration completed

The checkpoint from `8406400` is now wired into the runtime. `globe-boundary.mjs`
loads and validates the compact SpeedyWeatherAssets maps, handles source-grid
coordinates and missing coastal samples, and initialises the C45 physical inputs
and fractional ocean sea ice. Temperature proxies, source-date interpolation and
fixed input fields are documented in `REFLECT.md`, the science dialog and tile
inspector. Land continues to use learned C45; ocean continues to use Jin.

Vegetation and terrain inputs are no longer seeded synthetic fields. The seed
now changes only the illustrative atmospheric scattering pattern. Native binary
arrays and cached coefficients keep NetCDF/Python/Julia out of the browser.

## Optional future work

- Replace the explicit land-temperature proxies with separate deep-soil and 2 m
  air-temperature climatologies if suitable datasets are supplied.
- Evolve monthly surface inputs through seasons, applying identical climatology
  changes to reference and experiment. This would extend the current request,
  which initialises and then prescribes surface inputs.
- Add temperature-goal gameplay using the existing local albedo brushes.
- Calibrate the absolute temperature baseline and regional seasonal amplitudes
  against an appropriate air-temperature climatology; the current 14°C reference
  and local bucket capacities remain illustrative.

## Surface painting completed

“04 Paint a response” includes high/low vegetation conversion, bare ground,
snow and Gaussian elevation brushes, retaining direct albedo/scattering tools.
Focus Amazon makes the forest experiment easy to reach. The tile dialog exposes
cover, leaf area, elevation and snow, with cover-total validation and protection
for unsaved form values while the simulation runs.

Painting recalculates learned C45 only for changed land tiles. Original land
inputs and reference coefficients remain immutable; restoration returns them
without changing thermal history. The globe updates its surface colours when
classification changes. The global sunlight-forcing readout and local inspector
show the absorbed-radiation difference immediately. See `REFLECT.md` for preset
LAI values and the albedo-only scope of these vegetation experiments.
Jekyll build, module syntax and whitespace checks passed for this update. No
runtime/browser exercise or offline control-simulation study was run.

## Startup temperature correction

The regional seasonal response previously contributed its uncentred area mean
on top of the global FaIR CO₂ response. At 428 ppm on 10 October, this added
2.34°C and produced 18.18°C at startup. Both regional seasonal and perturbation
patterns now have their means removed. A separate central FaIR response supplies
the global reference season, initialised periodically from the existing 48
radiation samples. Global heat and seasonal net flux follow those thermal states.
The same setup starts at 15.52°C, including −0.32°C reference season and +1.84°C
equilibrium CO₂ warming above the prescribed 14°C annual baseline.

A focused startup/first-three-day diagnosis showed unchanged CO₂ warming and
agreement between the temperature map's area mean and the scalar tracker. A CO₂
change left temperature continuous and produced a gradual thermal response.
This brief bug investigation did not resume the cancelled offline drift study.

## Explicitly stopped

The user cancelled offline control simulations. They remain stopped; do not
resume them without a new request. No completed drift study is claimed.

## Surface-edit bug review completed

Unchanged Apply no longer rounds and rewrites the full C45 input vector or clears
prescribed albedo. The editor sends only changed fields, preserving the exact
other inputs. Coordinate steps match the displayed precision, coordinate drafts
survive snapshots, and older inspector packets cannot change the selected tile.
Blank or nonfinite scattering edits are rejected before mutation; an edit error
leaves the experiment usable. Fast drags flush their final point without doubling
an ordinary click. Coarse grids enforce a brush radius that reaches cell centres,
and the paused stage label now follows playback state.

`node scripts/test_reflect_surface.mjs` covers partial edits, immutable reference,
forcing accounting, rejection, restoration and coarse-grid brush coverage without
climate timestepping. An isolated local Chrome check exercised coordinate drafts,
stale packets, unchanged Apply, a partial LAI edit, rejected scattering, restoration,
click/drag handling, resumed playback and the 1280×720 layout. No browser exceptions
were observed. This does not replace the cancelled offline drift study.

## Priorities for the learned-albedo demonstration

The current prototype connects C45 edits to global absorbed-shortwave forcing
and FaIR temperature response. It does not yet isolate sensitivity to every C45
input, or display the extra temperature response of a surface experiment clearly.

1. **Completed:** the tile editor exposes all eleven physical C45 inputs, including
   independent top/deep soil moisture, top/deep soil temperature and near-surface
   air-temperature inputs. Original inputs remain immutable. Edits preserve exact
   untouched values, invalidate C45 coefficients for any of the eleven inputs,
   and restore all fields without changing thermal history. Temperature controls
   are in kelvin and affect albedo only; their 150–350 K bounds and moisture's
   0–1 m³/m³ bounds are exploration guardrails, not training-range claims.
2. Add an unchanged control with identical CO₂, orbit and atmospheric settings,
   showing edited-minus-control temperature, absorbed radiation and imbalance.
   The existing 280 ppm reference warming is not a surface-only temperature metric.
3. Add one-input-at-a-time sweeps with local albedo and regional/global forcing
   plots, explicit baseline values, ranges and units. Sweeps can reuse cached
   geometry and bounded buffers; retain no per-cell simulation history.
4. Offer a fixed-albedo comparison to help distinguish the learned surface response
   from the global thermal response. Label prescribed inputs, proxies and omitted
   ecosystem/carbon/ice/cloud feedbacks so this remains an educational experiment.
5. Pursue temperature-goal gameplay after these comparisons are clear. Any new
   offline climate validation requires a fresh user request.

The complete-input editor update received static code/diff review, module syntax
checks and a Jekyll build. No new automated tests, browser exercise or offline
simulation were run for this feature update.

## Completed review

Jekyll build and syntax checks passed. The isolated local Chrome preview loaded
50,932 cells and started playback automatically without browser exceptions.
The inspector showed sourced C45 inputs in London, the Amazon and Sahara, Jin
open-water reflection in the Pacific, and partial Antarctic sea ice. Prescribing
and restoring a tile albedo and editing CO₂ worked while paused.

Desktop layouts fit 1440×900 and 1280×720 without page or control scrolling. Very
short desktop windows retain an internal control scrollbar; mobile layouts scroll
vertically without horizontal overflow. This was a browser/interface review, not
the cancelled offline control-simulation study.
