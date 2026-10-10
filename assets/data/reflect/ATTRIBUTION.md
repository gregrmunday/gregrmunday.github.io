# Reflectance data and thermal parameters

## CACK monthly derivative

Bright, R. M. and O'Halloran, T. L. (2019). Developing a monthly radiative kernel
for surface albedo change from satellite climatologies of Earth's shortwave
radiation budget: CACK v1.0. *Geoscientific Model Development*, 12, 3975–3990.
[Model description](https://doi.org/10.5194/gmd-12-3975-2019),
[dataset](https://doi.org/10.6073/pasta/d77b84b11be99ed4d5376d77fe0043d8).
Underlying radiation products: NASA CERES EBAF.

`cack-monthly.bin` is an approved derivative of the locally supplied `CACK CM`
monthly 2001–2016 mean: spherical area averages to 2°, quantised at 0.01 W/m²
per unit surface albedo, polar-night NaNs converted to zero. It excludes all
year-specific and uncertainty variables. `cack-monthly.json` records hashes,
coordinates and conversion choices. The original NetCDF and supplied programs
stay local and are excluded from both Git and the site build.
The article is distributed under CC BY 4.0; it describes the source product.

## FaIR thermal subset

`fair-calibration.mjs` extracts three jointly retained thermal parameter sets
from [FaIR's published calibration 1.4.1 table](https://github.com/OMS-NetZero/FAIR/blob/4c6571c712693b5355df4b818730c7a3fab2144a/examples/data/calibrated_constrained_ensemble/calibrated_constrained_parameters_calibration1.4.1.csv).
The original source's Apache 2.0 licence is bundled as `FaIR-Apache-2.0.txt`.
Conversion/selection is documented in `scripts/REFLECT.md` and reproduced by
`scripts/build_reflect_fair.py`. These are deterministic thermal subsets, not the
complete calibrated FaIR posterior model. FaIR's thermal equations are implemented
independently in JavaScript with no Python runtime dependency.

## Geographic boundary fields and ocean reflection

SpeedyWeatherAssets and ECMWF ERA5 input provenance and quantisation are recorded
in `boundary-conditions.json`; the EUPL 1.2 licence is bundled. ERA5 vegetation
data attribution is CC BY 4.0. Jin et al. (2011) ocean reflection is adapted from
the pinned SpeedyWeather `gm/albedo` implementation, with source attribution in
`jin-ocean.mjs` and `SpeedyWeather-EUPL-1.2.txt`.

The learned land-albedo equations are supplied by Gregory Munday. Boundary input
maps initialise their physical inputs; the prescribed albedo map is not used.
