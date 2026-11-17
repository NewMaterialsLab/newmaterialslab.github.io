#!/usr/bin/env python3
"""Build data/results.json, the file behind the charts on results.html.

The numbers are read out of the group's own figures in RES/:

  RES/CoSb3.pdf      vector plot. Points are taken from the plotted paths and
                     converted with the axis frame (exact to the plot's precision).
  RES/CoSb3_AMSET.pdf  vector plot of three stacked panels. Markers are read from the
                     circle paths and converted with the figure's own tick marks.
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
    out, lines = {}, {}
    for tag, points in paths:
        name = names.get(colour_of(tag, "stroke"))
        if not name:
            continue
        if len(points) == 13:                                           # a circle marker
            x, y = centre(points)
            if kelvin(x) > 2000 or gpa(y) > 700:                        # the legend sample
                continue
            out.setdefault(name, []).append([round(kelvin(x)), round(gpa(y), 1)])
        elif "C" not in re.search(r' d="([^"]*)"', tag).group(1):       # the calculated line (straight segments)
            if name in lines:
                sys.exit("TiB2_mod.pdf: more than one calculated line for %s" % name)
            lines[name] = [[round(kelvin(x)), round(gpa(y), 1)] for x, y in points]
    for name in out:
        out[name].sort()
    if sorted(out) != ["C11", "C12", "C13", "C33", "C44"] or sorted(lines) != sorted(out):
        sys.exit("TiB2_mod.pdf: did not find the five experimental series and their calculated lines")
    return {"points_K_GPa": out, "lines_K_GPa": lines, "source": "RES/TiB2_mod.pdf"}


def cosb3_transport(workdir):
    """Resistivity, Seebeck coefficient and power factor of CoSb3 against carrier concentration.

    Three stacked panels share a log x axis (1e16 to 1e22 cm^-3). Axes are calibrated from the
    figure's own major tick marks; markers are circles whose bounding-box centre is the point.
    Filled = calculated (AMSET), hollow = experiment (monocrystalline); green = p-type, blue = n-type.
    """
    pdf = RES / "CoSb3_AMSET.pdf"
    svg = Path(workdir) / "amset.svg"
    subprocess.run(["pdftocairo", "-svg", str(pdf), str(svg)], check=True)
    body = svg.read_text().split("</defs>")[-1]
    segments, marks = [], []
    green, blue = "46.665955%, 67.451477%, 18.823242%", "0%, 44.7052%, 74.118042%"
    for tag in re.findall(r"<path[^>]*>", body):
        d = re.search(r' d="([^"]*)"', tag).group(1)
        stroke = colour_of(tag, "stroke")
        if stroke == "0%, 0%, 0%":
            for x1, y1, x2, y2 in re.findall(r"M\s*([-\d.]+)\s+([-\d.]+)\s+L\s*([-\d.]+)\s+([-\d.]+)", d):
                segments.append(tuple(map(float, (x1, y1, x2, y2))))
        elif stroke in (green, blue):
            nums = [float(v) for v in re.findall(r"-?\d+\.?\d*", d)]
            marks.append({"type": "p" if stroke == green else "n", "filled": colour_of(tag, "fill") is not None,
                          "x": (min(nums[0::2]) + max(nums[0::2])) / 2, "y": (min(nums[1::2]) + max(nums[1::2])) / 2})

    def major_ticks(test):
        """Positions of long (major) tick marks that pass the test, sorted."""
        return sorted({round(v, 3) for v in (test(s) for s in segments) if v is not None})

    left = min(s[0] for s in segments)
    bottom = max(s[1] for s in segments)
    xs = major_ticks(lambda s: s[0] if abs(s[1] - bottom) < 0.06 and abs(s[0] - s[2]) < 1e-6 and 4 < abs(s[3] - s[1]) < 6 else None)
    ys = major_ticks(lambda s: s[1] if abs(s[0] - left) < 0.06 and abs(s[1] - s[3]) < 1e-6 and 4 < abs(s[2] - s[0]) < 6 else None)
    if len(xs) != 7:
        sys.exit("CoSb3_AMSET.pdf: expected 7 decade ticks on the x axis, found %d" % len(xs))
    # Left-edge major ticks, top to bottom: rho 1000 ... 0.01 (6, the last on the border with S),
    # S 600 ... -900 (6, inside the panel), PF 120 ... 0 (7, the first on the border with S).
    if len(ys) != 19:
        sys.exit("CoSb3_AMSET.pdf: unexpected tick layout %s" % ys)
    rho, seebeck, pf = ys[0:6], ys[6:12], ys[12:19]

    def linear(ticks, values):
        """Map a y position to a value through two ticks, after checking the ticks are evenly spaced."""
        steps = [b - a for a, b in zip(ticks, ticks[1:])]
        if max(steps) - min(steps) > 0.06:
            sys.exit("CoSb3_AMSET.pdf: ticks are not evenly spaced: %s" % steps)
        (y0, y1), (v0, v1) = (ticks[0], ticks[-1]), (values[0], values[-1])
        return lambda y: v0 + (y - y0) * (v1 - v0) / (y1 - y0)

    log_n = linear(xs, [16, 22])
    to_log_rho = linear(rho, [3, -2])
    to_seebeck = linear(seebeck, [600, -900])
    to_pf = linear(pf, [120, 0])
    panel_bounds = [(rho[0], rho[-1]), (rho[-1], pf[0]), (pf[0], pf[-1])]

    series = {}
    for m in marks:
        inside = [k for k, (top, low) in enumerate(panel_bounds) if top - 1 <= m["y"] <= low + 1]
        if len(inside) != 1:
            sys.exit("CoSb3_AMSET.pdf: marker at y=%.2f is on a panel border; cannot assign it" % m["y"])
        panel = inside[0]
        key = m["type"] + ("_calc" if m["filled"] else "_exp")
        value = [10 ** to_log_rho(m["y"]), to_seebeck(m["y"]), to_pf(m["y"])][panel]
        series.setdefault(key, [[], [], []])[panel].append([round(log_n(m["x"]), 3), round(value, 4 if panel == 0 else 1)])
    for key in series:
        for panel in series[key]:
            panel.sort()
    counts = {k: [len(p) for p in v] for k, v in series.items()}
    if sorted(series) != ["n_calc", "n_exp", "p_calc", "p_exp"] or sum(sum(c) for c in counts.values()) != len(marks):
        sys.exit("CoSb3_AMSET.pdf: markers not all assigned: %s" % counts)
    if any(v[0] < 0 for k in series for v in series[k][2]):
        sys.exit("CoSb3_AMSET.pdf: negative power factor; calibration is wrong")
    return {"panels": ["resistivity_mOhm_cm", "seebeck_uV_K", "power_factor_uW_cm_K2"],
            "x": "log10 carrier concentration (cm^-3)", "series": series, "counts": counts,
            "source": "RES/CoSb3_AMSET.pdf"}


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
               "cosb3_transport": cosb3_transport(workdir),
               "cosb3_zt": cosb3_zt(workdir)}
    OUTPUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    conv, zt = out["cosb3_convergence"], out["cosb3_zt"]
    print("wrote", OUTPUT.relative_to(ROOT))
    print("  kappa:", conv["kappa_W_mK"], "rmse:", conv["rmse_meV_A"], "refs:", conv["reference_kappa_W_mK"])
    print("  TiB2 exp points:", {k: len(v) for k, v in out["tib2_experiment"]["points_K_GPa"].items()})
    print("  CoSb3 transport points per panel (rho, S, PF):", out["cosb3_transport"]["counts"])
    best = max((v, t, n) for n, row in zip(zt["log10_carriers_cm3"], zt["zT"]) for t, v in zip(zt["temperature_K"], row))
    print("  zT max %.2f at %g K, 10^%.2f cm-3; zT range %.2f..%.2f" % (best + (min(min(r) for r in zt["zT"]), best[0])))


if __name__ == "__main__":
    main()
