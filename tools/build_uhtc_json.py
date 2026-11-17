#!/usr/bin/env python3
"""Build data/uhtc.json, the file behind the chart on downloads.html.

Reads UHTCs_data.tar (the data set published with Nath et al., ACS Appl. Mater.
Interfaces 2021) and writes the isothermal elastic constants and the Hill
polycrystalline averages for each compound, on the temperature grid of the files.
Values are copied as they are; nothing is fitted, smoothed or resampled.

Run from the repository root:  python3 tools/build_uhtc_json.py
"""
import bz2
import json
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "UHTCs_data.tar"
OUTPUT = ROOT / "data" / "uhtc.json"

ANIONS = {"B": ("{m}B2", "hexagonal"), "C": ("{m}C", "cubic"), "N": ("{m}N", "cubic")}
METALS = ("Ti", "Zr", "Hf")
ELASTIC_COLUMNS = ("C11", "C12", "C13", "C33", "C44")  # after the temperature column
HILL_FIRST_COLUMN = 9  # T, 4 Voigt, 4 Reuss, then Hill: Young, shear, bulk, Poisson


def read_table(tar, name):
    raw = bz2.decompress(tar.extractfile(name).read()).decode()
    rows = [line.split() for line in raw.splitlines() if line.strip() and not line.startswith("#")]
    return [[float(v) for v in row] for row in rows]


def main():
    out = {"source": ARCHIVE.name, "units": {"temperature": "K", "moduli": "GPa"}, "compounds": []}
    grid = None
    with tarfile.open(ARCHIVE) as tar:
        for anion, (pattern, structure) in ANIONS.items():
            for metal in METALS:
                base = f"UHTCs_data/{anion}/{metal}"
                elastic = read_table(tar, f"{base}/elasctic_constants_T.dat.bz2")
                mech = read_table(tar, f"{base}/mechanical_properties_T.dat.bz2")
                temps = [row[0] for row in elastic]
                if temps != [row[0] for row in mech]:
                    sys.exit(f"{base}: temperature grids differ between files")
                if grid is None:
                    grid = temps
                elif temps != grid:
                    sys.exit(f"{base}: temperature grid differs from the other compounds")
                if any(len(row) != 6 for row in elastic) or any(len(row) != 17 for row in mech):
                    sys.exit(f"{base}: unexpected number of columns")
                cols = {c: [row[i + 1] for row in elastic] for i, c in enumerate(ELASTIC_COLUMNS)}
                if structure == "cubic":
                    # Cubic crystals have three independent constants; the files repeat them.
                    if cols["C13"] != cols["C12"] or cols["C33"] != cols["C11"]:
                        sys.exit(f"{base}: expected C13 = C12 and C33 = C11 for a cubic crystal")
                    cols = {c: cols[c] for c in ("C11", "C12", "C44")}
                h = HILL_FIRST_COLUMN
                out["compounds"].append({
                    "formula": pattern.format(m=metal),
                    "structure": structure,
                    "elastic": cols,
                    "hill": {
                        "Young": [row[h] for row in mech],
                        "shear": [row[h + 1] for row in mech],
                        "bulk": [row[h + 2] for row in mech],
                    },
                })
    out["temperature"] = grid
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {len(out['compounds'])} compounds, "
          f"{len(grid)} temperatures from {grid[0]:g} to {grid[-1]:g} K")


if __name__ == "__main__":
    main()
