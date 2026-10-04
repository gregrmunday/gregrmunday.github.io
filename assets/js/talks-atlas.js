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
  const tooltip = root.querySelector('[data-map-tooltip]');
  const selection = root.querySelector('[data-map-selection]');
  const entries = [...root.querySelectorAll('.talks-atlas__entry')];
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const cities = new Map();
  let selectedCity = null;
  let zoom = 1;
  let centre = { x: 180, y: 90 };
  let drag = null;
  let didDrag = false;
  let expandedCity = null;
  let collapseTimer = null;
  let selectedEntry = null;
  const roleLabels = {
    'first-author': 'First author',
    'co-author': 'Co-author',
    presenter: 'Presenting author',
    unknown: 'Author order unconfirmed'
  };

  root.querySelector('[data-legend-presenter]').hidden = !entries.some(entry => entry.dataset.authorRole === 'presenter');
  root.querySelector('[data-legend-unknown]').hidden = !entries.some(entry => entry.dataset.authorRole === 'unknown');

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
    if (selectedCity) expandCity(cities.get(selectedCity));
    else collapseNetwork();
  }

  const allCitiesButton = document.createElement('button');
  allCitiesButton.type = 'button';
  allCitiesButton.textContent = 'Everywhere';
  allCitiesButton.addEventListener('click', reset);
  cityContainer.append(allCitiesButton);

  cities.forEach(city => {
    const group = svgElement('g', { class: 'talks-atlas__city' });
    const backdrop = svgElement('circle', {
      class: 'talks-atlas__network-backdrop', fill: 'transparent', 'aria-hidden': 'true'
    });
    const network = svgElement('g', {
      class: 'talks-atlas__network', 'aria-hidden': 'true'
    });
    const marker = svgElement('g', {
      class: 'talks-atlas__marker', role: 'button', tabindex: '0'
    });
    // A generous invisible target keeps the visible marker delicate.
    marker.append(svgElement('circle', { r: '9', class: 'talks-atlas__hit' }));
    marker.append(svgElement('circle', { r: '4.8', class: 'talks-atlas__halo' }));
    marker.append(svgElement('circle', { r: '2.6', class: 'talks-atlas__pin' }));
    const title = svgElement('title', {});
    marker.append(title);
    const countLabel = svgElement('text', {
      class: 'talks-atlas__cluster-count', 'text-anchor': 'middle', dy: '1.1', 'aria-hidden': 'true'
    });
    marker.append(countLabel);
    marker.addEventListener('click', () => { if (!didDrag) selectCity(city.name); });
    marker.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        selectCity(city.name);
      } else if (event.key === 'ArrowDown' && city.nodes.length) {
        event.preventDefault();
        event.stopPropagation();
        expandCity(city);
        city.nodes[0].marker.focus();
      }
    });
    marker.addEventListener('pointerenter', () => {
      const visible = city.entries.filter(matchesYear);
      if (visible.length === 1) showTooltip(visible[0], marker);
    });
    marker.addEventListener('pointerleave', hideTooltip);
    group.append(backdrop, marker, network);
    markerLayer.append(group);
    group.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse' && !drag) expandCity(city);
    });
    group.addEventListener('pointerleave', () => scheduleCollapse(city));
    group.addEventListener('focusin', () => expandCity(city));
    group.addEventListener('focusout', event => {
      if (!group.contains(event.relatedTarget)) scheduleCollapse(city);
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => selectCity(city.name));
    cityContainer.append(button);
    Object.assign(city, { group, backdrop, network, marker, button, title, countLabel, nodes: [] });
  });

  function roleFor(entry) {
    return entry.dataset.authorRole || 'unknown';
  }

  function showTooltip(entry, marker) {
    const title = document.createElement('strong');
    title.textContent = entry.querySelector('h3').textContent.trim();
    const meta = document.createElement('small');
    meta.textContent = `${entry.dataset.year} · ${roleLabels[roleFor(entry)]}`;
    tooltip.replaceChildren(title, meta);
    tooltip.hidden = false;
    const mapRect = svg.parentElement.getBoundingClientRect();
    const pointRect = marker.getBoundingClientRect();
    const left = Math.max(8, Math.min(mapRect.width - tooltip.offsetWidth - 8, pointRect.left - mapRect.left - tooltip.offsetWidth / 2));
    const top = Math.max(8, pointRect.top - mapRect.top - tooltip.offsetHeight - 10);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function selectPresentation(city, entry) {
    selectedCity = city.name;
    selectedEntry?.classList.remove('talks-atlas__entry--selected');
    selectedEntry = entry;
    entry.classList.add('talks-atlas__entry--selected');
    updateFilter();
    expandCity(city);
    const title = entry.querySelector('h3').cloneNode(true);
    const meta = document.createElement('span');
    meta.textContent = `${entry.dataset.year} · ${city.name} · ${roleLabels[roleFor(entry)]}`;
    selection.replaceChildren(title, meta);
    selection.hidden = false;
  }

  function collapseNetwork() {
    clearTimeout(collapseTimer);
    if (expandedCity) {
      const city = cities.get(expandedCity);
      city.group.classList.remove('talks-atlas__city--expanded');
      city.network.setAttribute('aria-hidden', 'true');
      city.marker.setAttribute('aria-expanded', 'false');
      city.nodes.forEach(node => node.marker.setAttribute('tabindex', '-1'));
    }
    expandedCity = null;
    hideTooltip();
  }

  function expandCity(city) {
    clearTimeout(collapseTimer);
    if (expandedCity !== city.name) collapseNetwork();
    if (city.nodes.length <= 1) return;
    expandedCity = city.name;
    city.group.classList.add('talks-atlas__city--expanded');
    city.network.setAttribute('aria-hidden', 'false');
    city.marker.setAttribute('aria-expanded', 'true');
    city.nodes.forEach(node => node.marker.setAttribute('tabindex', '0'));
    // Bring the whole network forward so neighbouring city markers cannot hide it.
    if (markerLayer.lastElementChild !== city.group && !city.group.contains(document.activeElement)) {
      markerLayer.append(city.group);
    }
  }

  function scheduleCollapse(city) {
    hideTooltip();
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      if (selectedCity !== city.name && !city.group.contains(document.activeElement) && expandedCity === city.name) {
        collapseNetwork();
      }
    }, 140);
  }

  function rebuildNetwork(city) {
    const visible = city.entries.filter(matchesYear);
    // Keep existing nodes when only the city selection changes, preserving focus.
    if (city.nodes.length === visible.length && city.nodes.every((node, index) => node.entry === visible[index])) {
      return;
    }
    city.network.replaceChildren();
    city.nodes = [];
    visible.forEach(entry => {
      const line = svgElement('line', { class: 'talks-atlas__network-link', x1: '0', y1: '0' });
      const marker = svgElement('g', {
        class: 'talks-atlas__talk-point', role: 'button', tabindex: '-1',
        'data-author-role': roleFor(entry),
        'aria-label': `${entry.dataset.year}: ${entry.querySelector('h3').textContent.trim()}. ${roleLabels[roleFor(entry)]}. Select for details.`
      });
      const hit = svgElement('circle', { class: 'talks-atlas__hit' });
      const pin = svgElement('circle', { class: 'talks-atlas__pin' });
      marker.append(hit, pin);
      marker.addEventListener('pointerenter', () => showTooltip(entry, marker));
      marker.addEventListener('pointerleave', hideTooltip);
      marker.addEventListener('focus', () => showTooltip(entry, marker));
      marker.addEventListener('blur', hideTooltip);
      marker.addEventListener('click', event => {
        event.stopPropagation();
        if (!didDrag) selectPresentation(city, entry);
      });
      marker.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          selectPresentation(city, entry);
        }
      });
      city.network.append(line, marker);
      city.nodes.push({ entry, marker, line, hit, pin });
    });
    city.marker.setAttribute('data-author-role', visible.length === 1 ? roleFor(visible[0]) : 'cluster');
    city.countLabel.textContent = visible.length > 1 ? String(visible.length) : '';
    city.marker.querySelector('.talks-atlas__pin').setAttribute('r', visible.length > 1 ? '4' : '2.6');
    city.marker.setAttribute('aria-expanded', 'false');
    layoutNetwork(city);
  }

  function layoutNetwork(city) {
    // Keep the spread and target sizes constant in screen pixels at every zoom.
    const unit = 360 / Math.max(svg.clientWidth, 1);
    const perRing = 10;
    city.nodes.forEach((node, index) => {
      const ring = Math.floor(index / perRing);
      const count = Math.min(perRing, city.nodes.length - ring * perRing);
      const angle = (index % perRing) / count * Math.PI * 2 - Math.PI / 2;
      const radius = (34 + ring * 24) * unit;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      node.marker.setAttribute('transform', `translate(${x},${y})`);
      node.hit.setAttribute('r', 11 * unit);
      node.pin.setAttribute('r', 5 * unit);
      node.line.setAttribute('x2', x);
      node.line.setAttribute('y2', y);
    });
    city.backdrop.setAttribute('r', (48 + Math.floor(Math.max(0, city.nodes.length - 1) / perRing) * 24) * unit);
  }

  function updateView() {
    const width = 360 / zoom;
    const height = 180 / zoom;
    centre.x = Math.max(width / 2, Math.min(360 - width / 2, centre.x));
    centre.y = Math.max(height / 2, Math.min(180 - height / 2, centre.y));
    svg.setAttribute('viewBox', `${centre.x - width / 2} ${centre.y - height / 2} ${width} ${height}`);
    cities.forEach(city => {
      city.group.setAttribute('transform', `translate(${city.x},${city.y}) scale(${1 / zoom})`);
      layoutNetwork(city);
    });
    root.querySelector('[data-map-zoom="in"]').disabled = zoom >= 6;
    root.querySelector('[data-map-zoom="out"]').disabled = zoom <= 1;
  }

  function matchesYear(entry) {
    return yearSelect.value === 'all' || entry.dataset.year === yearSelect.value;
  }

  function updateFilter() {
    collapseNetwork();
    const yearEntries = entries.filter(matchesYear);
    const mappedCities = [...cities.values()].filter(city => city.entries.some(matchesYear));
    const visibleEntries = yearEntries.filter(entry => !selectedCity || entry.dataset.location === selectedCity);
    entries.forEach(entry => { entry.hidden = !visibleEntries.includes(entry); });
    cities.forEach(city => {
      const count = city.entries.filter(matchesYear).length;
      const active = city.name === selectedCity;
      city.group.style.display = count ? '' : 'none';
      city.marker.setAttribute('aria-pressed', String(active));
      city.marker.setAttribute('aria-label', `${city.name}: ${count} presentation${count === 1 ? '' : 's'}`);
      city.title.textContent = city.marker.getAttribute('aria-label');
      city.button.hidden = count === 0;
      city.button.textContent = `${city.name.split(',')[0]} · ${count}`;
      city.button.setAttribute('aria-pressed', String(active));
      rebuildNetwork(city);
    });
    allCitiesButton.setAttribute('aria-pressed', String(!selectedCity));
    root.querySelector('[data-map-count]').textContent = `${yearEntries.length} presentation${yearEntries.length === 1 ? '' : 's'} · ${mappedCities.length} ${mappedCities.length === 1 ? 'city' : 'cities'}`;
    heading.textContent = selectedCity || 'All presentations';
    if (yearSelect.value !== 'all') heading.textContent += ` · ${yearSelect.value}`;
    clearButton.hidden = !selectedCity;
    root.querySelector('[data-map-empty]').hidden = visibleEntries.length > 0;
    if (selectedEntry && !visibleEntries.includes(selectedEntry)) {
      selectedEntry.classList.remove('talks-atlas__entry--selected');
      selectedEntry = null;
      selection.hidden = true;
    }
    if (selectedCity) expandCity(cities.get(selectedCity));
  }

  function reset() {
    collapseNetwork();
    selectedEntry?.classList.remove('talks-atlas__entry--selected');
    selectedEntry = null;
    selection.hidden = true;
    selectedCity = null;
    zoom = 1;
    centre = { x: 180, y: 90 };
    updateView();
    updateFilter();
  }

  function changeZoom(factor) {
    hideTooltip();
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
    didDrag = false;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, centre: { ...centre } };
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    didDrag = true;
    hideTooltip();
    svg.setPointerCapture(event.pointerId);
    const scale = Math.min(svg.clientWidth / (360 / zoom), svg.clientHeight / (180 / zoom));
    centre = { x: drag.centre.x - dx / scale, y: drag.centre.y - dy / scale };
    updateView();
  });
  const endDrag = () => { drag = null; };
  window.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(() => cities.forEach(layoutNetwork));
    resizeObserver.observe(svg);
  } else {
    window.addEventListener('resize', () => cities.forEach(layoutNetwork));
  }

  updateView();
  updateFilter();
  root.querySelector('.talks-atlas__interactive').hidden = false;
})();
