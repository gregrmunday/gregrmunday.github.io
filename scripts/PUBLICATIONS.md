# Publication syncing

`_data/publications.json` is the merged list rendered on `/publications/`.
Its inputs are `_data/orcid_publications.json` (papers, preprints and conference
works) and `_data/scholar_publications.json` (conference entries only).
The profile URLs come from `author.orcid` and `author.googlescholar` in
`_config.yml`. ORCID metadata takes precedence for matching entries; each merged
work also records its sources.

## Refreshing locally

```sh
python3 scripts/sync_orcid.py
python3 scripts/sync_scholar.py
python3 scripts/merge_publications.py
```

All three scripts use the Python standard library. Scholar fetches the public
profile and reads additional citation pages for new conference entries when
needed. It supports profile pagination. No API keys, browser automation,
proxies or CAPTCHA solvers are used. Scholar can reject automated requests;
an unavailable or malformed profile leaves the committed cache untouched.
Unsuccessful detail requests leave an entry linked to its Scholar citation,
with profile metadata available for duplicate matching.

You can also import a saved profile HTML file:

```sh
python3 scripts/sync_scholar.py --source /path/to/profile.html --no-details
python3 scripts/merge_publications.py
```

`--details-dir` optionally loads saved citation pages named by the final part
of their `citation_for_view` ID, such as `u-x6o8ySG0sC.html`. This makes imports
reproducible without more network requests.

## Avoiding duplicates

The shared matching logic is in `scripts/publication_metadata.py`:

1. Compare normalised DOIs, removing resolver prefixes, case differences and
   URL encoding. Distinct DOIs remain separate versions.
2. If a DOI is missing, compare conference and abstract identifiers, including
   EGU/EMS codes embedded in DOIs and AGU abstract codes.
3. If identifiers are missing, compare normalised titles within the same
   conference and year. Punctuation, dashes and diacritics are ignored.

The same title at different meetings remains separate. Preprints remain
separate from their published papers. Conference years are taken from abstract
identifiers where available, so an EGU24 abstract deposited in 2025 is listed
under 2024. DOI and abstract IDs are retained in the data and rendered as HTML
metadata; abstract codes also appear beside conference titles.

## Automatic refresh

The existing `.github/workflows/sync_orcid.yml` workflow now refreshes both
sources daily at 06:23 UTC, tests the matching logic, merges the data, commits
changes and explicitly requests a Pages rebuild. If one source is unavailable,
the other can still update, using the last committed data for the failed source.
Read the individual fetch steps in Actions to see source failures.

Checks: `python3 -m unittest discover -s scripts -p 'test_publications.py'`.

The Talks map uses a separate list of personally delivered presentations in
`_talks/` and `_data/talkmap.yml`. Adding a co-authored conference work here does
not add it to that map.

References: [ORCID identifiers](https://info.orcid.org/documentation/integration-guide/orcid-and-persistent-identifiers/),
[Google Scholar help](https://scholar.google.com/intl/en/scholar/help.html).
