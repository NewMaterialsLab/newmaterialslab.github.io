#!/usr/bin/env python3
"""Build data/results.json, the file behind the charts on results.html.

The numbers are read out of the group's own figures in RES/:

  RES/CoSb3.pdf      vector plot. Points are taken from the plotted paths and
                     converted with the axis frame (exact to the plot's precision).
  RES/CoSb3_AMSET.pdf  vector plot of three stacked panels. Markers are read from the
                     circle paths and converted with the figure's own tick marks.
  RES/xps_core_level_binding_energies_2026.pdf  the open-access XPS paper (CC-BY 4.0). Figures 2-5
                     are vector drawings: scatter markers, tick marks and the fitted spectra are read
                     from them, and the method statistics are checked against the printed values.
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



XPS_PDF = RES / "xps_core_level_binding_energies_2026.pdf"
XPS_BLUE = "rgb(12.199402%, 46.699524%, 70.599365%)"


def page_shapes(pdf, page, workdir):
    """Every path on one PDF page with its points in page coordinates."""
    svg = Path(workdir) / ("%s-p%d.svg" % (pdf.stem, page))
    subprocess.run(["pdftocairo", "-svg", "-f", str(page), "-l", str(page), str(pdf), str(svg)], check=True)
    out = []
    for tag in re.findall(r"<path[^>]*>", svg.read_text().split("</defs>")[-1]):
        d = re.search(r' d="([^"]*)"', tag).group(1)
        tr = re.search(r'transform="matrix\(([^)]*)\)"', tag)
        nums = [float(v) for v in re.findall(r"-?\d+\.?\d*(?:e-?\d+)?", d)]
        m = [float(v) for v in tr.group(1).split(",")] if tr else [1, 0, 0, 1, 0, 0]
        pts = [(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]) for x, y in zip(nums[0::2], nums[1::2])]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        out.append({"fill": colour_of(tag, "fill"), "stroke": colour_of(tag, "stroke"), "cmds": "".join(re.findall("[A-Za-z]", d)),
                    "P": pts, "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys)})
    return out


def even(ticks, what):
    steps = [abs(b - a) for a, b in zip(ticks, ticks[1:])]
    if max(steps) - min(steps) > 0.06:
        sys.exit("%s: ticks are not evenly spaced: %s" % (what, steps))


def xps_methods(workdir):
    """ΔE_theo against ΔE_exp for five methods (Figures 2-4 of the XPS paper).

    Marker area encodes the weight ω of each pair (eq 3), so the weighted statistics of eqs 4 and 6
    can be recomputed and checked against the values printed in the figures.
    """
    plots = {(4, 0): ("PBE-FS", [262, 260, 258, 256, 254, 252]), (4, 1): ("PBE-JS", [252, 250, 248, 246, 244]),
             (5, 0): ("PBE-FSn", [262, 260, 258, 256, 254]), (5, 1): ("PBE-JSn", [252, 250, 248, 246, 244]),
             (6, 0): ("LMBJ-JSn", [248, 246, 244, 242])}
    printed = {"PBE-FS": (12.6, 1.7, 1.2), "PBE-JS": (2.9, 1.0, 0.7), "PBE-FSn": (12.18, 0.44, 0.31),
               "PBE-JSn": (2.82, 0.23, 0.16), "LMBJ-JSn": (-0.25, 0.30, 0.21)}
    xlabels = [242, 244, 246, 248]
    methods = {}
    for page in (4, 5, 6):
        shapes = page_shapes(XPS_PDF, page, workdir)
        segs = [e["P"] for e in shapes if e["stroke"] == "0%, 0%, 0%" and e["fill"] in (None, "none") and len(e["P"]) == 2]
        spines = [(a, b) for a, b in segs if abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) > 50]
        marks = [((e["x0"] + e["x1"]) / 2, (e["y0"] + e["y1"]) / 2, (e["x1"] - e["x0"]) / 2)
                 for e in shapes if e["fill"] == XPS_BLUE.replace("rgb(", "").rstrip(")") and e["cmds"].startswith("MCCCCC")]
        boxes = set()
        for a, b in spines:
            x0, top, bot = a[0], min(a[1], b[1]), max(a[1], b[1])
            right = [s[0][0] for s in spines if s[0][0] > x0 + 10 and abs(min(s[0][1], s[1][1]) - top) < 0.1]
            if right and any(x0 < m[0] < min(right) and top < m[1] < bot for m in marks):
                boxes.add((x0, min(right), top, bot))
        for k, (x0, x1, top, bot) in enumerate(sorted(boxes)):
            name, ylabels = plots[(page, k)]
            inside = [m for m in marks if x0 < m[0] < x1 and top < m[1] < bot]
            yt = sorted({round(a[1], 3) for a, b in segs if abs(a[0] - x0) < 0.05 and abs(a[1] - b[1]) < 1e-6 and 2 < abs(b[0] - a[0]) < 2.5 and top - 0.1 <= a[1] <= bot + 0.1})
            xt = sorted({round(a[0], 3) for a, b in segs if abs(a[1] - bot) < 0.05 and abs(a[0] - b[0]) < 1e-6 and 2 < abs(b[1] - a[1]) < 2.5 and x0 - 0.1 <= a[0] <= x1 + 0.1})
            if len(yt) != len(ylabels) or len(xt) != len(xlabels) or len(inside) != 32:
                sys.exit("XPS %s: %d y ticks, %d x ticks, %d points" % (name, len(yt), len(xt), len(inside)))
            even(yt, name); even(xt, name)
            fx = lambda x: xlabels[0] + (x - xt[0]) * (xlabels[-1] - xlabels[0]) / (xt[-1] - xt[0])
            fy = lambda y: ylabels[0] + (y - yt[0]) * (ylabels[-1] - ylabels[0]) / (yt[-1] - yt[0])
            rmax = max(m[2] for m in inside)
            weights = (0.5, 2 / 3, 0.75, 1.0)
            pts = sorted([round(fx(m[0]), 3), round(fy(m[1]), 3), min(weights, key=lambda w: abs(w - (m[2] / rmax) ** 2))] for m in inside)
            W = sum(p[2] for p in pts)
            delta = sum(p[2] * (p[1] - p[0]) for p in pts) / W
            neff = W ** 2 / sum(p[2] ** 2 for p in pts)
            sigma = (neff / (neff - 1) * sum(p[2] * (p[1] - delta - p[0]) ** 2 for p in pts) / W) ** 0.5
            ref = printed[name]
            for got, want, label in ((delta, ref[0], "delta"), (sigma, ref[1], "sigma_dE"), (sigma / 2 ** 0.5, ref[2], "sigma_BE")):
                if abs(got - want) > 0.051:
                    sys.exit("XPS %s: %s %.3f does not match the printed %.2f" % (name, label, got, want))
            methods[name] = {"points": pts, "delta": round(delta, 3), "sigma_dE": round(sigma, 3), "sigma_BE": round(sigma / 2 ** 0.5, 3)}
    xs = [[p[0] for p in m["points"]] for m in methods.values()]
    if any(max(abs(a - b) for a, b in zip(x, xs[0])) > 0.02 for x in xs):
        sys.exit("XPS: the experimental values differ between plots")
    return methods


def xps_spectra(workdir):
    """Experimental C 1s and O 1s spectra of anhydrous citric acid with the fitted components (Figure 5c,d)."""
    shapes = page_shapes(XPS_PDF, 8, workdir)
    black, red = "0%, 0%, 0%", "83.898926%, 15.299988%, 15.699768%"
    roles = {"0.39978%, 45.098877%, 69.799805%": 0, "87.098694%, 56.098938%, 1.998901%": 1, "0.799561%, 61.999512%, 45.098877%": 2,
             "79.998779%, 47.099304%, 73.699951%": 3, "50.19989%, 50.19989%, 50.19989%": "background", black: "envelope"}
    panels = {
        "C1s": {"box": (94.02, 299.29, 273.81, 414.67), "xl": [292, 290, 288, 286, 284, 282, 280], "yl": [0, 10, 20, 30, 40, 50, 60],
                "names": ["C*OOH", "C*H2", "C*OH (central)"], "unit": "×10⁻² counts per channel"},
        "O1s": {"box": (344.44, 549.71, 273.81, 414.67), "xl": [536, 534, 532, 530, 528, 526], "yl": [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20],
                "names": ["CO*(OH)", "CO(O*H)", "O*H", "H2O (ads.)"], "unit": "×10⁻³ counts per channel"},
    }
    out = {}
    for key, pn in panels.items():
        L, R, T, B = pn["box"]
        ticks = [e for e in shapes if e["fill"] == black and e["cmds"] == "MLLL" and max(e["x1"] - e["x0"], e["y1"] - e["y0"]) < 3]
        xt = sorted((e["x0"] + e["x1"]) / 2 for e in ticks if L - 0.5 < e["x0"] and e["x1"] < R + 0.5 and abs(e["y1"] - B) < 0.3 and e["y1"] - e["y0"] > 1.5)
        yt = sorted(((e["y0"] + e["y1"]) / 2 for e in ticks if abs(e["x0"] - L) < 0.3 and T - 0.5 < e["y0"] and e["y1"] < B + 0.5 and e["x1"] - e["x0"] > 1.5), reverse=True)
        if len(xt) != len(pn["xl"]) or len(yt) != len(pn["yl"]):
            sys.exit("XPS %s: found %d x ticks and %d y ticks" % (key, len(xt), len(yt)))
        even(xt, key); even(yt, key)
        fx = lambda x: pn["xl"][0] + (x - xt[0]) * (pn["xl"][-1] - pn["xl"][0]) / (xt[-1] - xt[0])
        fy = lambda y: pn["yl"][0] + (y - yt[0]) * (pn["yl"][-1] - pn["yl"][0]) / (yt[-1] - yt[0])
        data = sorted([round(fx((e["x0"] + e["x1"]) / 2), 3), round(fy((e["y0"] + e["y1"]) / 2), 3)] for e in shapes
                      if e["fill"] == red and e["cmds"].startswith("MCCC") and e["x1"] - e["x0"] < 1.5 and L < e["x0"] < R and T < e["y0"] < B)
        lo, hi = min(pn["xl"]), max(pn["xl"])
        curves = {}
        for e in shapes:
            role = roles.get(e["fill"])
            if role is None or len(e["P"]) < 300 or e["x1"] - e["x0"] < 150 or not (T - 5 < e["y0"] and e["y1"] < B + 5):
                continue
            if not L < (e["x0"] + e["x1"]) / 2 < R:    # lines run past the frame on both sides; their centre is inside it
                continue
            # Lines were exported as thin filled outlines: take the mean height of the outline in 0.1 eV columns,
            # then resample on a 0.05 eV grid.
            cols = {}
            for x, y in e["P"]:
                if L <= x <= R:
                    cols.setdefault(round(fx(x) / 0.1), []).append(fy(y))
            pts = sorted((k * 0.1, sum(v) / len(v)) for k, v in cols.items())
            xs = [p[0] for p in pts]
            line = []
            for n in range(int(round((hi - lo) / 0.05)) + 1):
                g = lo + n * 0.05
                if xs[0] <= g <= xs[-1]:
                    j = max(1, bisect.bisect_left(xs, g))
                    (xa, ya), (xb, yb) = pts[j - 1], pts[j]
                    line.append([round(g, 2), round(ya + (yb - ya) * (g - xa) / (xb - xa) if xb > xa else ya, 3)])
            name = pn["names"][role] if isinstance(role, int) else role
            if name in curves:
                sys.exit("XPS %s: two curves for %s" % (key, name))
            curves[name] = line
        if set(curves) != set(pn["names"] + ["background", "envelope"]):
            sys.exit("XPS %s: curves found %s" % (key, sorted(curves)))
        grid = {k: dict((x, y) for x, y in v) for k, v in curves.items()}
        common = set.intersection(*[set(g) for g in grid.values()])
        resid = sorted(abs(grid["envelope"][x] - grid["background"][x] - sum(grid[n][x] - grid["background"][x] for n in pn["names"])) for x in common)
        peak = max(grid["envelope"].values())
        if resid[len(resid) // 2] > 0.01 * peak:
            sys.exit("XPS %s: components do not add up to the envelope (median %.3f)" % (key, resid[len(resid) // 2]))
        out[key] = {"unit": pn["unit"], "components": pn["names"], "data": data, "curves": curves}
    # Table 1 of the paper: ΔBE (eV) from the highest-BE signal of each element, MD average and experiment
    out["table1"] = {"C1s": {"reference": "C*OOH", "rows": [["C*OH (central)", 2.09, 2.36], ["C*H2", 3.96, 4.02]]},
                     "O1s": {"reference": "CO(O*H)", "rows": [["O*H", 0.88, 0.70], ["CO*(OH)", 1.19, 1.46]]}}
    return out

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
               "xps_methods": xps_methods(workdir),
               "xps_spectra": xps_spectra(workdir),
               "cosb3_zt": cosb3_zt(workdir)}
    OUTPUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    conv, zt = out["cosb3_convergence"], out["cosb3_zt"]
    print("wrote", OUTPUT.relative_to(ROOT))
    print("  kappa:", conv["kappa_W_mK"], "rmse:", conv["rmse_meV_A"], "refs:", conv["reference_kappa_W_mK"])
    print("  TiB2 exp points:", {k: len(v) for k, v in out["tib2_experiment"]["points_K_GPa"].items()})
    print("  CoSb3 transport points per panel (rho, S, PF):", out["cosb3_transport"]["counts"])
    for name, m in out["xps_methods"].items():
        print("  XPS %-8s delta %.3f eV, sigma_dE %.3f eV, sigma_BE %.3f eV" % (name, m["delta"], m["sigma_dE"], m["sigma_BE"]))
    for key in ("C1s", "O1s"):
        sp = out["xps_spectra"][key]
        print("  XPS %s: %d data points, curves %s" % (key, len(sp["data"]), ", ".join(sorted(sp["curves"]))))
    best = max((v, t, n) for n, row in zip(zt["log10_carriers_cm3"], zt["zT"]) for t, v in zip(zt["temperature_K"], row))
    print("  zT max %.2f at %g K, 10^%.2f cm-3; zT range %.2f..%.2f" % (best + (min(min(r) for r in zt["zT"]), best[0])))


if __name__ == "__main__":
    main()
