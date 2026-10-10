#!/usr/bin/env python3
"""Convert the local CACK CM only; never copy the source NetCDF to the site.

Usage: python scripts/build_reflect_cack.py CACKv1.0/CACKv1.0.nc
Requires NumPy and netCDF4 only in the offline conversion environment.
"""
import argparse
import hashlib
import json
from pathlib import Path

import netCDF4
import numpy as np


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('assets/data/reflect'))
    args = parser.parse_args()
    with netCDF4.Dataset(args.source) as dataset:
        variable = dataset['CACK CM']
        if variable.dimensions != ('Month', 'col', 'row') or variable.getncattr('Units') != 'W/m^2':
            raise ValueError('Unsupported CACK layout or units')
        if not (np.array_equal(dataset['Month'][:], np.arange(1, 13))
                and np.array_equal(dataset['Latitude'][:], np.arange(89.5, -90, -1))
                and np.array_equal(dataset['Longitude'][:], np.arange(.5, 360, 1))):
            raise ValueError('Unsupported CACK coordinates')
        # Native [month, longitude 0..360, north-to-south latitude] ->
        # [month, south-to-north latitude, longitude -180..180].
        native = np.asarray(variable[:], dtype=np.float64).transpose(0, 2, 1)[:, ::-1, :]
        native = np.roll(native, 180, axis=2)
        if np.isinf(native).any() or (native[np.isfinite(native)] < 0).any():
            raise ValueError('Invalid CACK kernel')
        missing = int(np.isnan(native).sum())
        # Source NaNs occur in polar-night bands. Retain zero sensitivity there,
        # including partial 2-degree footprints; do not extrapolate a lit kernel.
        native = np.nan_to_num(native, nan=0)
        weights = np.diff(np.sin(np.deg2rad(np.arange(-90, 91)))).reshape(1, 90, 2, 1, 1)
        blocks = native.reshape(12, 90, 2, 180, 2)
        coarse = (blocks * weights).sum(axis=(2, 4)) / (2 * weights.sum(axis=2).reshape(1, 90, 1))
        scale = .01
        packed = np.rint(coarse / scale)
        if packed.max() >= 65535:
            raise ValueError('Kernel does not fit the compact encoding')
        args.output.mkdir(parents=True, exist_ok=True)
        binary = args.output / 'cack-monthly.bin'
        binary.write_bytes(packed.astype('<u2').tobytes())
        metadata = {
            'format': 'reflect-cack-1', 'shape': [12, 90, 180],
            'order': 'month,latitude,longitude', 'rows': 'south-to-north',
            'longitude_start': -180, 'cell_degrees': 2, 'scale': scale,
            'dtype': 'uint16_little_endian', 'units': 'W/m2 per unit surface albedo',
            'forcing_sign': 'positive absorption change = -kernel * delta_albedo',
            'variable': 'CACK CM', 'years': [2001, 2016],
            'citation': "Bright, R. M. and O'Halloran, T. L. (2019), CACK v1.0, Geosci. Model Dev., 12, 3975–3990",
            'paper': 'https://doi.org/10.5194/gmd-12-3975-2019',
            'dataset': 'https://doi.org/10.6073/pasta/d77b84b11be99ed4d5376d77fe0043d8',
            'source_sha256': sha256(args.source), 'sha256': sha256(binary),
            'derivation': 'Spherical-area means of 2x2 native 1-degree cells; nearest 0.01 W/m2 encoding.',
            'missing_source_values': missing,
            'missing_policy': 'Polar-night NaNs replaced by zero before area averaging; no lit-region extrapolation.',
            'omitted': 'Year-specific kernels and all uncertainty variables; scenario envelope is thermal sensitivity only.',
            'bytes': binary.stat().st_size,
        }
        (args.output / 'cack-monthly.json').write_text(json.dumps(metadata, indent=2) + '\n')
        print(f'Wrote {binary}: {binary.stat().st_size:,} bytes (monthly mean kernel only)')


if __name__ == '__main__':
    main()
