/* Native section links and disclosures; no navigation library needed. */
(() => {
  'use strict';
  if (!document.body.classList.contains('onepage-site')) return;

  function revealSection(hash, scroll = true) {
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;

    // Category links must also reveal content inside a closed disclosure.
    const disclosure = target.closest('details') || (
      target.classList.contains('publication-list__section') ? target.querySelector('details') : null
    );
    if (disclosure) disclosure.open = true;
    const section = target.closest('.home-section, .home-intro') || target;
    document.querySelectorAll('.masthead a').forEach(link => {
      const destination = new URL(link.href, window.location.href);
      if (destination.hash === `#${section.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    if (scroll) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.hash) {
      revealSection(destination.hash, destination.hash === window.location.hash);
    }
  });
  window.addEventListener('hashchange', () => revealSection(window.location.hash));
  if (window.location.hash) revealSection(window.location.hash);
})();
