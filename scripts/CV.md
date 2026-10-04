# Editing the CV

All text for `/cv/` lives in `_data/academic_cv.yml`. Edit that file to update the
page; Jekyll renders it automatically. Sections and entries appear in the order
written, so put recent positions and awards first.

Each section has an `id`, `title` and `entries`. Every entry needs a `title`.
Optional fields: `organisation`, `dates`, `summary`, `url` and `highlights`
(a list of short bullet points). Dates are plain text; quote standalone years
such as `"2026"`. No HTML is needed. Quote text containing a colon followed by
a space.

Add prizes under `id: awards`, journals under `id: reviewing`, and interests or
activities under `id: extracurricular`. Commented examples are beside those
sections. Empty sections and their navigation links are hidden.

For example, replace the reviewing section with:

```yaml
  - id: reviewing
    title: Reviewer for
    entries:
      - title: Journal name
        dates: 2026–present
```

To offer a PDF download, add the file to `files/` and set `pdf_url` near the top
of the YAML file to `/files/your-cv.pdf`. The browser's Print menu also gives a
clean copy without site navigation or the profile sidebar.

Layout: `_includes/academic-cv.html`. Styles: `_sass/layout/_academic_cv.scss`.
These are separate from the text so routine updates only need the YAML file.
The older `scripts/update_cv_json.sh` converter belongs to the template's JSON
CV and is not used by this page.
