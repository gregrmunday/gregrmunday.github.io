"""Prepare compact SpeedyWeatherAssets inputs; no browser dependencies.

Usage: python build_reflect_boundary_conditions.py /path/to/netcdf/files
Requires numpy and netCDF4 for this offline conversion only. Inputs must come
from the pinned commit recorded below. Runtime integration is tracked in
scripts/REFLECT_NEXT.md. Does not substitute prescribed albedo for learned albedo.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from netCDF4 import Dataset

COMMIT = 'e46cdef753200df4b1a9600ce0634ede80a6a19f'
SOURCE = f'https://github.com/SpeedyWeather/SpeedyWeatherAssets/tree/{COMMIT}/data/boundary_conditions'
root = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / 'assets/data/reflect'
out.mkdir(parents=True, exist_ok=True)
width, height = 720, 360
lat = -90 + (np.arange(height) + .5) * .5
lon = (-180 + (np.arange(width) + .5) * .5) % 360


def read(file, variable):
    with Dataset(root / (file + '.nc')) as dataset:
        values = np.ma.filled(dataset[variable][:], np.nan).astype(np.float64)
        ys = np.asarray(dataset['lat'][:], dtype=np.float64)
        xs = np.asarray(dataset['lon'][:], dtype=np.float64)
    order = np.argsort(ys)
    return values[..., order, :], ys[order], xs


def weights(axis, positions):
    upper = np.clip(np.searchsorted(axis, positions, side='right'), 1, len(axis) - 1)
    lower = upper - 1
    fraction = np.clip((positions - axis[lower]) / (axis[upper] - axis[lower]), 0, 1)
    return lower, upper, fraction


def remap(values, ys, xs):
    y0, y1, fy = weights(ys, lat)
    # Longitude coordinates start at 0 and are uniformly spaced in these files.
    x = lon / (xs[1] - xs[0])
    x0 = np.floor(x).astype(int) % len(xs)
    x1, fx = (x0 + 1) % len(xs), x % 1
    a = values[np.ix_(y0, x0)] * (1 - fx) + values[np.ix_(y0, x1)] * fx
    b = values[np.ix_(y1, x0)] * (1 - fx) + values[np.ix_(y1, x1)] * fx
    return a * (1 - fy[:, None]) + b * fy[:, None]


static = np.zeros((height, width, 6), dtype=np.uint8)
for offset, variable, scale in [(0, 'vegh', 1 / 255), (1, 'vegl', 1 / 255),
                                 (2, 'lai_hv', 1 / 32), (3, 'lai_lv', 1 / 32)]:
    values, ys, xs = read('vegetation', variable)
    static[..., offset] = np.rint(np.clip(remap(values, ys, xs), 0, 255 * scale) / scale).astype(np.uint8)
values, ys, xs = read('orography', 'orog')
# Despite a stale geopotential units attribute, history explicitly divides by
# 9.80665 and long_name identifies height in metres. Learned albedo multiplies by gravity.
heights = np.rint(np.clip(remap(values, ys, xs), 0, 65535)).astype(np.uint16)
static[..., 4], static[..., 5] = heights & 255, heights >> 8
(out / 'boundary-static.bin').write_bytes(static.tobytes())
values, ys, xs = read('land-sea_mask', 'lsm')
y = np.abs(ys[:, None] - lat).argmin(axis=0)
x = np.rint(lon / (xs[1] - xs[0])).astype(int) % len(xs)
mask = values[np.ix_(y, x)].astype(np.uint8).ravel()
(out / 'boundary-land-mask.bin').write_bytes(np.packbits(mask, bitorder='little').tobytes())

fields = [('soil_moisture', 'swl1', .00001), ('soil_moisture', 'swl2', .00001),
          ('land_surface_temperature', 'lst', .01), ('snow', 'snow', 1.),
          ('sea_ice', 'sic', 1 / 65535), ('sea_surface_temperature', 'sst', .01)]
planes, metadata = [], []
for file, variable, scale in fields:
    values, ys, xs = read(file, variable)
    # Retain missing values as a reserved integer. Runtime interpolation must
    # renormalise valid neighbours and handle entirely masked coastal samples.
    valid = np.isfinite(values)
    packed = np.rint(np.clip(np.where(valid, values, 0) / scale, 0, 65534)).astype('<u2')
    packed[~valid] = 65535
    planes.append(packed)
    metadata.append(dict(file=file + '.nc', variable=variable, scale=scale,
                         units={'snow': 'kg/m2', 'lst': 'K', 'sst': 'K'}.get(variable, '1')))
climate = np.stack(planes, axis=1)  # month, field, south-to-north latitude, longitude
(out / 'boundary-climate.bin').write_bytes(climate.tobytes())
manifest = dict(source=SOURCE, commit=COMMIT, status='Runtime initialisation inputs for learned land albedo and Jin ocean albedo',
    licence='SpeedyWeatherAssets EUPL-1.2; vegetation derived from ERA5, CC BY 4.0',
    static=dict(width=width, height=height, origin=[-180, -90], rows='south-to-north', stride=6,
                fields=['high_cover_u8_div255', 'low_cover_u8_div255', 'high_lai_u8_div32',
                        'low_lai_u8_div32', 'height_metres_u16_little_endian']),
    mask=dict(width=width, height=height, bit_order='least-significant-bit-first'),
    climate=dict(shape=list(climate.shape), order='month,field,latitude,longitude',
                 dtype='uint16_little_endian', missing=65535, latitude=ys.tolist(),
                 longitude=xs.tolist(), fields=metadata),
    caveats=['Sea ice 1 is encoded as 65534/65535 to reserve the missing sentinel.',
             'Snow is mass per area: divide by 1000 kg/m3 for equivalent liquid-water metres.',
             'Monthly inputs are 96x48; remapping does not create 100 km source detail.',
             'No separate deep-soil or 2m air-temperature field exists in this bundle.',
             'Use swl1/swl2 for the two-layer SpeedyWeather initialisation convention.',
             'Prescribed albedo.nc is deliberately excluded: land must still use learned albedo.'])
manifest['source_sha256'] = {file.name:hashlib.sha256(file.read_bytes()).hexdigest()
                             for file in sorted(root.glob('*.nc'))}
manifest['output_sha256'] = {name:hashlib.sha256((out / name).read_bytes()).hexdigest()
                            for name in ['boundary-static.bin', 'boundary-land-mask.bin', 'boundary-climate.bin']}
(out / 'boundary-conditions.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Prepared boundary assets:', sum((out / name).stat().st_size for name in manifest['output_sha256']), 'bytes')
