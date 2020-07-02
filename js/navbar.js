function toggleNavLinks() {
    var nav = document.getElementById('navbar');
    var icon = document.getElementById('toggle-nav-links-icon');
    if (nav.className === 'navbar') {
        nav.className += ' navbar--show-links';
        icon.className = 'fa fa-times';
    } else {
        nav.className = 'navbar';
        icon.className = 'fa fa-bars';
    }
}