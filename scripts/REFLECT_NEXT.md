# Reflectance work status — 10 October 2026

## Scientific and interface improvements — current checkpoint

- Completed the matched unchanged control, surface-only temperature/forcing/heat
  readouts and delta maps. The original 280 ppm reference remains distinct.
- Added actual completed-day radiation means alongside instantaneous maps, while
  retaining hourly integration and 24-hour automatic output.
- Added bounded one-input previews for all eleven learned-albedo inputs, including
  regional cover validation, clipping reports and conditional equilibrium curves.
- Added default monthly CACK land-albedo forcing from the user-supplied local data.
  Only the 388,800-byte derived mean kernel and metadata are publishable; the raw
  dataset/directory is excluded from Git and Jekyll. Hourly weighting is approximate,
  atmosphere prescribed, and CACK uncertainties are omitted. The existing diffuse
  illumination dial remains an illustrative sunlight mixture/redistribution control.
- Added three jointly retained thermal parameter sets from pinned published FaIR
  calibration 1.4.1, reproducible conversion scripts and licence/provenance.
- Added flat-map mode, nonmodal tile editor, bounded undo/redo, validated saved
  surface setups and clearer colour keys. Reflectance now uses a fixed dashboard
  with no main-page scrolling; settings/context open in dialogs, and compact
  viewports open the painting tools in a dialog.
- Added the attributed SVG model diagram in “How it works”, available separately
  at `/assets/images/reflect-model.svg`. Call the equations **learned albedo**.

Module syntax checks, Jekyll compilation and a paused local desktop/mobile visual
preview have been performed. The built site excludes the raw CACK directory and
NetCDF files. No new automated model tests, performance benchmark, thermal drift
study or offline climate simulations have been run. The earlier review notes below
are historical and do not validate these newer physics/features.

### Remaining scientific extensions

1. Training ranges and separate top/deep soil and 2 m temperature climatologies
   remain unavailable. Keep initial temperature proxies and exploration guardrails
   explicit; do not claim the controls establish learned-model validity.
2. The absolute 14°C baseline, regional buckets and two-stream reference/ocean
   budget remain illustrative. CACK calibrates the **land-albedo perturbation**,
   not absolute flux or effective radiative forcing with atmospheric adjustments.
3. A seasonal/full-year sensitivity preview could complement the single-day curves.
   The current equilibrium estimate repeats that day's mean forcing indefinitely.
4. Kernel uncertainty, learned-model uncertainty and a full FaIR posterior are
   omitted; the three curves are deterministic thermal scenarios.
5. Monthly surface-input evolution, historical calibration and temperature-goal
   gameplay are future work. A new offline climate validation study still requires
   a fresh user request; the cancelled simulations remain stopped.

The project is now named **Reflectance**, with the original `/reflect/` route retained.
The tab title and two decorative taglines have been simplified.

The implementation details and sources are in `REFLECT.md`. Priorities 2 and 3 in
the older learned-albedo checklist below are now completed by this checkpoint.

## Boundary integration completed

The checkpoint from `8406400` is now wired into the runtime. `globe-boundary.mjs`
loads and validates the compact SpeedyWeatherAssets maps, handles source-grid
coordinates and missing coastal samples, and initialises the learned albedo physical inputs
and fractional ocean sea ice. Temperature proxies, source-date interpolation and
fixed input fields are documented in `REFLECT.md`, the science dialog and tile
inspector. Land continues to use learned; ocean continues to use Jin.

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

Painting recalculates learned only for changed land tiles. Original land
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

Unchanged Apply no longer rounds and rewrites the full learned albedo input vector or clears
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

The current prototype connects learned albedo edits to global absorbed-shortwave forcing
and FaIR temperature response. It does not yet isolate sensitivity to every learned albedo
input, or display the extra temperature response of a surface experiment clearly.

1. **Completed:** the tile editor exposes all eleven physical learned albedo inputs, including
   independent top/deep soil moisture, top/deep soil temperature and near-surface
   air-temperature inputs. Original inputs remain immutable. Edits preserve exact
   untouched values, invalidate learned albedo coefficients for any of the eleven inputs,
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
The inspector showed sourced learned albedo inputs in London, the Amazon and Sahara, Jin
open-water reflection in the Pacific, and partial Antarctic sea ice. Prescribing
and restoring a tile albedo and editing CO₂ worked while paused.

At this earlier checkpoint, desktop layouts fitted 1440×900 and 1280×720 without
page or control scrolling. Short windows and mobile layouts then scrolled
vertically without horizontal overflow. This was a browser/interface review, not
the cancelled offline control-simulation study.

## Hourly timestep update completed

Runtime radiation now resolves longitude and solar time at each hour's midpoint,
with learned albedo angular kernels and Jin reflection at that angle. FaIR and local thermal
buckets use cached one-hour transitions. Integer hours avoid floating-point clock
drift; the annual flux tracker uses a bounded hourly ring. Physical day/night
shading, a UTC clock, +1 hour and slower playback choices expose the diurnal cycle.

Requests are bounded by count and processing time, with explicit completed-hour
acknowledgements, no skipped model hours, cached geometry/Jin tables, pooled
frames and endpoint diagnostics. The annual viewing rotation remains decorative.
Startup samples 48 seasons × 24 hourly solar phases and solves seasonal-plus-
diurnal thermal initial conditions approximately, without a historical spin-up.

Module syntax, static code/diff review and Jekyll build are the checks for this
update. The existing surface-regression fixture starts at noon so its Amazon
radiation assertions concern a sunlit tile; it was not run. No new automated
tests, browser runtime checks, performance benchmark or offline climate study
were run. Hourly runtime performance and the approximate reference initialisation
remain unverified by a runtime exercise.

## Daily output with hourly physics completed

The user selected 24-hour output spacing. Radiation, FaIR layers, regional thermal
buckets and heat integration still advance hourly. Automatic batches stop at each
24-hour boundary; partial CPU slices return a scalar completion acknowledgement
without endpoint diagnostics or a globe frame. Daily outputs use existing pooled
buffers. The main thread draws, uploads quantitative textures and updates graphs
and inspector only for full outputs, with no idle scene redraw loop.

Pause, edits, inspection, CSV export and manual +1 hour stepping force current
endpoint snapshots. Export waits for that snapshot, so it cannot silently use
stale daily metrics. The 34 ms post-output scheduler gap caps automatic drawing
below 30 fps; one advance remains in flight and CPU slices remain bounded.
Daily snapshots are instantaneous, not averages, and sample the same UTC hour;
use manual stepping to inspect the diurnal cycle. Startup and hourly numerical
equations are unchanged.

Module syntax checks, static code/diff review and a Jekyll build are the checks
for this update. No automated tests, browser exercise, performance benchmark or
offline climate simulations were run. Reduced frame/diagnostic work is evident
from the code paths; the runtime speed improvement has not been measured.
