"""Rasterise Natural Earth land polygons into a tiny packed mask, without dependencies.

Usage: python3 scripts/build_reflect_land_mask.py /path/ne_110m_land.geojson
Source: nvkelso/natural-earth-vector v5.1.2; geojson/ne_110m_land.geojson.
Public-domain data. Raster origin is (-180, -90); rows run south to north.
"""
import json
import math
import sys
from pathlib import Path

width, height = 720, 360
cells = bytearray(width * height)
source = json.loads(Path(sys.argv[1]).read_text())
for feature in source['features']:
    geometry = feature['geometry']
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    for polygon in polygons:
        # Scanline intersections with all rings implement holes using even–odd fill.
        minimum = max(0, math.floor((min(p[1] for ring in polygon for p in ring) + 90) * 2))
        maximum = min(height - 1, math.ceil((max(p[1] for ring in polygon for p in ring) + 90) * 2))
        for y in range(minimum, maximum + 1):
            latitude = -90 + (y + .5) / 2
            crossings = []
            for ring in polygon:
                for a, b in zip(ring, ring[1:] + ring[:1]):
                    if (a[1] > latitude) != (b[1] > latitude):
                        crossings.append(a[0] + (latitude - a[1]) * (b[0] - a[0]) / (b[1] - a[1]))
            crossings.sort()
            for left, right in zip(crossings[::2], crossings[1::2]):
                start = max(0, math.ceil((left + 180) * 2 - .5))
                stop = min(width, math.ceil((right + 180) * 2 - .5))
                for x in range(start, stop):
                    cells[y * width + x] = 1
packed = bytearray(len(cells) // 8)
for index, cell in enumerate(cells):
    if cell:
        packed[index // 8] |= 1 << (index % 8)
destination = Path(__file__).resolve().parents[1] / 'assets/data/reflect'
destination.mkdir(parents=True, exist_ok=True)
(destination / 'land-mask.bin').write_bytes(packed)
metadata = dict(width=width, height=height, origin=[-180, -90], rows='south-to-north', bit_order='least-significant-bit-first',
                source='Natural Earth ne_110m_land, v5.1.2 repository', licence='Public domain',
                url='https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_110m_land.geojson')
(destination / 'land-mask.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(f'Wrote {len(packed):,} bytes; {sum(cells):,} land pixels.')
