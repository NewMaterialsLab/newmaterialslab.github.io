/* Home page figure: heat crossing a grain boundary.
   An illustration, not simulation output: two crystal grains tilted by the chosen angle,
   atoms coloured by a temperature that falls from the hot side to the cold side and
   drops at the boundary. The size of the drop is a drawing choice that grows with the angle. */
(function () {
    'use strict';

    var canvas = document.getElementById('gb-canvas');
    var slider = document.getElementById('gb-angle');
    var output = document.getElementById('gb-angle-value');
    if (!canvas || !canvas.getContext || !slider) { return; }

    var ctx = canvas.getContext('2d');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var SPACING = 21;          /* distance between neighbouring atoms, px */
    var RADIUS = 4.1;
    var PROFILE_HEIGHT = 86;   /* strip at the bottom that plots temperature against position */
    var STOPS = [              /* cold (0) to hot (1) */
        [0.00, [92, 78, 190]],
        [0.28, [158, 62, 170]],
        [0.52, [222, 64, 104]],
        [0.76, [249, 123, 42]],
        [1.00, [255, 201, 74]]
    ];
    var atoms = [];
    var width = 0;
    var height = 0;
    var jump = 0;
    var visible = true;
    var frame = null;

    function colour(t) {
        t = Math.max(0, Math.min(1, t));
        for (var i = 1; i < STOPS.length; i += 1) {
            if (t <= STOPS[i][0]) {
                var a = STOPS[i - 1];
                var b = STOPS[i];
                var f = (t - a[0]) / (b[0] - a[0]);
                return 'rgb(' + Math.round(a[1][0] + f * (b[1][0] - a[1][0])) + ',' +
                    Math.round(a[1][1] + f * (b[1][1] - a[1][1])) + ',' +
                    Math.round(a[1][2] + f * (b[1][2] - a[1][2])) + ')';
            }
        }
        return 'rgb(255,201,74)';
    }

    /* Temperature at horizontal position u (0 = left edge, 1 = right edge): 1 is hot, 0 is cold. */
    function temperature(u) {
        var slope = 1 - jump;
        return u < 0.5 ? 1 - slope * u : 1 - slope * u - jump;
    }

    function build() {
        var rect = canvas.getBoundingClientRect();
        var ratio = Math.min(window.devicePixelRatio || 1, 2);
        width = Math.max(280, rect.width);
        height = Math.max(240, rect.height);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        var angle = Number(slider.value);
        output.textContent = angle + '°';
        /* A triangular lattice repeats every 60 degrees, so the mismatch peaks at 30. */
        jump = 0.34 * Math.sin(angle * Math.PI / 60);

        var latticeHeight = height - PROFILE_HEIGHT;
        var cx = width / 2;
        var cy = latticeHeight / 2;
        var half = angle * Math.PI / 360;
        var reach = Math.ceil(Math.max(width, latticeHeight) / SPACING) + 2;
        var rowHeight = SPACING * Math.sqrt(3) / 2;
        var all = [];
        [-1, 1].forEach(function (side) {
            var cos = Math.cos(side * half);
            var sin = Math.sin(side * half);
            for (var j = -reach; j <= reach; j += 1) {
                for (var i = -reach; i <= reach; i += 1) {
                    var lx = (i + (j % 2 ? 0.5 : 0)) * SPACING;
                    var ly = j * rowHeight;
                    var x = cx + lx * cos - ly * sin;
                    var y = cy + lx * sin + ly * cos;
                    if (y < 10 || y > latticeHeight - 8 || x < 8 || x > width - 8) { continue; }
                    /* Each grain keeps its own half. With no tilt the two lattices coincide into one crystal. */
                    if (side < 0 ? x >= cx - 0.01 : x < cx - 0.01) { continue; }
                    all.push({ x: x, y: y, p1: Math.random() * 6.283, p2: Math.random() * 6.283, w: 0.8 + Math.random() * 0.6 });
                }
            }
        });
        /* Atoms from the two grains that land almost on top of each other at the boundary: keep one. */
        atoms = [];
        all.forEach(function (atom) {
            var clash = Math.abs(atom.x - cx) < SPACING && atoms.some(function (other) {
                return Math.abs(other.x - cx) < SPACING && Math.hypot(other.x - atom.x, other.y - atom.y) < SPACING * 0.62;
            });
            if (!clash) { atoms.push(atom); }
        });
    }

    function draw(time) {
        var t = time / 1000;
        var latticeHeight = height - PROFILE_HEIGHT;
        ctx.clearRect(0, 0, width, height);

        for (var n = 0; n < atoms.length; n += 1) {
            var atom = atoms[n];
            var temp = temperature(atom.x / width);
            var shake = reduceMotion ? 0 : 0.5 + 2.4 * temp;   /* hotter atoms vibrate more */
            ctx.beginPath();
            ctx.arc(atom.x + shake * Math.sin(t * 7 * atom.w + atom.p1), atom.y + shake * Math.cos(t * 6 * atom.w + atom.p2), RADIUS, 0, 6.283);
            ctx.fillStyle = colour(temp);
            ctx.fill();
        }

        /* Temperature profile under the lattice */
        var top = latticeHeight + 22;
        var bottom = height - 28;
        var left = 18;
        var right = width - 18;
        function py(value) { return bottom - value * (bottom - top); }
        function px(u) { return left + u * (right - left); }
        var boundary = jump > 0.004;

        ctx.strokeStyle = 'rgba(243,240,250,0.24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, latticeHeight + 0.5);
        ctx.lineTo(width, latticeHeight + 0.5);
        ctx.stroke();
        if (boundary) {
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(width / 2, 8);
            ctx.lineTo(width / 2, bottom);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.strokeStyle = '#F3F0FA';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(px(0), py(temperature(0)));
        ctx.lineTo(px(0.5), py(temperature(0.4999)));
        ctx.lineTo(px(0.5), py(temperature(0.5)));
        ctx.lineTo(px(1), py(temperature(1)));
        ctx.stroke();

        ctx.font = '600 12px Figtree, "Segoe UI", sans-serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#F3F0FA';
        ctx.textAlign = 'left';
        ctx.fillText('Hot side', left, height - 9);
        ctx.textAlign = 'right';
        ctx.fillText('Cold side', right, height - 9);
        ctx.textAlign = 'center';
        ctx.fillText(boundary ? 'Grain boundary' : 'Single crystal', width / 2, height - 9);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#BDB6D6';
        ctx.fillText('Temperature', right, top + 4);
    }

    function loop(time) {
        draw(time);
        frame = visible && !reduceMotion ? requestAnimationFrame(loop) : null;
    }
    function restart() {
        if (frame) { cancelAnimationFrame(frame); frame = null; }
        build();
        loop(performance.now());
    }

    slider.addEventListener('input', restart);
    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(restart, 150);
    });
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            visible = entries[0].isIntersecting;
            if (visible && !frame && !reduceMotion) { frame = requestAnimationFrame(loop); }
        }).observe(canvas);
    }
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(restart); }
    restart();
})();
