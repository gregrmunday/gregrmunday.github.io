/* Native section links and disclosures; no navigation library needed. */
(() => {
  'use strict';
  if (!document.body.classList.contains('onepage-site')) return;

  const hoverAvailable = window.matchMedia('(hover: hover) and (pointer: fine)');
  document.querySelectorAll('.activity-card--flip').forEach(card => {
    const front = card.querySelector('.activity-card__front');
    const back = card.querySelector('.activity-card__back');
    card.classList.add('activity-card--flip-ready');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${front.querySelector('h3').textContent}: show or hide ${back.querySelector('h3').textContent.toLowerCase()} details`);
    card.setAttribute('aria-controls', back.id);
    card.setAttribute('aria-describedby', back.id);
    function flip(show) {
      card.setAttribute('aria-expanded', String(show));
      front.setAttribute('aria-hidden', String(show));
      back.setAttribute('aria-hidden', String(!show));
    }
    flip(false);
    card.addEventListener('pointerenter', event => {
      if (hoverAvailable.matches && event.pointerType !== 'touch') flip(true);
    });
    card.addEventListener('pointerleave', event => {
      if (hoverAvailable.matches && event.pointerType !== 'touch') flip(false);
    });
    let touchInteraction = false;
    card.addEventListener('pointerdown', event => {
      touchInteraction = event.pointerType === 'touch';
    });
    card.addEventListener('click', event => {
      if (touchInteraction || !hoverAvailable.matches || event.detail === 0) flip(card.getAttribute('aria-expanded') !== 'true');
    });
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flip(card.getAttribute('aria-expanded') !== 'true');
      } else if (event.key === 'Escape') flip(false);
    });
    card.addEventListener('blur', () => flip(false));
  });

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
