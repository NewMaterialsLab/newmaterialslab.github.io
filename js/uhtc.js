/* Downloads page: chart of the UHTC data set (data/uhtc.json, built by tools/build_uhtc_json.py). */
(function () {
    'use strict';

    var host = document.getElementById('uhtc-explorer');
    if (!host) { return; }

    var SVG = 'http://www.w3.org/2000/svg';
    var select = document.getElementById('uhtc-compound');
    var chartBox = document.getElementById('uhtc-chart');
    var title = document.getElementById('uhtc-title');
    var legend = document.getElementById('uhtc-legend');
    var tableBox = document.getElementById('uhtc-table');
    var csvButton = document.getElementById('uhtc-csv');
    var setButtons = Array.prototype.slice.call(host.querySelectorAll('[data-set]'));

    /* A colour belongs to a quantity and never changes with the compound shown. */
    var SETS = {
        elastic: {
            heading: 'Elastic constants of ',
            file: 'elastic_constants',
            series: [
                { key: 'C11', label: 'C₁₁', slot: 1 },
                { key: 'C12', label: 'C₁₂', slot: 2 },
                { key: 'C13', label: 'C₁₃', slot: 3 },
                { key: 'C33', label: 'C₃₃', slot: 4 },
                { key: 'C44', label: 'C₄₄', slot: 5 }
            ]
        },
        hill: {
            heading: 'Polycrystal moduli (Hill average) of ',
            file: 'hill_moduli',
            series: [
                { key: 'Young', label: 'Young', slot: 1 },
                { key: 'shear', label: 'Shear', slot: 2 },
                { key: 'bulk', label: 'Bulk', slot: 3 }
            ]
        }
    };
    var data = null;
    var state = { compound: 0, set: 'elastic', index: null };

    function el(name, attrs, text) {
        var node = document.createElementNS(SVG, name);
        Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
        if (text !== undefined) { node.textContent = text; }
        return node;
    }
    function pretty(formula) { return formula.replace(/2/g, '₂'); }
    function current() {
        var compound = data.compounds[state.compound];
        var set = SETS[state.set];
        var series = set.series.filter(function (s) { return compound[state.set][s.key]; }).map(function (s) {
            return { key: s.key, label: s.label, colour: 'var(--series-' + s.slot + ')', values: compound[state.set][s.key] };
        });
        return { compound: compound, set: set, series: series };
    }

    function render() {
        var view = current();
        var temps = data.temperature;
        var width = Math.max(300, chartBox.clientWidth);
        var height = 340;
        var m = { top: 14, right: 58, bottom: 44, left: 48 };
        var plotW = width - m.left - m.right;
        var plotH = height - m.top - m.bottom;
        var tMax = temps[temps.length - 1];
        var peak = Math.max.apply(null, view.series.map(function (s) { return Math.max.apply(null, s.values); }));
        var step = peak > 400 ? 100 : 50;
        var yMax = Math.ceil(peak / step) * step;
        function x(t) { return m.left + (t / tMax) * plotW; }
        function y(v) { return m.top + plotH - (v / yMax) * plotH; }

        title.textContent = view.set.heading + pretty(view.compound.formula) + ' (GPa)';

        legend.textContent = '';
        view.series.forEach(function (s) {
            var li = document.createElement('li');
            var swatch = document.createElement('i');
            swatch.style.borderTopColor = s.colour;
            li.appendChild(swatch);
            li.appendChild(document.createTextNode(s.label));
            legend.appendChild(li);
        });

        var svg = el('svg', {
            viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, tabindex: '0', role: 'img',
            'aria-label': title.textContent + ' against temperature from 0 to ' + tMax + ' K. Use the left and right arrow keys to read values, or open the table below.'
        });

        for (var v = 0; v <= yMax; v += step) {
            svg.appendChild(el('line', { x1: m.left, x2: m.left + plotW, y1: y(v), y2: y(v), 'class': v === 0 ? 'baseline' : 'grid' }));
            svg.appendChild(el('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v)));
        }
        var tStep = plotW < 420 ? 1000 : 500;
        for (var t = 0; t <= tMax; t += tStep) {
            svg.appendChild(el('text', { x: x(t), y: m.top + plotH + 18, 'text-anchor': 'middle' }, String(t)));
        }
        svg.appendChild(el('text', { x: m.left + plotW / 2, y: height - 6, 'text-anchor': 'middle', 'class': 'axis-title' }, 'Temperature (K)'));

        view.series.forEach(function (s) {
            var d = s.values.map(function (value, i) { return (i ? 'L' : 'M') + x(temps[i]).toFixed(1) + ' ' + y(value).toFixed(1); }).join('');
            svg.appendChild(el('path', { d: d, 'class': 'series', style: 'stroke:' + s.colour }));
        });

        /* Labels at the line ends, nudged apart so they never overlap. */
        var ends = view.series.map(function (s) { return { label: s.label, y: y(s.values[s.values.length - 1]) }; })
            .sort(function (a, b) { return a.y - b.y; });
        for (var i = 1; i < ends.length; i += 1) {
            if (ends[i].y - ends[i - 1].y < 14) { ends[i].y = ends[i - 1].y + 14; }
        }
        ends.forEach(function (end) {
            svg.appendChild(el('text', { x: m.left + plotW + 8, y: end.y + 4, 'class': 'end-label' }, end.label));
        });

        /* Hover and keyboard readout */
        var cursor = el('line', { 'class': 'cursor', y1: m.top, y2: m.top + plotH, visibility: 'hidden' });
        svg.appendChild(cursor);
        var dots = view.series.map(function (s) {
            var dot = el('circle', { r: 4.5, 'class': 'dot', style: 'fill:' + s.colour, visibility: 'hidden' });
            svg.appendChild(dot);
            return dot;
        });
        var tip = document.createElement('div');
        tip.className = 'tooltip';
        tip.hidden = true;

        function show(index) {
            index = Math.max(0, Math.min(temps.length - 1, index));
            state.index = index;
            var cx = x(temps[index]);
            cursor.setAttribute('x1', cx);
            cursor.setAttribute('x2', cx);
            cursor.setAttribute('visibility', 'visible');
            tip.textContent = '';
            var head = document.createElement('strong');
            head.textContent = temps[index] + ' K';
            tip.appendChild(head);
            view.series.forEach(function (s, n) {
                dots[n].setAttribute('cx', cx);
                dots[n].setAttribute('cy', y(s.values[index]));
                dots[n].setAttribute('visibility', 'visible');
                var row = document.createElement('div');
                var key = document.createElement('i');
                key.style.borderTopColor = s.colour;
                var value = document.createElement('b');
                value.textContent = s.values[index].toFixed(1) + ' GPa';
                row.appendChild(key);
                row.appendChild(document.createTextNode(s.label));
                row.appendChild(value);
                tip.appendChild(row);
            });
            tip.hidden = false;
            var scale = chartBox.clientWidth / width;
            if (cx > m.left + plotW / 2) {
                tip.style.left = '';
                tip.style.right = (chartBox.clientWidth - cx * scale + 14) + 'px';
            } else {
                tip.style.right = '';
                tip.style.left = (cx * scale + 14) + 'px';
            }
        }
        function hide() {
            state.index = null;
            cursor.setAttribute('visibility', 'hidden');
            dots.forEach(function (dot) { dot.setAttribute('visibility', 'hidden'); });
            tip.hidden = true;
        }
        svg.addEventListener('pointermove', function (event) {
            var box = svg.getBoundingClientRect();
            var px = (event.clientX - box.left) * (width / box.width);
            show(Math.round(((px - m.left) / plotW) * (temps.length - 1)));
        });
        svg.addEventListener('pointerleave', hide);
        svg.addEventListener('blur', hide);
        svg.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') { return; }
            event.preventDefault();
            var jumpBy = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
            show((state.index === null ? 30 : state.index) + jumpBy);
        });

        chartBox.textContent = '';
        chartBox.appendChild(svg);
        chartBox.appendChild(tip);

        /* Table view: every 100 K. The CSV button gives every temperature. */
        var table = document.createElement('table');
        table.className = 'data';
        var head = table.createTHead().insertRow();
        ['T (K)'].concat(view.series.map(function (s) { return s.label + ' (GPa)'; })).forEach(function (text) {
            var th = document.createElement('th');
            th.scope = 'col';
            th.textContent = text;
            head.appendChild(th);
        });
        var body = table.createTBody();
        temps.forEach(function (temp, index) {
            if (temp % 100 !== 0) { return; }
            var row = body.insertRow();
            row.insertCell().textContent = temp;
            view.series.forEach(function (s) { row.insertCell().textContent = s.values[index].toFixed(2); });
        });
        tableBox.textContent = '';
        tableBox.appendChild(table);
    }

    function downloadCsv() {
        var view = current();
        var lines = ['T_K,' + view.series.map(function (s) { return s.key + '_GPa'; }).join(',')];
        data.temperature.forEach(function (temp, index) {
            lines.push(temp + ',' + view.series.map(function (s) { return s.values[index]; }).join(','));
        });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
        link.download = view.compound.formula + '_' + view.set.file + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }

    fetch('data/uhtc.json').then(function (response) {
        if (!response.ok) { throw new Error('HTTP ' + response.status); }
        return response.json();
    }).then(function (json) {
        data = json;
        data.compounds.forEach(function (compound, index) {
            var option = document.createElement('option');
            option.value = index;
            option.textContent = pretty(compound.formula) + ' (' + compound.structure + ')';
            select.appendChild(option);
        });
        select.addEventListener('change', function () { state.compound = Number(select.value); render(); });
        setButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                state.set = button.getAttribute('data-set');
                setButtons.forEach(function (other) { other.setAttribute('aria-pressed', other === button ? 'true' : 'false'); });
                render();
            });
        });
        csvButton.addEventListener('click', downloadCsv);
        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(render, 150);
        });
        render();
    }).catch(function () {
        chartBox.textContent = 'The chart data could not be loaded. Reload the page, or download the full archive above.';
        csvButton.disabled = true;
    });
})();
