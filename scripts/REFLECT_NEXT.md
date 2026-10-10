# Reflect checkpoint — 10 October 2026

## Saved now

The current deployed model remains at commit `4e8bfa1`: learned C45 land albedo,
Jin ocean albedo, Natural Earth coastlines and deterministic FaIR global response.
**The new SpeedyWeatherAssets data is prepared but is not yet connected to the
runtime. Land input fields in the live version are still illustrative.**

The next version's boundary inputs are pinned to SpeedyWeatherAssets commit
`e46cdef753200df4b1a9600ce0634ede80a6a19f`:

- `assets/data/reflect/boundary-static.bin`: half-degree vegetation fractions,
  high/low leaf-area indices and elevation, six bytes per pixel.
- `boundary-land-mask.bin`: packed half-degree mask sampled from the asset's
  actual 0.1° binary mask. Use this consistently with the new surface inputs.
- `boundary-climate.bin`: twelve months of `swl1`, `swl2`, land surface
  temperature, snow mass, sea-ice concentration and SST on the original 96×48
  grid. Missing samples stay explicitly marked; no invented ocean/land values.
- `boundary-conditions.json`: exact layout, scales, coordinates, source hashes,
  output hashes, pinned provenance and caveats.
- `SpeedyWeatherAssets-EUPL-1.2.txt`: bundled upstream licence. Vegetation also
  declares derivation from ECMWF ERA5 under CC BY 4.0; keep that attribution.
- `scripts/build_reflect_boundary_conditions.py`: reproducible offline converter,
  requiring numpy/netCDF4 only during conversion. Prepared binaries total
  **2,251,152 bytes**, not downloaded by the current browser code.

Raw NetCDF files were downloaded to `/tmp/reflect-speedy-assets`. Conversion tools
are isolated in `/tmp/reflect-assets-venv`; nothing was installed into the website.
To rebuild after those temporary files disappear, download the eight named `.nc`
files from the pinned repository path in the manifest, install numpy/netCDF4 into
an isolated environment, and run the converter with that download directory.

## Next implementation work

1. Add a small boundary-data loader/sampler. Validate manifest dimensions and
   binary sizes. Decode little-endian integers, wrap longitudes and respect the
   actual nonuniform monthly latitudes. Interpolate only valid monthly samples;
   renormalise coastal weights and explicitly handle entirely masked neighbours
   with nearest valid same-surface source data. Never treat missing values as zero.
2. Initialise `Planet` from these inputs and replace procedural vegetation,
   elevation, soil moisture, snow and the latitude-only full-ice rule. Keep
   `model.mjs` and its supplied C45 coefficients/quadrature unchanged. Do not use
   `albedo.nc` as a replacement for learned albedo. Ocean remains Jin, mixed with
   the geographically sourced fractional sea-ice concentration.
3. Follow the matching SpeedyWeather two-layer initialisation: use `swl1` and
   `swl2` for first/last soil moisture inputs. The bundle has no separate deep-soil
   or 2 m air temperature; use land-surface temperature as an explicit proxy for
   both soil temperatures and `t2m`, as appropriate to this simplified model.
   Do not present those proxies as independent measured fields. The orography
   variable's stale units say geopotential, but history divides by gravity and
   its values/long name are height in metres; C45 already multiplies by 9.80665.
4. Convert snow mass [kg/m²] to equivalent liquid-water depth by dividing by
   1000 kg/m³ before the existing C45 snow-cover conversion. Clamp quantised
   vegetation fractions to physical bounds and address overlapping cover totals.
5. Interpolate monthly climatologies to the startup date, with the convention
   documented clearly. The current request is **initialisation**: hold those
   physical input fields prescribed afterwards. Adding evolving monthly surface
   inputs would be additional work and must update both experiment and reference
   identically, preserving the forcing comparison.
6. Build C45 coefficients once, then release large source buffers when possible.
   Derive displayed surface types from vegetation/snow/ice fields. Retain small
   per-cell values needed for inspection, particularly fractional ice. All global
   means and radiation remain at the selected model-grid resolution.
7. Update the science dialog, tile inspector, provenance links, `REFLECT.md` and
   `AGENTS.md` to describe the actual asset maps, coarse monthly source resolution,
   interpolation, proxies and fixed initial surface fields. Preserve the FaIR
   distinction between global thermal response and approximate regional patterns.
8. Finish the previously pending browser review of auto-start, annual display
   rotation, painting/inspection and desktop layout. Then save and push the wired
   version. Keep source data separate from runtime frameworks; no NetCDF parser,
   numpy, Julia or Python should run in the browser.

## Explicitly stopped

The user cancelled the offline control simulations. No continuing simulation
process or saved simulation suite exists. Do not resume that task unless asked.
A single preliminary one-year run completed before cancellation; it is not a
completed drift study and no results claim is being made from it.
