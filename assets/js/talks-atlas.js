/* Small, dependency-free map. Presentation content is rendered by Jekyll. */
(() => {
  'use strict';

  const root = document.querySelector('[data-talks-atlas]');
  if (!root) return;

  const svg = root.querySelector('[data-world-map]');
  const markerLayer = root.querySelector('[data-map-markers]');
  const yearSelect = root.querySelector('[data-map-year]');
  const cityContainer = root.querySelector('[data-map-cities]');
  const heading = root.querySelector('[data-list-heading]');
  const clearButton = root.querySelector('[data-map-clear]');
  const entries = [...root.querySelectorAll('.talks-atlas__entry')];
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const cities = new Map();
  let selectedCity = null;
  let zoom = 1;
  let centre = { x: 180, y: 90 };
  let drag = null;
  let didDrag = false;

  // Sort the combined talk pages and extra entries, with newest years first.
  entries.sort((a, b) => Number(b.dataset.year) - Number(a.dataset.year));
  entries.forEach(entry => root.querySelector('.talks-atlas__list').append(entry));
  const years = [...new Set(entries.map(entry => entry.dataset.year))].sort().reverse();
  years.forEach(year => yearSelect.add(new Option(year, year)));

  entries.forEach(entry => {
    if (!entry.hasAttribute('data-latitude')) return;
    const { location, latitude, longitude } = entry.dataset;
    if (!cities.has(location)) {
      cities.set(location, {
        name: location,
        x: Number(longitude) + 180,
        y: 90 - Number(latitude),
        entries: []
      });
    }
    cities.get(location).entries.push(entry);
  });

  function svgElement(tag, attributes) {
    const element = document.createElementNS(svgNamespace, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function selectCity(name) {
    selectedCity = selectedCity === name ? null : name;
    if (selectedCity) {
      const city = cities.get(selectedCity);
      centre = { x: city.x, y: city.y };
      zoom = 2.5;
    } else {
      centre = { x: 180, y: 90 };
      zoom = 1;
    }
    updateView();
    updateFilter();
  }

  const allCitiesButton = document.createElement('button');
  allCitiesButton.type = 'button';
  allCitiesButton.textContent = 'Everywhere';
  allCitiesButton.addEventListener('click', reset);
  cityContainer.append(allCitiesButton);

  cities.forEach(city => {
    const marker = svgElement('g', {
      class: 'talks-atlas__marker', role: 'button', tabindex: '0'
    });
    // A generous invisible target keeps the visible marker delicate.
    marker.append(svgElement('circle', { r: '9', class: 'talks-atlas__hit' }));
    marker.append(svgElement('circle', { r: '4.8', class: 'talks-atlas__halo' }));
    marker.append(svgElement('circle', { r: '2.6', class: 'talks-atlas__pin' }));
    const title = svgElement('title', {});
    marker.append(title);
    marker.addEventListener('click', () => { if (!didDrag) selectCity(city.name); });
    marker.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        selectCity(city.name);
      }
    });
    markerLayer.append(marker);

    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => selectCity(city.name));
    cityContainer.append(button);
    Object.assign(city, { marker, button, title });
  });

  function updateView() {
    const width = 360 / zoom;
    const height = 180 / zoom;
    centre.x = Math.max(width / 2, Math.min(360 - width / 2, centre.x));
    centre.y = Math.max(height / 2, Math.min(180 - height / 2, centre.y));
    svg.setAttribute('viewBox', `${centre.x - width / 2} ${centre.y - height / 2} ${width} ${height}`);
    cities.forEach(city => city.marker.setAttribute('transform', `translate(${city.x},${city.y}) scale(${1 / zoom})`));
    root.querySelector('[data-map-zoom="in"]').disabled = zoom >= 6;
    root.querySelector('[data-map-zoom="out"]').disabled = zoom <= 1;
  }

  function matchesYear(entry) {
    return yearSelect.value === 'all' || entry.dataset.year === yearSelect.value;
  }

  function updateFilter() {
    const yearEntries = entries.filter(matchesYear);
    const mappedCities = [...cities.values()].filter(city => city.entries.some(matchesYear));
    const visibleEntries = yearEntries.filter(entry => !selectedCity || entry.dataset.location === selectedCity);
    entries.forEach(entry => { entry.hidden = !visibleEntries.includes(entry); });
    cities.forEach(city => {
      const count = city.entries.filter(matchesYear).length;
      const active = city.name === selectedCity;
      city.marker.hidden = count === 0;
      city.marker.style.display = count ? '' : 'none';
      city.marker.setAttribute('aria-pressed', String(active));
      city.marker.setAttribute('aria-label', `${city.name}: ${count} presentation${count === 1 ? '' : 's'}`);
      city.title.textContent = city.marker.getAttribute('aria-label');
      city.button.hidden = count === 0;
      city.button.textContent = `${city.name.split(',')[0]} · ${count}`;
      city.button.setAttribute('aria-pressed', String(active));
    });
    allCitiesButton.setAttribute('aria-pressed', String(!selectedCity));
    root.querySelector('[data-map-count]').textContent = `${yearEntries.length} presentation${yearEntries.length === 1 ? '' : 's'} · ${mappedCities.length} ${mappedCities.length === 1 ? 'city' : 'cities'}`;
    heading.textContent = selectedCity || 'All presentations';
    if (yearSelect.value !== 'all') heading.textContent += ` · ${yearSelect.value}`;
    clearButton.hidden = !selectedCity;
    root.querySelector('[data-map-empty]').hidden = visibleEntries.length > 0;
  }

  function reset() {
    selectedCity = null;
    zoom = 1;
    centre = { x: 180, y: 90 };
    updateView();
    updateFilter();
  }

  function changeZoom(factor) {
    zoom = Math.max(1, Math.min(6, zoom * factor));
    updateView();
  }

  yearSelect.addEventListener('change', () => {
    if (selectedCity && !cities.get(selectedCity).entries.some(matchesYear)) reset();
    else updateFilter();
  });
  clearButton.addEventListener('click', reset);
  root.querySelector('[data-map-reset]').addEventListener('click', reset);
  root.querySelector('[data-map-zoom="in"]').addEventListener('click', () => changeZoom(1.5));
  root.querySelector('[data-map-zoom="out"]').addEventListener('click', () => changeZoom(1 / 1.5));

  svg.addEventListener('keydown', event => {
    const step = 15 / zoom;
    const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (directions[event.key]) {
      event.preventDefault();
      centre.x += directions[event.key][0];
      centre.y += directions[event.key][1];
      updateView();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault(); changeZoom(1.5);
    } else if (event.key === '-') {
      event.preventDefault(); changeZoom(1 / 1.5);
    } else if (event.key === 'Escape') reset();
  });

  // Keep touch scrolling native; city buttons and zoom controls work on touch.
  svg.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    didDrag = false;
    drag = { x: event.clientX, y: event.clientY, centre: { ...centre } };
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    didDrag = true;
    svg.setPointerCapture(event.pointerId);
    const scale = Math.min(svg.clientWidth / (360 / zoom), svg.clientHeight / (180 / zoom));
    centre = { x: drag.centre.x - dx / scale, y: drag.centre.y - dy / scale };
    updateView();
  });
  const endDrag = () => { drag = null; };
  window.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  updateView();
  updateFilter();
  root.querySelector('.talks-atlas__interactive').hidden = false;
})();
