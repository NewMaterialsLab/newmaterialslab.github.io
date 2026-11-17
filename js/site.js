/* Shared behaviour: theme toggle, mobile menu, copy buttons, publication filters. */
(function () {
    'use strict';

    var root = document.documentElement;

    /* Theme. The stored choice is applied by the inline script in <head>; this keeps the button in step. */
    var themeButton = document.getElementById('theme-toggle');
    function currentTheme() {
        var set = root.getAttribute('data-theme');
        if (set) { return set; }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    function labelTheme() {
        if (!themeButton) { return; }
        var dark = currentTheme() === 'dark';
        themeButton.setAttribute('aria-pressed', dark ? 'true' : 'false');
        themeButton.querySelector('span').textContent = dark ? 'Light mode' : 'Dark mode';
    }
    if (themeButton) {
        themeButton.addEventListener('click', function () {
            var next = currentTheme() === 'dark' ? 'light' : 'dark';
            root.setAttribute('data-theme', next);
            try { localStorage.setItem('nml-theme', next); } catch (e) { /* private mode: the choice lasts for this page only */ }
            labelTheme();
            document.dispatchEvent(new CustomEvent('nml:theme'));
        });
        labelTheme();
    }

    /* Mobile menu */
    var header = document.querySelector('.site-header');
    var navButton = document.getElementById('nav-toggle');
    if (header && navButton) {
        navButton.addEventListener('click', function () {
            var open = header.classList.toggle('is-open');
            navButton.setAttribute('aria-expanded', open ? 'true' : 'false');
            navButton.querySelector('span').textContent = open ? 'Close' : 'Menu';
        });
    }

    /* Copy buttons: <button data-copy="text"> */
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(area);
            if (ok) { resolve(); } else { reject(new Error('copy failed')); }
        });
    }
    document.addEventListener('click', function (event) {
        var button = event.target.closest('[data-copy]');
        if (!button) { return; }
        var original = button.getAttribute('data-label') || button.textContent;
        button.setAttribute('data-label', original);
        copyText(button.getAttribute('data-copy')).then(function () {
            button.textContent = 'Copied';
        }, function () {
            button.textContent = 'Could not copy';
        }).then(function () {
            setTimeout(function () { button.textContent = original; }, 2200);
        });
    });

    /* Publication search and filters */
    var list = document.getElementById('publication-list');
    if (list) {
        var items = Array.prototype.slice.call(list.querySelectorAll('.work'));
        var headings = Array.prototype.slice.call(list.querySelectorAll('.year-heading'));
        var search = document.getElementById('pub-search');
        var status = document.getElementById('pub-status');
        var reset = document.getElementById('pub-reset');
        var state = { year: 'all', topic: 'all' };

        /* Each entry gets a "Copy citation" button built from its own text. */
        items.forEach(function (item) {
            var clean = function (selector) { return item.querySelector(selector).textContent.replace(/\s+/g, ' ').trim(); };
            var citation = clean('.work__authors').replace(/\.$/, '') + '. ' + clean('h3') + '. ' +
                clean('.work__journal') + ' (' + item.dataset.year + '). ' + item.querySelector('h3 a').href;
            item.dataset.text = item.textContent.replace(/\s+/g, ' ').toLowerCase();
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'button button--ghost button--small';
            button.textContent = 'Copy citation';
            button.setAttribute('data-copy', citation);
            item.querySelector('.button-row').appendChild(button);
        });

        function apply() {
            var query = search.value.trim().toLowerCase();
            var shown = 0;
            items.forEach(function (item) {
                var match = (state.year === 'all' || item.dataset.year === state.year) &&
                    (state.topic === 'all' || item.dataset.topics.split(' ').indexOf(state.topic) !== -1) &&
                    (query === '' || item.dataset.text.indexOf(query) !== -1);
                item.hidden = !match;
                if (match) { shown += 1; }
            });
            headings.forEach(function (heading) {
                var year = heading.dataset.year;
                heading.hidden = !items.some(function (item) { return item.dataset.year === year && !item.hidden; });
            });
            status.textContent = shown === 0
                ? 'No publications match. Clear the filters to see all ' + items.length + '.'
                : 'Showing ' + shown + ' of ' + items.length + ' publications.';
            reset.hidden = shown === items.length;
        }

        function press(group, value) {
            state[group] = value;
            document.querySelectorAll('.filters [data-filter="' + group + '"]').forEach(function (chip) {
                chip.setAttribute('aria-pressed', chip.getAttribute('data-value') === value ? 'true' : 'false');
            });
        }
        document.querySelectorAll('.filters [data-filter]').forEach(function (chip) {
            chip.addEventListener('click', function () {
                press(chip.getAttribute('data-filter'), chip.getAttribute('data-value'));
                apply();
            });
        });
        search.addEventListener('input', apply);
        reset.addEventListener('click', function () {
            search.value = '';
            press('year', 'all');
            press('topic', 'all');
            apply();
        });
        apply();
    }
})();

/* wget commands: show the address this page is really served from. */
(function () {
    'use strict';
    if (location.protocol.indexOf('http') !== 0) { return; }
    document.querySelectorAll('.command[data-file]').forEach(function (box) {
        var command = 'wget ' + new URL(box.getAttribute('data-file'), location.href).href;
        box.querySelector('code').textContent = command;
        box.querySelector('[data-copy]').setAttribute('data-copy', command);
    });
})();

/* Figures: select one to see it larger. */
(function () {
    'use strict';
    var dialog = null;
    document.addEventListener('click', function (event) {
        var trigger = event.target.closest('.zoom');
        if (!trigger) { return; }
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.className = 'lightbox';
            var form = document.createElement('form');
            form.method = 'dialog';
            var close = document.createElement('button');
            close.className = 'button button--small';
            close.textContent = 'Close';
            form.appendChild(close);
            dialog.appendChild(form);
            dialog.appendChild(document.createElement('img'));
            dialog.addEventListener('click', function (e) { if (e.target === dialog) { dialog.close(); } });
            document.body.appendChild(dialog);
        }
        var img = dialog.querySelector('img');
        img.src = trigger.getAttribute('data-full');
        img.alt = trigger.querySelector('img').alt;
        if (dialog.showModal) { dialog.showModal(); } else { window.open(img.src, '_blank'); }
    });
})();
