/* Results page: four interactive figures drawn from data/results.json and data/uhtc.json. */
(function () {
    'use strict';

    if (!document.getElementById('results')) { return; }
    var SVG = 'http://www.w3.org/2000/svg';

    function el(name, attrs, text) {
        var node = document.createElementNS(SVG, name);
        Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        if (text !== undefined) { node.textContent = text; }
        return node;
    }
    function tip(node, text) { node.appendChild(el('title', {}, text)); return node; }
    function byId(id) { return document.getElementById(id); }
    function sub(formula) { return formula.replace(/(\d)/g, function (d) { return '₀₁₂₃₄₅₆₇₈₉'[d]; }); }

    /* Axes and grid for an SVG chart. Returns the scales so callers can add marks. */
    function frame(box, o) {
        var width = Math.max(280, box.clientWidth);
        var m = { top: 12, right: o.right || 16, bottom: o.xTitle ? 42 : 24, left: 44 };
        var plotW = width - m.left - m.right;
        var plotH = o.height - m.top - m.bottom;
        var svg = el('svg', { viewBox: '0 0 ' + width + ' ' + o.height, width: width, height: o.height, role: 'img', 'aria-label': o.label });
        function x(v) { return m.left + (v - o.x[0]) / (o.x[1] - o.x[0]) * plotW; }
        function y(v) { return m.top + plotH - (v - o.y[0]) / (o.y[1] - o.y[0]) * plotH; }
        for (var v = o.y[0]; !o.bars && v <= o.y[1] + 1e-9; v += o.yStep) {
            svg.appendChild(el('line', { x1: m.left, x2: m.left + plotW, y1: y(v), y2: y(v), 'class': v === o.y[0] ? 'baseline' : 'grid' }));
            svg.appendChild(el('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(Math.round(v * 100) / 100)));
        }
        (o.xTicks || []).forEach(function (t) {
            svg.appendChild(el('text', { x: x(t), y: m.top + plotH + 17, 'text-anchor': 'middle' }, String(t)));
        });
        if (o.xTitle) { svg.appendChild(el('text', { x: m.left + plotW / 2, y: o.height - 6, 'text-anchor': 'middle', 'class': 'axis-title' }, o.xTitle)); }
        box.textContent = '';
        box.appendChild(svg);
        return { svg: svg, x: x, y: y, m: m, plotW: plotW, plotH: plotH, width: width };
    }
    function path(points, f) {
        return points.map(function (p, i) { return (i ? 'L' : 'M') + f.x(p[0]).toFixed(1) + ' ' + f.y(p[1]).toFixed(1); }).join('');
    }
    function legend(list, items) {
        list.textContent = '';
        items.forEach(function (item) {
            var li = document.createElement('li');
            var swatch = document.createElement('i');
            swatch.style.borderTopColor = item.colour;
            if (item.dashed) { swatch.style.borderTopStyle = 'dashed'; }
            li.appendChild(swatch);
            li.appendChild(document.createTextNode(item.label));
            list.appendChild(li);
        });
    }
    var redraws = [];
    function onResize(fn) { redraws.push(fn); fn(); }
    var timer = null;
    window.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { redraws.forEach(function (fn) { fn(); }); }, 150);
    });

    /* 1. CoSb3: conductivity and force error against the size of the training set */
    function convergence(d) {
        var slider = byId('conv-n');
        slider.max = d.supercells.length - 1;
        slider.value = 3;
        function draw() {
            var i = Number(slider.value);
            var n = d.supercells[i];
            byId('conv-n-value').textContent = n + ' supercells';
            byId('conv-kappa').textContent = d.kappa_W_mK[i].toFixed(1);
            byId('conv-rmse').textContent = d.rmse_meV_A[i].toFixed(1);
            [['conv-chart-kappa', d.kappa_W_mK, [0, 12], 3, 'var(--series-3)', 'Lattice thermal conductivity', ' W/(m·K)', false],
             ['conv-chart-rmse', d.rmse_meV_A, [0, 80], 20, 'var(--series-1)', 'Force error', ' meV/Å', true]].forEach(function (c) {
                var f = frame(byId(c[0]), { height: c[7] ? 190 : 170, x: [2, 20], y: c[2], yStep: c[3], right: 52,
                    xTicks: c[7] ? d.supercells : [], xTitle: c[7] ? 'Supercells in the training set' : '',
                    label: c[5] + ' of CoSb₃ against the number of supercells in the training set' });
                if (!c[7]) {
                    Object.keys(d.reference_kappa_W_mK).forEach(function (name) {
                        var v = d.reference_kappa_W_mK[name];
                        f.svg.appendChild(el('line', { x1: f.m.left, x2: f.m.left + f.plotW, y1: f.y(v), y2: f.y(v), 'class': 'ref' }));
                        f.svg.appendChild(el('text', { x: f.m.left + f.plotW + 6, y: f.y(v) + 4, 'class': 'end-label' }, name));
                    });
                }
                var points = d.supercells.map(function (s, k) { return [s, c[1][k]]; });
                f.svg.appendChild(el('path', { d: path(points, f), 'class': 'series', style: 'stroke:' + c[4] }));
                points.forEach(function (p, k) {
                    var on = k === i;
                    f.svg.appendChild(tip(el('circle', { cx: f.x(p[0]), cy: f.y(p[1]), r: on ? 7 : 4.5, 'class': 'marker' + (on ? ' marker--on' : ''),
                        style: on ? 'fill:' + c[4] : 'stroke:' + c[4] }), p[0] + ' supercells: ' + p[1] + c[6]));
                });
                f.svg.appendChild(el('line', { x1: f.x(n), x2: f.x(n), y1: f.m.top, y2: f.m.top + f.plotH, 'class': 'cursor' }));
            });
        }
        slider.addEventListener('input', draw);
        onResize(draw);
    }

    /* 2. zT of p-type CoSb3 on a temperature / carrier-concentration map */
    function ztMap(d) {
        var canvas = byId('zt-canvas');
        var ctx = canvas.getContext('2d');
        var temps = d.temperature_K;
        var logn = d.log10_carriers_cm3;
        var sT = byId('zt-t');
        var sN = byId('zt-n');
        sT.max = temps.length - 1;
        sN.max = logn.length - 1;
        var STOPS = [[0, [27, 20, 55]], [0.2, [43, 30, 107]], [0.4, [122, 42, 138]], [0.6, [212, 54, 92]], [0.8, [249, 123, 42]], [1, [255, 201, 74]]];
        function colour(v) {
            v = Math.max(0, Math.min(1, v));
            for (var k = 1; k < STOPS.length; k += 1) {
                if (v <= STOPS[k][0]) {
                    var a = STOPS[k - 1], b = STOPS[k], f = (v - a[0]) / (b[0] - a[0]);
                    return [a[1][0] + f * (b[1][0] - a[1][0]), a[1][1] + f * (b[1][1] - a[1][1]), a[1][2] + f * (b[1][2] - a[1][2])];
                }
            }
            return STOPS[STOPS.length - 1][1];
        }
        /* One pixel per grid cell, scaled up smoothly when drawn. Row 0 is the highest concentration. */
        var cells = document.createElement('canvas');
        cells.width = temps.length;
        cells.height = logn.length;
        var image = cells.getContext('2d').createImageData(temps.length, logn.length);
        logn.forEach(function (unused, j) {
            temps.forEach(function (unused2, i) {
                var c = colour(d.zT[logn.length - 1 - j][i]);
                var o = (j * temps.length + i) * 4;
                image.data[o] = c[0]; image.data[o + 1] = c[1]; image.data[o + 2] = c[2]; image.data[o + 3] = 255;
            });
        });
        cells.getContext('2d').putImageData(image, 0, 0);
        var best = { v: -1 };
        d.zT.forEach(function (row, j) { row.forEach(function (v, i) { if (v > best.v) { best = { v: v, i: i, j: j }; } }); });
        sT.value = best.i;
        sN.value = best.j;
        var box = {};

        function sci(log) {
            var exp = Math.floor(log + 1e-9);
            var mant = Math.pow(10, log - exp);
            return mant.toFixed(1) + ' × 10' + String(exp).replace(/\d/g, function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]; }) + ' cm⁻³';
        }
        function draw() {
            var i = Number(sT.value), j = Number(sN.value);
            var rect = canvas.getBoundingClientRect();
            var ratio = Math.min(window.devicePixelRatio || 1, 2);
            var w = Math.max(260, rect.width), h = rect.height;
            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            box = { l: 50, t: 10, w: w - 50 - 22, h: h - 10 - 40 };
            ctx.clearRect(0, 0, w, h);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(cells, box.l, box.t, box.w, box.h);
            ctx.font = '12px Figtree, "Segoe UI", sans-serif';
            ctx.fillStyle = '#BDB6D6';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'right';
            [17, 18, 19, 20].forEach(function (e) {
                ctx.fillText('10' + String(e).replace(/\d/g, function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]; }), box.l - 8, box.t + box.h - (e - 17) / 3 * box.h);
            });
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            [300, 500, 750, 1000].forEach(function (t) { ctx.fillText(String(t), box.l + (t - 300) / 700 * box.w, box.t + box.h + 16); });
            ctx.fillStyle = '#F3F0FA';
            ctx.fillText('Temperature (K)', box.l + box.w / 2, h - 5);
            ctx.save();
            ctx.translate(11, box.t + box.h / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Carriers (cm⁻³)', 0, 0);
            ctx.restore();
            var cx = box.l + i / (temps.length - 1) * box.w;
            var cy = box.t + box.h - j / (logn.length - 1) * box.h;
            ctx.strokeStyle = 'rgba(243,240,250,0.75)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(cx, box.t); ctx.lineTo(cx, box.t + box.h);
            ctx.moveTo(box.l, cy); ctx.lineTo(box.l + box.w, cy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(cx, cy, 6, 0, 6.283);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#FFFFFF';
            ctx.stroke();
            byId('zt-value').textContent = d.zT[j][i].toFixed(2);
            byId('zt-t-value').textContent = Math.round(temps[i]) + ' K';
            byId('zt-n-value').textContent = sci(logn[j]);
        }
        function point(event) {
            var rect = canvas.getBoundingClientRect();
            var fx = (event.clientX - rect.left - box.l) / box.w;
            var fy = 1 - (event.clientY - rect.top - box.t) / box.h;
            sT.value = Math.round(Math.max(0, Math.min(1, fx)) * (temps.length - 1));
            sN.value = Math.round(Math.max(0, Math.min(1, fy)) * (logn.length - 1));
            draw();
        }
        canvas.addEventListener('pointermove', function (event) { if (event.pointerType === 'mouse' || event.buttons) { point(event); } });
        canvas.addEventListener('pointerdown', point);
        sT.addEventListener('input', draw);
        sN.addEventListener('input', draw);
        if (document.fonts && document.fonts.ready) { document.fonts.ready.then(draw); }
        onResize(draw);
    }

    /* 3. TiB2: calculated elastic constants against the experimental points */
    function tib2(exp, uhtc) {
        var compound = uhtc.compounds.filter(function (c) { return c.formula === 'TiB2'; })[0];
        var names = [['C11', 'C₁₁', 1], ['C33', 'C₃₃', 4], ['C44', 'C₄₄', 5], ['C13', 'C₁₃', 3], ['C12', 'C₁₂', 2]];
        legend(byId('tib2-legend'), [{ label: 'Calculated (line)', colour: 'var(--muted)' }, { label: 'Experiment (circles)', colour: 'var(--muted)', dashed: true }]);
        onResize(function () {
            var f = frame(byId('tib2-chart'), { height: 330, x: [0, 2000], y: [0, 700], yStep: 100, right: 40, xTicks: [0, 500, 1000, 1500, 2000],
                xTitle: 'Temperature (K)', label: 'Calculated and experimental elastic constants of TiB₂ against temperature, in GPa' });
            names.forEach(function (n) {
                var colour = 'var(--series-' + n[2] + ')';
                var line = uhtc.temperature.map(function (t, k) { return [t, compound.elastic[n[0]][k]]; }).filter(function (p) { return p[0] <= 2000; });
                f.svg.appendChild(el('path', { d: path(line, f), 'class': 'series', style: 'stroke:' + colour }));
                exp.points_K_GPa[n[0]].forEach(function (p) {
                    f.svg.appendChild(tip(el('circle', { cx: f.x(p[0]), cy: f.y(p[1]), r: 4, 'class': 'marker', style: 'stroke:' + colour }),
                        n[1] + ' experiment at ' + p[0] + ' K: ' + p[1] + ' GPa'));
                });
                f.svg.appendChild(el('text', { x: f.m.left + f.plotW + 8, y: f.y(line[line.length - 1][1]) + (n[0] === 'C12' ? 12 : n[0] === 'C13' ? -2 : 4), 'class': 'end-label' }, n[1]));
            });
        });
    }

    /* 4. Nine ceramics compared at one temperature */
    function ceramics(uhtc) {
        var slider = byId('cer-t');
        var select = byId('cer-prop');
        var temps = uhtc.temperature;
        slider.max = temps.length - 1;
        slider.value = temps.indexOf(300);
        var families = { B: ['Borides', 1], C: ['Carbides', 2], N: ['Nitrides', 3] };
        legend(byId('cer-legend'), Object.keys(families).map(function (k) { return { label: families[k][0], colour: 'var(--series-' + families[k][1] + ')' }; })
            .concat([{ label: 'Value at 0 K', colour: 'var(--muted)' }]));
        function draw() {
            var i = Number(slider.value);
            var key = select.value;
            byId('cer-t-value').textContent = temps[i] + ' K';
            var rowH = 30;
            var f = frame(byId('cer-chart'), { height: uhtc.compounds.length * rowH + 12 + 42, x: [0, 600], y: [0, 1], yStep: 2, right: 64, bars: true,
                xTicks: [0, 100, 200, 300, 400, 500, 600], xTitle: select.options[select.selectedIndex].text + ' (GPa)',
                label: select.options[select.selectedIndex].text + ' of nine ceramics at ' + temps[i] + ' K' });
            [0, 100, 200, 300, 400, 500, 600].forEach(function (v) {
                f.svg.appendChild(el('line', { x1: f.x(v), x2: f.x(v), y1: f.m.top, y2: f.m.top + f.plotH, 'class': v ? 'grid' : 'baseline' }));
            });
            uhtc.compounds.forEach(function (c, k) {
                var value = c.hill[key][i];
                var cold = c.hill[key][0];
                var top = f.m.top + k * rowH + 5;
                var family = families[c.formula.replace(/^(Ti|Zr|Hf)/, '').charAt(0)];
                f.svg.appendChild(el('text', { x: f.m.left - 8, y: top + 14, 'text-anchor': 'end', 'class': 'bar-label' }, sub(c.formula)));
                f.svg.appendChild(tip(el('rect', { x: f.x(0), y: top, width: Math.max(1, f.x(value) - f.x(0)), height: rowH - 10, rx: 3, style: 'fill:var(--series-' + family[1] + ')' }),
                    sub(c.formula) + ' at ' + temps[i] + ' K: ' + value.toFixed(0) + ' GPa (0 K: ' + cold.toFixed(0) + ' GPa)'));
                f.svg.appendChild(el('line', { x1: f.x(cold), x2: f.x(cold), y1: top - 3, y2: top + rowH - 7, 'class': 'ghost' }));
                f.svg.appendChild(el('text', { x: Math.max(f.x(value), f.x(cold)) + 8, y: top + 14, 'class': 'bar-label' }, value.toFixed(0)));
            });
        }
        slider.addEventListener('input', draw);
        select.addEventListener('change', draw);
        onResize(draw);
    }

    function fail(ids) {
        ids.forEach(function (id) { byId(id).textContent = 'The data for this figure could not be loaded. Reload the page to try again.'; });
    }
    function load(url) {
        return fetch(url).then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); });
    }
    var results = load('data/results.json');
    var uhtc = load('data/uhtc.json');
    results.then(function (d) { convergence(d.cosb3_convergence); ztMap(d.cosb3_zt); })
        .catch(function () { fail(['conv-chart-kappa', 'zt-note']); });
    Promise.all([results, uhtc]).then(function (all) { tib2(all[0].tib2_experiment, all[1]); ceramics(all[1]); })
        .catch(function () { fail(['tib2-chart', 'cer-chart']); });
})();
