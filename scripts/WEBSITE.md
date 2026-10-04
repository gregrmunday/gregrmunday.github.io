# Editing the one-page website

The main site is now `/`, with section links for research, publications, talks
and extracurricular activities. `/publications/`, `/talks/` and `/talkmap.html`
redirect to their home-page sections, preserving existing incoming links.
Individual publication/talk detail URLs remain available. The CV still opens
the PDF directly.

## Where to edit

| Content | File |
| --- | --- |
| Intro, research interests and contact invitation | `_data/home.yml` |
| Name, portrait, social links and CV PDF path | `author` in `_config.yml` |
| Email, awards, reviewer entries and service | `_data/academic_cv.yml` |
| Extracurricular activities and photos | `_data/extracurricular.yml` |
| Conference locations and presenter confirmations | `_data/talkmap.yml` |
| Menu labels and section links | `_data/navigation.yml` |

The sidebar displays only the `awards`, `reviewing` and `service` sections of
`academic_cv.yml`. Its other historical CV sections are retained for reference;
they do not create an online CV. Replace `files/GMunday_CV.pdf` to update the PDF.
Dates on awards are optional: leave them out when unknown.

## Add an activity with a photo

Put your image in `images/extracurricular/` (create the folder when you first
add a photo), then add an entry under `activities` in
`_data/extracurricular.yml`:

```yaml
  - title: My activity
    description: A short description of what I do.
    photos:
      - image: /images/extracurricular/my-photo.jpg
        alt: A useful description of what is visible
        caption: Optional place, date or story
    url: https://example.org/my-project
    link_label: Explore the project
```

Copy this entry for each activity. Photos, captions and the external link are
optional; omit them or use `photos: []` for a text-only card. Multiple photos
are supported. To adjust a photo's crop, add `position: '50% 35%'` to that photo.
Images are cropped to 4:3 and load lazily. For a lightweight page, export photos
at roughly 800–1200 pixels wide as JPEG or WebP and compress them before adding.
The starter cards contain no photographs; add your own when ready.
An activity with a `url` makes its entire card clickable; `link_label` provides
the visible link text and keyboard access. The Music card links to Spotify.

## Layout and compact lists

`_pages/about.md` defines the section order. `_layouts/onepage.html` creates the
profile/content/awards grid. Desktop has two columns; narrow screens put the
profile first, main sections next, and awards/service last.
`_sass/layout/_onepage.scss` controls spacing, colours and responsive layouts.
Styles are scoped to the home page. There are no new font or UI dependencies.

Journal articles stay visible; the longer publication categories and conference
catalogue use native `<details>` disclosures. Category links reveal their list,
and selecting a map city opens the conference catalogue. These are full lists,
not separately maintained selections. With JavaScript disabled, visitors can
still expand all lists; only the interactive map is unavailable.

`assets/js/onepage.js` handles deep links into closed lists and marks the current
section link. The map keeps its standalone interaction code. MathJax, Mermaid
and their polyfill are not loaded on the home page because it does not use them.

## Automated research data

Both Publications and the Talks map still read `_data/publications.json`, merged
from ORCID and Scholar by the scheduled workflow. Do not edit the generated JSON
to change author/presenter details. See [PUBLICATIONS.md](PUBLICATIONS.md) and
[TALKMAP.md](TALKMAP.md) for the syncing and annotation instructions.

Build locally with `bundle exec jekyll build`, or preview with
`bundle exec jekyll serve`. Restart the preview server after changing `_config.yml`.
