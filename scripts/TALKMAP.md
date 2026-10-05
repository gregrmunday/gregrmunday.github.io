# Updating the presentation map

## One shared conference list

The home-page Talks section and the conference section of Publications both
read `_data/publications.json`. The ORCID + Scholar sync merges and deduplicates
this file before publishing. Titles, years, abstracts and links are never copied
into a second map list. A newly imported conference contribution automatically
appears on both pages. Existing `_talks/` detail pages remain accessible, but no
longer supply the map list.
The old `/talks/` and `/talkmap.html` addresses redirect to `/#talks`.
Confirmed programme records missing from the automated sources can be added
to `_data/additional_publications.json` and merged with
`python3 scripts/merge_publications.py`. The JuliaCon 2026 presentation uses
this maintained input; it appears in both sections and survives daily refreshes.

`_data/talkmap.yml` contains only manual annotations: meeting locations,
author/presenter confirmations, and talk/poster formats. Source refreshes do
not overwrite it. Both page templates use `_includes/conference-metadata.html`
to interpret these annotations, so presenter details stay consistent too.

## Confirm who presented

Under `overrides`, use the normalised DOI as the key. For an abstract without a
DOI, use `venue:abstract_id`, for example `AGU 2024:B41E-02`. These identifiers
continue to match when a title changes. For records without an abstract ID,
the key falls back to venue + Scholar ID, ORCID put-code, or title.

```yaml
overrides:
  "10.5194/egusphere-egu26-18937":
    presented_by_gregory: true
    type: Conference presentation
  "AGU 2024:B41E-02":
    author_role: co-author
    type: Conference talk
```

Green means first author **or personally presenting author**; blue means
co-author. Author order comes from the merged Scholar metadata unless explicitly
set using `author_role: first-author`, `co-author` or `unknown`.
`presented_by_gregory: true` makes the point green and labels it “Presenting
author”, preserving the actual author order. AGU 2022, AGU 2023 and the
ScenarioMIP-CMIP7 / ProFSea EGU 2026 abstract use this confirmation. AGU 2024 is
blue. Unknown author order stays neutral and is explained in the legend.
For a confirmed second author, add `author_position: 2` alongside
`author_role: co-author`. Both pages show “Second author”; the point stays blue.
The Utrecht EMS 2026 contribution uses this annotation.

## Add a conference location

Add a venue under `meetings` and coordinates under `locations` once per city:

```yaml
meetings:
  AGU 2024:
    location: Washington, DC, USA
locations:
  - name: Washington, DC, USA
    latitude: 38.9072
    longitude: -77.0369
```

Coordinates refer to the conference city's centre, not proof of personal travel.
A per-abstract `location` override is also supported. New meetings without a
confirmed location still appear in the list, labelled “Location not yet added”;
the map never invents coordinates or uses the previous year's city.

`include_all_conferences: true` keeps all conference contributions in sync by
default, including co-authored work. For a curated map, set it to `false` and
add `show_on_map: true` to the desired overrides. Publications still lists all
conference records. Preview annotation changes with the normal Jekyll build;
no source refresh is needed to change presenter details or locations.

## Map implementation

Template: `_includes/talks-atlas.html` and `_includes/talkmap-entry.html`.
Behaviour: `assets/js/talks-atlas.js`. Styles: `_sass/layout/_talks_atlas.scss`.
The old notebook-generated Leaflet files are no longer used by these pages.

City markers and buttons filter the list; year selection filters both markers
and entries. Hovering over a city with multiple entries unfolds a spoke network
with one point per contribution. Selecting a city pins it open for touch and
keyboard users. Focus a cluster and press the down arrow to reach its points;
Enter selects a point. Hover/focus shows its title and role; selecting it shows
linked details and highlights the corresponding list entry. Spread distances
stay constant in screen pixels while zooming; larger groups use multiple rings.
Hover cards sit above the entire expanded cluster, with clearance for every
point. They can extend above the map's border when the cluster is near its top.

Mouse dragging pans; buttons or +/- zoom; arrow keys pan when the map has focus;
Escape resets. Touch scrolling remains native. The full list is available without
JavaScript. The interaction code has no library dependency and makes no external
map-tile or geocoding requests.

Map outline: `assets/images/talkmap-world.svg`, derived from Natural Earth's
public-domain 1:110m land dataset (56 KB uncompressed, equirectangular projection).
Sources: [Natural Earth land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson),
[public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/).
