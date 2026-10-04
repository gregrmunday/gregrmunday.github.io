# Updating the presentation map

The Talks page and `/talkmap.html` share the same self-contained map and list.
They use `_talks/` plus any extra entries in `_data/talkmap.yml`. ORCID works are
not imported into this map: co-authorship does not establish who presented.
Use these sources for presentations you personally delivered.

For a presentation with its own page, add a Markdown file to `_talks/`:

```yaml
---
title: My presentation title
collection: talks
type: Conference talk
permalink: /talks/2026-my-talk
venue: Conference name
date: 2026-06-01
location: Vienna, Austria
---
```

For a presentation that only needs an external abstract link, add an entry to
`presentations` in `_data/talkmap.yml` instead. There is a commented example in
that file. The browser sorts the combined list by year, newest first.
The AGU22 and AGU23 entries were found on Gregory's Google Scholar profile;
their `source` fields record those citation links, and `url` links to the
corresponding NASA ADS abstracts. These manual entries persist independently
of ORCID syncs. `abstract_id` optionally displays the conference abstract code.
Use `year` alone when the precise presentation day is unknown.

New cities need an entry under `locations` with a matching name, latitude and
longitude. Coordinates refer to the city centre. Unrecognised locations still
appear in the list, but are never plotted at a guessed location. To omit an
existing co-authored talk you did not deliver, add its permalink to
`exclude_talks`. This preserves its existing detail page.

Map outline: `assets/images/talkmap-world.svg`, derived from Natural Earth's
public-domain 1:110m land dataset. The map uses an equirectangular projection
and city-level positions. The outline is 56 KB uncompressed; the interaction
script is a small standalone file, loaded only on pages with the map. It makes
no external map-tile or geocoding requests.

Template: `_includes/talks-atlas.html` and `_includes/talkmap-entry.html`.
Behaviour: `assets/js/talks-atlas.js`. Styles: `_sass/layout/_talks_atlas.scss`.
The old notebook-generated Leaflet files are no longer used by these pages.

City markers and buttons filter the list. Year selection filters both the
markers and entries. Mouse dragging pans; buttons or +/- zoom; arrow keys pan
when the map has focus; Escape resets the view. Touch users can select cities
and use zoom controls while vertical page scrolling remains native. The full
presentation list is available without JavaScript.

Source: [Natural Earth land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson),
[public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/).
