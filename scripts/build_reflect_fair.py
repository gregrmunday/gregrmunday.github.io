#!/usr/bin/env python3
"""Extract representative joint thermal sets from the pinned FaIR CSV.

Usage: python scripts/build_reflect_fair.py /path/to/calibration1.4.1.csv
Download the pinned source in FAIR_SOURCE below; no runtime dependency required.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics

COMMIT = '4c6571c712693b5355df4b818730c7a3fab2144a'
HASH = '7b6c5d9fa0b0b0d3eb47189bf5d63cbf77e752ddac682947abee5ff529206780'
SOURCE = f'https://github.com/OMS-NetZero/FAIR/blob/{COMMIT}/examples/data/calibrated_constrained_ensemble/calibrated_constrained_parameters_calibration1.4.1.csv'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('assets/js/reflect/fair-calibration.mjs'))
    args = parser.parse_args()
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != HASH:
        raise ValueError('Source differs from the pinned calibration table')
    with args.source.open(newline='') as stream:
        rows = list(csv.DictReader(stream))
    fields = ['ocean_heat_capacity[0]', 'ocean_heat_capacity[1]', 'ocean_heat_capacity[2]',
              'ocean_heat_transfer[1]', 'ocean_heat_transfer[2]', 'deep_ocean_efficacy']
    medians = {field: statistics.median(float(row[field]) for row in rows) for field in fields}
    doubling = 5.35 * math.log(2)

    def ecs(row):
        return doubling / float(row['ocean_heat_transfer[0]'])

    scenarios = []
    for target in (2.5, 3, 4):
        candidates = sorted(rows, key=lambda row: abs(ecs(row) - target))[:20]
        chosen = min(candidates, key=lambda row: ((ecs(row) - target) / .04)**2
                     + sum(math.log(float(row[field]) / medians[field])**2 for field in fields))
        scenarios.append({
            'id': int(chosen['']), 'ecs': ecs(chosen),
            'capacity': [float(chosen[f'ocean_heat_capacity[{i}]']) for i in range(3)],
            'feedback': float(chosen['ocean_heat_transfer[0]']),
            'exchange': [float(chosen[f'ocean_heat_transfer[{i}]']) for i in (1, 2)],
            'efficacy': float(chosen['deep_ocean_efficacy']),
            'sourceForcing4co2': float(chosen['forcing_4co2']),
        })
    metadata = {'calibration': 'FaIR calibration 1.4.1', 'commit': COMMIT, 'sha256': HASH,
                'source': SOURCE,
                'selection': 'Nearest ECS under Reflectance logarithmic CO2 forcing, with representative joint thermal parameters; deterministic thermal subset, not a probabilistic posterior forecast.'}
    args.output.write_text('// Published joint thermal parameter sets. Selection and provenance in scripts/REFLECT.md.\n'
                           + 'export const FAIR_SOURCE=' + json.dumps(metadata, separators=(',', ':')) + ';\n'
                           + 'export const FAIR_SCENARIOS=' + json.dumps(scenarios, separators=(',', ':')) + ';\n')
    print('Wrote three published joint thermal sets:', [p['id'] for p in scenarios])


if __name__ == '__main__':
    main()
