# Automatic publications

The publications page uses `_data/orcid_publications.json`, fetched from the public
ORCID record configured in `author.orcid` in `_config.yml`. Only public works can
appear. Edit publication metadata and visibility on ORCID to update the website.

Run `python3 scripts/sync_orcid.py` to refresh locally. The script uses only the
Python standard library. To import a previously downloaded works response, use
`python3 scripts/sync_orcid.py --source /path/to/works.json`.

After the changes are pushed to `master`, **Sync ORCID publications** runs daily
at 06:23 UTC, and can also be run from GitHub's Actions tab. It commits changed
data and explicitly requests a Pages rebuild, because commits made with
`GITHUB_TOKEN` do not trigger the usual automatic build. This matches this
repository's existing Pages configuration (`master`, root, branch publishing).
The workflow needs Contents and Pages write permissions and an unprotected
branch, or branch rules that allow this bot to push. GitHub may disable scheduled
workflows on inactive public repositories; re-enable the workflow in Actions if
that happens. No ORCID token or repository secret is needed.

Works are sorted newest first within each category. ORCID's preferred record is
used for each work group, and duplicate DOIs are removed. Journal articles and
reviews go into Journal articles; preprints have their own section. Conference
work types, posters and lectures go into Conference presentations and posters.
Copernicus EGU/EMS meeting DOI patterns are also classified as conference
abstracts, since ORCID imports these as preprints. The metadata does not identify
whether each abstract was a talk or poster, so those are labelled conference
abstracts. Supplementary materials and other work types appear in Other research
outputs. Preprints and their published versions remain separate works.

An unsuccessful fetch leaves the cached data untouched. Existing `_publications`
files and their URLs remain available, with the old list as a fallback if the
ORCID data file is absent.

References: [ORCID public data](https://info.orcid.org/documentation/api-tutorials/api-tutorial-read-data-on-a-record/)
and [GitHub Pages build API](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build).
