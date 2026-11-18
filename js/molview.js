/* Small 3D ball-and-stick viewer for crystal structures, drawn on a canvas.
   Drag (mouse or touch) to spin it 360°, arrow keys to rotate, double-click to reset.
   Usage: <canvas class="molview" data-structure="perovskite"></canvas>. */
(function () {
    'use strict';

    var ELEMENTS = {
        K: { colour: '#1F8A8A', radius: 0.62, name: 'K' },
        Nb: { colour: '#8C8A3E', radius: 0.48, name: 'Nb' },
        O: { colour: '#D1323A', radius: 0.40, name: 'O' },
        S: { colour: '#E3D23A', radius: 0.52, name: 'S' },
        Cu: { colour: '#A0642A', radius: 0.44, name: 'Cu' },
        N: { colour: '#2638D9', radius: 0.40, name: 'N' },
        C: { colour: '#2B2B2B', radius: 0.40, name: 'C' },
        H: { colour: '#EDEDED', radius: 0.24, name: 'H' }
    };
    function add(p, q, k) { return [p[0] + q[0] * (k === undefined ? 1 : k), p[1] + q[1] * (k === undefined ? 1 : k), p[2] + q[2] * (k === undefined ? 1 : k)]; }
    function unit(p) { var n = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]); return [p[0] / n, p[1] / n, p[2] / n]; }
    function cross(p, q) { return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; }
    /* Three directions at the tetrahedral angle from axis u, starting at tangent t. */
    function tetra(u, t) {
        var w = cross(u, t);
        var c = Math.cos(109.47 * Math.PI / 180), sn = Math.sin(109.47 * Math.PI / 180);
        return [0, 120, 240].map(function (deg) {
            var f = deg * Math.PI / 180;
            return unit(add(u.map(function (x) { return x * c; }), add(t.map(function (x) { return x * Math.cos(f) * sn; }), w.map(function (x) { return x * Math.sin(f) * sn; }))));
        });
    }

    /* Ideal cubic perovskite ABO3 (KNbO3): K on the corners, Nb in the centre, O on the face centres. */
    function perovskite() {
        var a = 4.0;
        var atoms = [];
        [0, 1].forEach(function (i) { [0, 1].forEach(function (j) { [0, 1].forEach(function (k) { atoms.push({ el: 'K', p: [i * a, j * a, k * a] }); }); }); });
        atoms.push({ el: 'Nb', p: [a / 2, a / 2, a / 2] });
        [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]].forEach(function (f) {
            atoms.push({ el: 'O', p: [f[0] * a, f[1] * a, f[2] * a] });
        });
        var links = [];
        var nb = 8;
        for (var o = 9; o < 15; o += 1) { links.push({ a: nb, b: o, kind: 'bond' }); }
        /* Octahedron edges between neighbouring O atoms, and the cell edges between neighbouring K atoms. */
        for (var i = 9; i < 15; i += 1) {
            for (var j = i + 1; j < 15; j += 1) {
                if (Math.abs(dist(atoms[i].p, atoms[j].p) - a / Math.SQRT2) < 1e-6) { links.push({ a: i, b: j, kind: 'poly' }); }
            }
        }
        for (var m = 0; m < 8; m += 1) {
            for (var n = m + 1; n < 8; n += 1) {
                if (Math.abs(dist(atoms[m].p, atoms[n].p) - a) < 1e-6) { links.push({ a: m, b: n, kind: 'cell' }); }
            }
        }
        return { atoms: atoms, links: links, label: 'KNbO₃, cubic perovskite' };
    }
    function dist(p, q) { return Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2])); }

    /* The cluster pictured in About us, rebuilt from that picture: an octahedron of 6 sulfur atoms,
       12 copper atoms bridging its 12 edges, and a methylamine on each copper. Each Cu(I) has three
       bonds (2 S, 1 N) in a trigonal plane; each S bridges four Cu; N and C are tetrahedral.
       Distances are standard bond lengths (Cu–S 2.25, Cu–N 2.05, N–C 1.47, N–H 1.01, C–H 1.09 Å). */
    function cluster() {
        var atoms = [], links = [];
        function put(el, p) { atoms.push({ el: el, p: p }); return atoms.length - 1; }
        function bond(i, j) { links.push({ a: i, b: j, kind: 'bond' }); }
        var a = 2.9;
        var S = [[a, 0, 0], [-a, 0, 0], [0, a, 0], [0, -a, 0], [0, 0, a], [0, 0, -a]].map(function (p) { return put('S', p); });
        /* Copper on each octahedron edge, 2.98 Å from the centre, which puts it 2.25 Å from both sulfur atoms. */
        var cu = [];
        for (var i = 0; i < 6; i += 1) {
            for (var j = i + 1; j < 6; j += 1) {
                var pi = atoms[S[i]].p, pj = atoms[S[j]].p;
                if (Math.abs(dist(pi, pj) - a * Math.SQRT2) > 1e-6) { continue; }
                var u = unit(add(pi, pj));
                var c = put('Cu', u.map(function (x) { return x * 2.98; }));
                bond(c, S[i]); bond(c, S[j]);
                cu.push({ i: c, u: u });
            }
        }
        /* Neighbouring copper atoms are 2.98 Å apart, a weak Cu(I)···Cu(I) contact rather than a bond,
           so no stick is drawn between them (the original picture draws none either). */
        /* A methylamine on each copper, pointing outwards; the methyl group leans sideways, as in the picture. */
        cu.forEach(function (m) {
            var u = m.u;
            var side = Math.abs(u[0]) > 1e-6 ? (u[0] > 0 ? 1 : -1) : (u[2] > 0 ? 1 : -1);
            var t = unit(cross(u, [0, 1, 0]));
            if (Math.abs(u[0]) > 1e-6 ? t[0] * side < 0 : t[2] * side < 0) { t = t.map(function (x) { return -x; }); }
            var n = put('N', add(atoms[m.i].p, u, 2.05));
            bond(m.i, n);
            var dirs = tetra(u.map(function (x) { return -x; }), t);
            var cc = put('C', add(atoms[n].p, dirs[0], 1.47));
            bond(n, cc);
            bond(n, put('H', add(atoms[n].p, dirs[1], 1.01)));
            bond(n, put('H', add(atoms[n].p, dirs[2], 1.01)));
            var v = unit(add(atoms[cc].p, atoms[n].p, -1));
            var t2 = unit(cross(v, Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
            tetra(v.map(function (x) { return -x; }), t2).forEach(function (d) { bond(cc, put('H', add(atoms[cc].p, d, 1.09))); });
        });
        return { atoms: atoms, links: links, label: 'Cu₁₂S₆ cluster with methylamine ligands', home: { yaw: 0.32, pitch: 0.2 }, size: 1.0 };
    }

    var STRUCTURES = { perovskite: perovskite, cluster: cluster };

    function shade(hex, f) {
        var n = parseInt(hex.slice(1), 16);
        var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        function mix(c) { return Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)); }
        return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
    }

    function Viewer(canvas, structure) {
        var ctx = canvas.getContext('2d');
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var centre = [0, 0, 0];
        structure.atoms.forEach(function (at) { centre[0] += at.p[0]; centre[1] += at.p[1]; centre[2] += at.p[2]; });
        centre = centre.map(function (c) { return c / structure.atoms.length; });
        var atoms = structure.atoms.map(function (at) { return { el: at.el, p: [at.p[0] - centre[0], at.p[1] - centre[1], at.p[2] - centre[2]] }; });
        var extent = Math.max.apply(null, atoms.map(function (at) { return dist(at.p, [0, 0, 0]) + ELEMENTS[at.el].radius; }));
        var HOME = structure.home || { yaw: -0.62, pitch: 0.42 };
        var view = { yaw: HOME.yaw, pitch: HOME.pitch };
        var spin = { yaw: reduce ? 0 : 0.004, pitch: 0 };
        var drag = null;
        var idleSince = 0;
        var visible = true;
        var frame = null;

        function rotate(p) {
            var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
            var x = cy * p[0] + sy * p[2];
            var z = -sy * p[0] + cy * p[2];
            var y = cp * p[1] - sp * z;
            return [x, y, sp * p[1] + cp * z];
        }
        function draw() {
            var rect = canvas.getBoundingClientRect();
            var ratio = Math.min(window.devicePixelRatio || 1, 2);
            var w = Math.max(200, rect.width), h = Math.max(160, rect.height);
            if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
                canvas.width = Math.round(w * ratio);
                canvas.height = Math.round(h * ratio);
            }
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, w, h);
            var style = getComputedStyle(canvas);
            var ink = style.getPropertyValue('--ink').trim() || '#1B1437';
            var scale = Math.min(w, h) / (2 * extent * 1.08);
            var camera = extent * 4;
            var placed = atoms.map(function (at) {
                var r = rotate(at.p);
                var persp = camera / (camera - r[2]);
                return { x: w / 2 + r[0] * scale * persp, y: h / 2 - r[1] * scale * persp, z: r[2], s: scale * persp, el: at.el };
            });
            var items = [];
            placed.forEach(function (pa, i) { items.push({ z: pa.z, type: 'atom', i: i }); });
            structure.links.forEach(function (ln) { items.push({ z: (placed[ln.a].z + placed[ln.b].z) / 2 - 0.01, type: 'link', ln: ln }); });
            items.sort(function (p, q) { return p.z - q.z; });
            var zmax = extent;
            items.forEach(function (it) {
                var fade = 0.55 + 0.45 * (it.z + zmax) / (2 * zmax);
                if (it.type === 'link') {
                    var a = placed[it.ln.a], b = placed[it.ln.b];
                    ctx.globalAlpha = fade;
                    ctx.lineCap = 'round';
                    if (it.ln.kind === 'bond') {
                        /* Each half of the bond takes the colour of its atom. */
                        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                        ctx.lineWidth = 0.2 * (a.s + b.s) / 2;
                        ctx.strokeStyle = shade(ELEMENTS[a.el].colour, -0.1);
                        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mx, my); ctx.stroke();
                        ctx.strokeStyle = shade(ELEMENTS[b.el].colour, -0.1);
                        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(b.x, b.y); ctx.stroke();
                    } else {
                        if (it.ln.kind === 'poly') { ctx.strokeStyle = ELEMENTS.O.colour; ctx.lineWidth = 0.09 * (a.s + b.s) / 2; }
                        else { ctx.strokeStyle = ELEMENTS.K.colour; ctx.lineWidth = 0.13 * (a.s + b.s) / 2; }
                        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                    }
                } else {
                    var pa = placed[it.i];
                    var e = ELEMENTS[pa.el];
                    var r = e.radius * pa.s;
                    var g = ctx.createRadialGradient(pa.x - r * 0.35, pa.y - r * 0.35, r * 0.1, pa.x, pa.y, r);
                    g.addColorStop(0, shade(e.colour, 0.55));
                    g.addColorStop(0.45, e.colour);
                    g.addColorStop(1, shade(e.colour, -0.45));
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(pa.x, pa.y, r, 0, 6.2832); ctx.fill();
                    ctx.globalAlpha = 0.25 * fade;
                    ctx.strokeStyle = ink;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            });
            ctx.globalAlpha = 1;
        }
        function loop(time) {
            frame = null;
            if (!drag) {
                var idle = time - idleSince > 2500;
                view.yaw += spin.yaw;
                view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + spin.pitch));
                /* Momentum fades after a drag; the slow idle spin returns unless motion is reduced. */
                spin.yaw *= 0.95; spin.pitch *= 0.95;
                if (idle && !reduce && Math.abs(spin.yaw) < 0.004) { spin.yaw = 0.004; }
            }
            draw();
            var moving = drag || Math.abs(spin.yaw) > 1e-4 || Math.abs(spin.pitch) > 1e-4;
            if (visible && moving) { frame = requestAnimationFrame(loop); }
        }
        function kick() { if (!frame && visible) { frame = requestAnimationFrame(loop); } }

        canvas.addEventListener('pointerdown', function (event) {
            drag = { x: event.clientX, y: event.clientY, t: event.timeStamp };
            spin.yaw = 0; spin.pitch = 0;
            canvas.setPointerCapture(event.pointerId);
            canvas.classList.add('is-dragging');
            kick();
        });
        canvas.addEventListener('pointermove', function (event) {
            if (!drag) { return; }
            var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            var k = 0.012;
            view.yaw += dx * k;
            view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + dy * k));
            spin.yaw = dx * k * 0.6; spin.pitch = dy * k * 0.6;
            drag.x = event.clientX; drag.y = event.clientY;
            kick();
        });
        function end() {
            if (!drag) { return; }
            drag = null;
            idleSince = performance.now();
            canvas.classList.remove('is-dragging');
            kick();
        }
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('dblclick', function () { view.yaw = HOME.yaw; view.pitch = HOME.pitch; spin.yaw = 0; spin.pitch = 0; idleSince = performance.now(); kick(); draw(); });
        canvas.addEventListener('keydown', function (event) {
            var step = event.shiftKey ? 0.5 : 0.15;
            var moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (event.key === 'Home') { view.yaw = HOME.yaw; view.pitch = HOME.pitch; }
            else if (moves[event.key]) {
                view.yaw += moves[event.key][0];
                view.pitch = Math.max(-1.45, Math.min(1.45, view.pitch + moves[event.key][1]));
            } else { return; }
            event.preventDefault();
            spin.yaw = 0; spin.pitch = 0; idleSince = performance.now();
            draw();
        });
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; if (visible) { kick(); } }).observe(canvas);
        }
        var timer = null;
        window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(draw, 120); });
        document.addEventListener('nml:theme', draw);
        draw();
        kick();
    }

    Array.prototype.forEach.call(document.querySelectorAll('canvas.molview'), function (canvas) {
        var make = STRUCTURES[canvas.getAttribute('data-structure')];
        if (!make || !canvas.getContext) { return; }
        var fig = canvas.closest('.fig');
        if (fig) { fig.classList.add('is-live'); }
        Viewer(canvas, make());
    });
})();
