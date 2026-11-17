#!/usr/bin/env python3
"""Build data/results.json, the file behind the charts on results.html.

The numbers are read out of the group's own figures in RES/:

  RES/CoSb3.pdf      vector plot. Points are taken from the plotted paths and
                     converted with the axis frame (exact to the plot's precision).
  RES/TiB2_mod.pdf   vector plot. Experimental markers are taken from the circle
                     paths (the calculated lines come from UHTCs_data.tar instead).
  RES/CoSb3_zT.pdf   colour map stored as an image. Each cell is converted back to
                     a zT value with the figure's own colour bar, so these values
                     are approximate (about +/- 0.01 to 0.02).

Needs poppler (pdftocairo, pdfimages) and Pillow.
Run from the repository root:  python3 tools/build_results_json.py
"""
import bisect
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "RES"
OUTPUT = ROOT / "data" / "results.json"


def svg_paths(pdf, workdir):
    """Paths of the drawing: (attributes, list of (x, y) in the plot's own units)."""
    svg = Path(workdir) / (pdf.stem + ".svg")
    subprocess.run(["pdftocairo", "-svg", str(pdf), str(svg)], check=True)
    body = svg.read_text().split("</defs>")[-1]
    out = []
    for tag in re.findall(r"<path[^>]*>", body):
        d = re.search(r' d="([^"]*)"', tag).group(1)
        nums = [float(v) for v in re.findall(r"-?\d+\.?\d*", d)]
        out.append((tag, list(zip(nums[0::2], nums[1::2]))))
    return out


def colour_of(tag, attribute):
    m = re.search(attribute + r'="rgb\(([^)]*)\)"', tag)
    return m.group(1) if m else None


def centre(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def cosb3_convergence(workdir):
    """Lattice thermal conductivity and force error against training-set size."""
    paths = svg_paths(RES / "CoSb3.pdf", workdir)
    frame = next(p for t, p in paths if colour_of(t, "stroke") == "0%, 0%, 0%" and len(p) >= 5)
    left, right = min(x for x, _ in frame), max(x for x, _ in frame)
    top, bottom = min(y for _, y in frame), max(y for _, y in frame)   # y grows downwards
    green, blue = "46.665955%, 67.451477%, 18.823242%", "0%, 44.7052%, 74.118042%"

    def line(colour):
        return next(p for t, p in paths if colour_of(t, "stroke") == colour and 'fill="none"' in t and len(p) == 8)

    # x axis runs 0..20 across the frame; the points sit on 4, 6, ..., 18 supercells.
    def n_cells(x):
        return 20 * (x - left) / (right - left)

    kappa_per_unit = (bottom - top) / 11.5      # left axis: 0 at the bottom, ticks every 3, top at 11.5
    rmse_per_unit = (bottom - top) / 80.0       # right axis: 0..80 over the full frame
    kappa = [(n_cells(x), (bottom - y) / kappa_per_unit) for x, y in line(green)]
    rmse = [(n_cells(x), (bottom - y) / rmse_per_unit) for x, y in line(blue)]
    cells = [round(n) for n, _ in kappa]
    if cells != list(range(4, 20, 2)) or [round(n) for n, _ in rmse] != cells:
        sys.exit("CoSb3.pdf: the points are not on 4, 6, ..., 18 supercells; check the axis calibration")
    if any(abs(n - round(n)) > 0.05 for n, _ in kappa + rmse):
        sys.exit("CoSb3.pdf: x calibration is off")
    dashed = sorted((bottom - p[0][1]) / kappa_per_unit for t, p in paths
                    if colour_of(t, "stroke") == green and "stroke-dasharray" in t)
    if len(dashed) != 2:
        sys.exit("CoSb3.pdf: expected two dashed reference lines")
    return {
        "supercells": cells,
        "kappa_W_mK": [round(v, 2) for _, v in kappa],
        "rmse_meV_A": [round(v, 1) for _, v in rmse],
        "reference_kappa_W_mK": {"PBE": round(dashed[0], 2), "LDA": round(dashed[1], 2)},
        "source": "RES/CoSb3.pdf",
    }


def tib2_experiment(workdir):
    """Experimental elastic constants of TiB2 plotted in the comparison figure."""
    paths = svg_paths(RES / "TiB2_mod.pdf", workdir)
    frame = next(p for t, p in paths if colour_of(t, "stroke") == "0%, 0%, 0%" and len(p) == 5)
    left, right = min(x for x, _ in frame), max(x for x, _ in frame)
    low, high = min(y for _, y in frame), max(y for _, y in frame)     # y grows upwards here
    gpa = lambda y: (y - low) / ((high - low) / 775.0)                 # frame spans 0..775 GPa (ticks every 100)
    kelvin = lambda x: 2000.0 * (x - left) / (right - left)
    names = {"0%, 45.097351%, 74.118042%": "C11", "49.01886%, 18.03894%, 56.079102%": "C33",
             "47.058105%, 67.059326%, 18.823242%": "C44", "92.941284%, 69.020081%, 12.940979%": "C13",
             "85.098267%, 32.940674%, 10.195923%": "C12"}
    out = {}
    for tag, points in paths:
        name = names.get(colour_of(tag, "stroke"))
        if name and len(points) == 13:                                  # a circle marker
            x, y = centre(points)
            if kelvin(x) > 2000 or gpa(y) > 700:                        # the legend sample
                continue
            out.setdefault(name, []).append([round(kelvin(x)), round(gpa(y), 1)])
    for name in out:
        out[name].sort()
    if sorted(out) != ["C11", "C12", "C13", "C33", "C44"]:
        sys.exit("TiB2_mod.pdf: did not find the five experimental series")
    return {"points_K_GPa": out, "source": "RES/TiB2_mod.pdf"}


def cosb3_zt(workdir):
    """zT of p-type CoSb3 on a temperature / carrier-concentration grid."""
    prefix = str(Path(workdir) / "zt")
    subprocess.run(["pdfimages", "-png", str(RES / "CoSb3_zT.pdf"), prefix], check=True)
    field = Image.open(prefix + "-000.png").convert("RGB")
    bar = Image.open(prefix + "-001.png").convert("RGB")
    # Colour bar: top row is the largest value. Limits follow from its ticks (0.2 ... 1.0).
    zt_min, zt_max = 0.0186, 1.1164
    light = lambda rgb: rgb[0] + rgb[1] + rgb[2]
    scale = [light(bar.getpixel((bar.width // 2, row))) for row in range(bar.height)]
    if any(b < a for a, b in zip(scale, scale[1:])):
        sys.exit("CoSb3_zT.pdf: colour bar is not monotonic; cannot convert colours to values")

    def value(rgb):
        row = min(bisect.bisect_left(scale, light(rgb)), bar.height - 1)
        return zt_max - (zt_max - zt_min) * row / (bar.height - 1)

    temps = [300 + 12.5 * i for i in range(57)]                # image spans 300..1000 K
    logn = [17 + 0.0625 * j for j in range(49)]                # and 1e17..1e20 cm^-3, top row = 1e20
    grid = []
    for ln in logn:
        py = (20 - ln) / 3 * (field.height - 1)
        row = []
        for t in temps:
            px = (t - 300) / 700 * (field.width - 1)
            block = [field.getpixel((min(max(int(px) + dx, 0), field.width - 1), min(max(int(py) + dy, 0), field.height - 1)))
                     for dx in (-3, 0, 3) for dy in (-3, 0, 3)]
            row.append(round(sum(value(c) for c in block) / len(block), 3))
        grid.append(row)
    return {"temperature_K": temps, "log10_carriers_cm3": logn, "zT": grid,
            "source": "RES/CoSb3_zT.pdf", "note": "read back from the colour scale of the figure; approximate"}


def main():
    with tempfile.TemporaryDirectory() as workdir:
        out = {"cosb3_convergence": cosb3_convergence(workdir),
               "tib2_experiment": tib2_experiment(workdir),
               "cosb3_zt": cosb3_zt(workdir)}
    OUTPUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    conv, zt = out["cosb3_convergence"], out["cosb3_zt"]
    print("wrote", OUTPUT.relative_to(ROOT))
    print("  kappa:", conv["kappa_W_mK"], "rmse:", conv["rmse_meV_A"], "refs:", conv["reference_kappa_W_mK"])
    print("  TiB2 exp points:", {k: len(v) for k, v in out["tib2_experiment"]["points_K_GPa"].items()})
    best = max((v, t, n) for n, row in zip(zt["log10_carriers_cm3"], zt["zT"]) for t, v in zip(zt["temperature_K"], row))
    print("  zT max %.2f at %g K, 10^%.2f cm-3; zT range %.2f..%.2f" % (best + (min(min(r) for r in zt["zT"]), best[0])))


if __name__ == "__main__":
    main()
