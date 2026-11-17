/* Results page: interactive figures drawn from data/results.json and data/uhtc.json.
   Every plot is 240px tall. Marks carry presentation attributes as a fallback;
   the stylesheet's rules override them when it loads. */
(function () {
    'use strict';

    var root = document.getElementById('results');
    if (!root) { return; }
    var SVG = 'http://www.w3.org/2000/svg';
    var PLOT_H = 240;
    var SERIES = ['#5A47C8', '#E0661A', '#0F9A8C', '#C08A00', '#D1365F'];
    function series(n) { return 'var(--series-' + n + ', ' + SERIES[n - 1] + ')'; }
    var INK = 'var(--ink, #1B1437)';
    var ACCENT = 'var(--accent, #B4410E)';

    function el(name, attrs, text) {
        var node = document.createElementNS(SVG, name);
        var a = attrs || {};
        if (name === 'text' && !a.fill) { a.fill = 'currentColor'; a['font-size'] = a['font-size'] || 12; }
        if (name === 'line' && !a.stroke) { a.stroke = 'currentColor'; a['stroke-opacity'] = a['stroke-opacity'] || 0.25; }
        if (name === 'path' && !a.fill) { a.fill = 'none'; }
        Object.keys(a).forEach(function (key) { node.setAttribute(key, a[key]); });
        if (text !== undefined) { node.textContent = text; }
        return node;
    }
    function tip(node, text) { node.appendChild(el('title', {}, text)); return node; }
    function byId(id) { return document.getElementById(id); }
    function sub(formula) { return formula.replace(/(\d)/g, function (d) { return '₀₁₂₃₄₅₆₇₈₉'[d]; }); }
    function sup(n) { return String(n).replace(/-/g, '⁻').replace(/\d/g, function (d) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]; }); }

    /* Axes and grid. o: {height, x:[a,b], y:[a,b], yTicks, xTicks, xLog, yLog, xFormat, yFormat, xTitle, title, right, left, top, append, label} */
    function frame(box, o) {
        var width = Math.max(260, box.clientWidth);
        var m = { top: o.top === undefined ? 10 : o.top, right: o.right || 14, bottom: o.xTitle ? 38 : (o.xTicks && o.xTicks.length ? 22 : 6), left: o.left || 42 };
        var plotW = width - m.left - m.right;
        var plotH = o.height - m.top - m.bottom;
        var svg = el('svg', { viewBox: '0 0 ' + width + ' ' + o.height, width: width, height: o.height, role: 'img', 'aria-label': o.label, color: 'var(--muted, #55506B)' });
        var tx = o.xLog ? Math.log10 : function (v) { return v; };
        var ty = o.yLog ? Math.log10 : function (v) { return v; };
        var x0 = tx(o.x[0]), x1 = tx(o.x[1]), y0 = ty(o.y[0]), y1 = ty(o.y[1]);
        function x(v) { return m.left + (tx(v) - x0) / (x1 - x0) * plotW; }
        function y(v) { return m.top + plotH - (ty(v) - y0) / (y1 - y0) * plotH; }
        (o.yTicks || []).forEach(function (v, k) {
            svg.appendChild(el('line', { x1: m.left, x2: m.left + plotW, y1: y(v), y2: y(v), 'class': k === 0 && !o.zeroLine ? 'baseline' : 'grid' }));
            svg.appendChild(el('text', { x: m.left - 7, y: y(v) + 4, 'text-anchor': 'end' }, o.yFormat ? o.yFormat(v) : String(v)));
        });
        if (o.zeroLine) { svg.appendChild(el('line', { x1: m.left, x2: m.left + plotW, y1: y(0), y2: y(0), 'class': 'baseline', 'stroke-opacity': 0.6 })); }
        (o.xTicks || []).forEach(function (v) {
            svg.appendChild(el('text', { x: x(v), y: m.top + plotH + 16, 'text-anchor': 'middle' }, o.xFormat ? o.xFormat(v) : String(v)));
        });
        if (o.xTitle) { svg.appendChild(el('text', { x: m.left + plotW / 2, y: o.height - 5, 'text-anchor': 'middle', 'class': 'axis-title' }, o.xTitle)); }
        if (o.title) { svg.appendChild(el('text', { x: m.left, y: 11, 'class': 'panel-title', fill: INK }, o.title)); }
        if (!o.append) { box.textContent = ''; }
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
            if (item.dot) { swatch.className = 'legend__dot' + (item.dot === 'filled' ? ' legend__dot--filled' : ''); swatch.style.color = item.colour; }
            else { swatch.style.borderTopColor = item.colour; }
            li.appendChild(swatch);
            li.appendChild(document.createTextNode(item.label));
            list.appendChild(li);
        });
    }
    function segmented(group, onPick) {
        var buttons = Array.prototype.slice.call(group.querySelectorAll('button'));
        buttons.forEach(function (button) {
            button.addEventListener('click', function () {
                buttons.forEach(function (b) { b.setAttribute('aria-pressed', b === button ? 'true' : 'false'); });
                onPick(button.getAttribute('data-value'));
            });
        });
    }
    var redraws = [];
    function onResize(fn) { redraws.push(fn); fn(); }
    var timer = null;
    window.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { redraws.forEach(function (fn) { fn(); }); }, 150);
    });

    /* 1. CoSb3: conductivity and force error against the size of the training set (two panels, 120 + 120 px) */
    function convergence(d) {
        var slider = byId('conv-n');
        slider.max = d.supercells.length - 1;
        slider.value = 2;
        function draw() {
            var i = Number(slider.value);
            var n = d.supercells[i];
            byId('conv-n-value').textContent = n;
            byId('conv-kappa').textContent = d.kappa_W_mK[i].toFixed(1);
            byId('conv-rmse').textContent = d.rmse_meV_A[i].toFixed(1);
            var box = byId('conv-chart');
            box.textContent = '';
            [[d.kappa_W_mK, [0, 12], [0, 3, 6, 9, 12], 'Lattice thermal conductivity, W/(m·K)', ' W/(m·K)', 112, false],
             [d.rmse_meV_A, [0, 80], [0, 40, 80], 'Force error, meV/Å', ' meV/Å', 128, true]].forEach(function (c) {
                var f = frame(box, { height: c[5], x: [3, 19], y: c[1], yTicks: c[2], right: 40, append: true, top: 18,
                    xTicks: c[6] ? d.supercells : [], xTitle: c[6] ? 'Supercells in the training set' : '', title: c[3],
                    label: c[3] + ' of CoSb₃ against the number of supercells in the training set' });
                if (!c[6]) {
                    Object.keys(d.reference_kappa_W_mK).forEach(function (name) {
                        var v = d.reference_kappa_W_mK[name];
                        f.svg.appendChild(el('line', { x1: f.m.left, x2: f.m.left + f.plotW, y1: f.y(v), y2: f.y(v), 'class': 'ref', 'stroke-dasharray': '5 4' }));
                        f.svg.appendChild(el('text', { x: f.m.left + f.plotW + 5, y: f.y(v) + (name === 'LDA' ? -1 : 9), 'class': 'end-label', fill: INK }, name));
                    });
                }
                var points = d.supercells.map(function (s, k) { return [s, c[0][k]]; });
                f.svg.appendChild(el('line', { x1: f.x(n), x2: f.x(n), y1: f.m.top, y2: f.m.top + f.plotH, 'class': 'cursor', 'stroke-dasharray': '3 3' }));
                f.svg.appendChild(el('path', { d: path(points, f), 'class': 'series', stroke: INK, 'stroke-width': 2, style: 'stroke:' + INK }));
                points.forEach(function (p, k) {
                    var on = k === i;
                    f.svg.appendChild(tip(el('circle', { cx: f.x(p[0]), cy: f.y(p[1]), r: on ? 6 : 3.5,
                        'class': on ? 'marker marker--on' : 'marker', fill: on ? ACCENT : 'var(--bg, #fff)', stroke: on ? 'var(--bg, #fff)' : INK, 'stroke-width': on ? 2 : 1.75,
                        style: on ? 'fill:' + ACCENT : 'stroke:' + INK }), p[0] + ' supercells: ' + p[1] + c[4]));
                });
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
        /* The lowest stop sits above the panel colour so the low end of the map keeps an edge. */
        var STOPS = [[0, [52, 40, 120]], [0.2, [74, 42, 140]], [0.4, [122, 42, 138]], [0.6, [212, 54, 92]], [0.8, [249, 123, 42]], [1, [255, 201, 74]]];
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
            return Math.pow(10, log - exp).toFixed(1) + ' × 10' + sup(exp) + ' cm⁻³';
        }
        function draw() {
            var i = Number(sT.value), j = Number(sN.value);
            var rect = canvas.getBoundingClientRect();
            var ratio = Math.min(window.devicePixelRatio || 1, 2);
            var w = Math.max(240, rect.width), h = rect.height || PLOT_H;
            canvas.width = Math.round(w * ratio);
            canvas.height = Math.round(h * ratio);
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            box = { l: 44, t: 6, w: w - 44 - 16, h: h - 6 - 36 };
            ctx.clearRect(0, 0, w, h);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(cells, box.l, box.t, box.w, box.h);
            ctx.strokeStyle = 'rgba(243,240,250,0.28)';
            ctx.lineWidth = 1;
            ctx.strokeRect(box.l + 0.5, box.t + 0.5, box.w - 1, box.h - 1);
            ctx.font = '12px Figtree, "Segoe UI", sans-serif';
            ctx.fillStyle = '#BDB6D6';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'right';
            [17, 18, 19, 20].forEach(function (e) { ctx.fillText('10' + sup(e), box.l - 6, box.t + box.h - (e - 17) / 3 * box.h); });
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            [300, 500, 750, 1000].forEach(function (t) { ctx.fillText(String(t), Math.min(box.l + (t - 300) / 700 * box.w, w - 14), box.t + box.h + 15); });
            ctx.fillStyle = '#F3F0FA';
            ctx.fillText('Temperature (K)', box.l + box.w / 2, h - 4);
            var cx = box.l + i / (temps.length - 1) * box.w;
            var cy = box.t + box.h - j / (logn.length - 1) * box.h;
            ctx.strokeStyle = 'rgba(243,240,250,0.75)';
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
            byId('zt-t-out').textContent = Math.round(temps[i]) + ' K';
            byId('zt-n-out').textContent = sci(logn[j]).replace(' cm⁻³', '');
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
        canvas.addEventListener('keydown', function (event) {
            var step = event.shiftKey ? 5 : 1;
            var keys = { ArrowLeft: [sT, -step], ArrowRight: [sT, step], ArrowDown: [sN, -step], ArrowUp: [sN, step] };
            var k = keys[event.key];
            if (!k) { return; }
            event.preventDefault();
            k[0].value = Math.max(0, Math.min(Number(k[0].max), Number(k[0].value) + k[1]));
            draw();
        });
        sT.addEventListener('input', draw);
        sN.addEventListener('input', draw);
        if (document.fonts && document.fonts.ready) { document.fonts.ready.then(draw); }
        onResize(draw);
    }

    /* 3. CoSb3 transport against carrier concentration, one quantity at a time */
    function transport(d) {
        var VIEWS = {
            rho: { index: 0, title: 'Resistivity, ρ', unit: 'mΩ·cm', y: [0.01, 1000], log: true, ticks: [0.01, 0.1, 1, 10, 100, 1000] },
            seebeck: { index: 1, title: 'Seebeck coefficient, S', unit: 'µV/K', y: [-1050, 750], ticks: [-900, -600, -300, 0, 300, 600], zero: true },
            pf: { index: 2, title: 'Power factor, PF', unit: 'µW/(cm·K²)', y: [0, 100], ticks: [0, 25, 50, 75, 100] }
        };
        var TYPES = [['p', 'p-type', 2], ['n', 'n-type', 1]];
        var view = 'seebeck';
        legend(byId('tr-legend'), [
            { label: 'p-type', colour: series(2) }, { label: 'n-type', colour: series(1) },
            { label: 'Calculated (AMSET)', colour: INK, dot: 'filled' }, { label: 'Experiment', colour: INK, dot: 'hollow' }
        ]);
        function draw() {
            var v = VIEWS[view];
            byId('tr-name').textContent = v.title;
            byId('tr-unit').textContent = v.unit;
            var f = frame(byId('tr-chart'), { height: PLOT_H, x: [1e16, 1e22], xLog: true, y: v.y, yLog: v.log, yTicks: v.ticks, zeroLine: v.zero, left: 46, right: 18,
                xTicks: [1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22], xFormat: function (t) { return '10' + sup(Math.round(Math.log10(t))); },
                xTitle: 'Carrier concentration (cm⁻³)', label: v.title + ' of CoSb₃ against carrier concentration, calculated and experimental, for p-type and n-type material' });
            TYPES.forEach(function (t) {
                var colour = series(t[2]);
                var exp = d.series[t[0] + '_exp'][v.index];
                var calc = d.series[t[0] + '_calc'][v.index];
                exp.forEach(function (p) {
                    f.svg.appendChild(tip(el('circle', { cx: f.x(Math.pow(10, p[0])), cy: f.y(p[1]), r: 3.5, 'class': 'marker', fill: 'var(--bg, #fff)', stroke: colour, 'stroke-width': 1.75, style: 'stroke:' + colour }),
                        t[1] + ', experiment: ' + p[1] + ' ' + v.unit + ' at 10' + sup(p[0].toFixed(1)) + ' cm⁻³'));
                });
                f.svg.appendChild(el('path', { d: path(calc.map(function (p) { return [Math.pow(10, p[0]), p[1]]; }), f), stroke: colour, 'stroke-width': 1.25, 'stroke-opacity': 0.5,
                    style: 'stroke:' + colour + ';stroke-width:1.25;stroke-opacity:0.5' }));
                calc.forEach(function (p) {
                    f.svg.appendChild(tip(el('circle', { cx: f.x(Math.pow(10, p[0])), cy: f.y(p[1]), r: 5, 'class': 'marker marker--calc', fill: colour, stroke: 'var(--bg, #fff)', 'stroke-width': 1.5, style: 'fill:' + colour }),
                        t[1] + ', calculated: ' + p[1] + ' ' + v.unit + ' at 10' + sup(p[0].toFixed(0)) + ' cm⁻³'));
                });
            });
        }
        segmented(byId('tr-views'), function (value) { view = value; draw(); });
        onResize(draw);
    }

    /* 4. TiB2: calculated elastic constants against the experimental points */
    function tib2(exp, uhtc) {
        var compound = uhtc.compounds.filter(function (c) { return c.formula === 'TiB2'; })[0];
        var names = [['C11', 'C₁₁', 1], ['C33', 'C₃₃', 2], ['C44', 'C₄₄', 3], ['C13', 'C₁₃', 4], ['C12', 'C₁₂', 5]];
        legend(byId('tib2-legend'), [{ label: 'Calculated', colour: INK }, { label: 'Experiment', colour: INK, dot: 'hollow' }]);
        onResize(function () {
            var f = frame(byId('tib2-chart'), { height: PLOT_H, x: [0, 2000], y: [0, 700], yTicks: [0, 100, 200, 300, 400, 500, 600, 700], right: 36,
                xTicks: [0, 500, 1000, 1500, 2000], xTitle: 'Temperature (K)', label: 'Calculated and experimental elastic constants of TiB₂ against temperature, in GPa' });
            names.forEach(function (n) {
                var colour = series(n[2]);
                var line = uhtc.temperature.map(function (t, k) { return [t, compound.elastic[n[0]][k]]; }).filter(function (p) { return p[0] <= 2000; });
                f.svg.appendChild(el('path', { d: path(line, f), 'class': 'series', stroke: colour, 'stroke-width': 2, style: 'stroke:' + colour }));
                exp.points_K_GPa[n[0]].forEach(function (p) {
                    f.svg.appendChild(tip(el('circle', { cx: f.x(p[0]), cy: f.y(p[1]), r: 3.5, 'class': 'marker', fill: 'var(--bg, #fff)', stroke: colour, 'stroke-width': 1.75, style: 'stroke:' + colour }),
                        n[1] + ' experiment at ' + p[0] + ' K: ' + p[1] + ' GPa'));
                });
                var end = f.y(line[line.length - 1][1]) + (n[0] === 'C12' ? 11 : n[0] === 'C13' ? -3 : 4);
                f.svg.appendChild(el('text', { x: f.m.left + f.plotW + 6, y: end, 'class': 'end-label', fill: INK }, n[1]));
            });
        });
    }

    /* 5. Nine ceramics compared at one temperature */
    function ceramics(uhtc) {
        var slider = byId('cer-t');
        var select = byId('cer-prop');
        var temps = uhtc.temperature;
        slider.max = temps.length - 1;
        slider.value = temps.indexOf(300);
        var families = { B: ['Borides', 1], C: ['Carbides', 2], N: ['Nitrides', 3] };
        legend(byId('cer-legend'), Object.keys(families).map(function (k) { return { label: families[k][0], colour: series(families[k][1]) }; })
            .concat([{ label: 'Value at 0 K', colour: INK }]));
        function draw() {
            var i = Number(slider.value);
            var key = select.value;
            byId('cer-t-value').textContent = temps[i] + ' K';
            var rowH = 21;
            var name = select.options[select.selectedIndex].text;
            var f = frame(byId('cer-chart'), { height: PLOT_H, x: [0, 600], y: [0, 1], right: 40, left: 46, top: 4,
                xTicks: [0, 200, 400, 600], xTitle: name + ' (GPa)', label: name + ' of nine ceramics at ' + temps[i] + ' K' });
            [0, 100, 200, 300, 400, 500, 600].forEach(function (v) {
                f.svg.appendChild(el('line', { x1: f.x(v), x2: f.x(v), y1: f.m.top, y2: f.m.top + f.plotH, 'class': v ? 'grid' : 'baseline' }));
            });
            uhtc.compounds.forEach(function (c, k) {
                var value = c.hill[key][i];
                var cold = c.hill[key][0];
                var top = f.m.top + k * rowH + 3;
                var family = families[c.formula.replace(/^(Ti|Zr|Hf)/, '').charAt(0)];
                var colour = series(family[1]);
                f.svg.appendChild(el('text', { x: f.m.left - 7, y: top + 11, 'text-anchor': 'end', 'class': 'bar-label', fill: INK }, sub(c.formula)));
                f.svg.appendChild(tip(el('rect', { x: f.x(0), y: top, width: Math.max(1, f.x(value) - f.x(0)), height: rowH - 6, rx: 3, fill: colour, style: 'fill:' + colour }),
                    sub(c.formula) + ' at ' + temps[i] + ' K: ' + value.toFixed(0) + ' GPa (0 K: ' + cold.toFixed(0) + ' GPa)'));
                f.svg.appendChild(el('line', { x1: f.x(cold), x2: f.x(cold), y1: top - 2, y2: top + rowH - 4, 'class': 'ghost', stroke: INK, 'stroke-width': 2, 'stroke-opacity': 0.55 }));
                f.svg.appendChild(el('text', { x: Math.max(f.x(value), f.x(cold)) + 6, y: top + 11, 'class': 'bar-label', fill: INK }, value.toFixed(0)));
            });
        }
        slider.addEventListener('input', draw);
        select.addEventListener('change', draw);
        onResize(draw);
    }

    function fail(ids) {
        ids.forEach(function (id) {
            var node = byId(id);
            if (node) { node.textContent = 'The data for this figure could not be loaded. Reload the page to try again.'; }
        });
    }
    function load(url) {
        return fetch(url).then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); });
    }
    var results = load(root.getAttribute('data-results') || 'data/results.json');
    var uhtc = load(root.getAttribute('data-uhtc') || 'data/uhtc.json');
    results.then(function (d) { convergence(d.cosb3_convergence); ztMap(d.cosb3_zt); transport(d.cosb3_transport); })
        .catch(function () { fail(['conv-chart', 'tr-chart']); });
    Promise.all([results, uhtc]).then(function (all) { tib2(all[0].tib2_experiment, all[1]); ceramics(all[1]); })
        .catch(function () { fail(['tib2-chart', 'cer-chart']); });
})();
