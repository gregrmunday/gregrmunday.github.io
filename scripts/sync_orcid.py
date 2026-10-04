#!/usr/bin/env python3
"""Refresh the site's cached public ORCID works (Python standard library only)."""

import argparse
import html
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from publication_metadata import normalize_doi

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = [
    ("journal_articles", "Journal articles"),
    ("preprints", "Preprints"),
    ("conferences", "Conference presentations and posters"),
    ("other", "Other research outputs"),
]


def value(field):
    return (field or {}).get("value", "") or ""


def safe_url(url):
    return url if urlparse(url).scheme in {"http", "https"} else ""


def fetch(url):
    for attempt in range(3):
        try:
            request = Request(url, headers={"Accept": "application/json", "User-Agent": "AcademicWebsite-ORCID-Sync/1.0"})
            with urlopen(request, timeout=60) as response:
                return json.load(response)
        except (HTTPError, URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def normalize(summary, orcid):
    title = html.unescape(value((summary.get("title") or {}).get("title"))).strip()
    if not title:
        raise ValueError("ORCID returned a work without a title; keeping the previous cache")
    work_type = summary.get("type", "other")
    identifiers = (summary.get("external-ids") or {}).get("external-id", [])
    doi = next((item["external-id-value"].strip() for item in identifiers
                if item.get("external-id-type") == "doi"
                and item.get("external-id-relationship") == "self"), "")
    doi = normalize_doi(doi)
    # Copernicus imports meeting abstracts as preprints in ORCID.
    conference_doi = re.match(r"^10\.5194/(?:egusphere-)?(?:egu|ems)\d{2,4}-", doi, re.I)
    if "conference" in work_type or work_type in {"lecture-speech", "poster"} or conference_doi:
        category = "conferences"
        label = "Conference abstract" if conference_doi else work_type.replace("-", " ").capitalize()
    elif doi.lower().endswith("-supplement") or title.lower().startswith("supplementary material"):
        category, label = "other", "Supplementary material"
    elif work_type == "preprint":
        category, label = "preprints", "Preprint"
    elif work_type in {"journal-article", "review"}:
        category, label = "journal_articles", "Journal article"
    else:
        category, label = "other", work_type.replace("-", " ").capitalize()
    date = summary.get("publication-date") or {}
    year, month, day = (value(date.get(key)) for key in ("year", "month", "day"))
    sort_date = f"{year or '0000'}-{int(month or 0):02d}-{int(day or 0):02d}"
    venue = html.unescape(value(summary.get("journal-title"))).strip()
    if conference_doi and not venue:
        match = re.search(r"(egu|ems)(\d{2,4})-", doi, re.I)
        meeting_year = match[2] if len(match[2]) == 4 else "20" + match[2]
        venue = f"{match[1].upper()} {meeting_year}"
    url = ("https://doi.org/" + quote(doi, safe="/():;-") if doi
           else safe_url(value(summary.get("url"))))
    return {
        "put_code": summary["put-code"], "title": title, "type": work_type,
        "category": category, "label": label, "year": year, "sort_date": sort_date,
        "venue": venue, "doi": doi, "url": url,
        "orcid_url": f"https://orcid.org/{orcid}",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Read a downloaded ORCID works JSON instead of fetching")
    args = parser.parse_args()
    config = (ROOT / "_config.yml").read_text()
    match = re.search(r"orcid\s*:\s*[\"']?https://orcid\.org/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])", config)
    if not match:
        raise ValueError("Set author.orcid in _config.yml to your ORCID profile URL")
    orcid = match[1]
    payload = json.loads(args.source.read_text()) if args.source else fetch(f"https://pub.orcid.org/v3.0/{orcid}/works")
    groups = payload.get("group")
    if not isinstance(groups, list):
        raise ValueError("Unexpected ORCID response; keeping the previous cache")
    works = []
    seen = set()
    for group in groups:
        summaries = group.get("work-summary", [])
        if not summaries:
            raise ValueError("Empty ORCID work group; keeping the previous cache")
        # ORCID groups duplicate source records; respect the preferred version.
        summary = max(summaries, key=lambda item: int(item.get("display-index") or 0))
        work = normalize(summary, orcid)
        key = work["doi"].lower() or str(work["put_code"])
        if key not in seen:
            works.append(work)
            seen.add(key)
    works.sort(key=lambda work: (work["sort_date"], work["title"], work["put_code"]), reverse=True)
    output = ROOT / "_data/orcid_publications.json"
    # A suddenly empty response should not erase an established list.
    if not works and output.exists() and json.loads(output.read_text()).get("works"):
        raise ValueError("ORCID returned no works; keeping the previous cache")
    data = {"orcid": orcid, "profile_url": f"https://orcid.org/{orcid}",
            "categories": [{"id": key, "title": title} for key, title in CATEGORIES], "works": works}
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if not output.exists() or output.read_text() != content:
        temporary = output.with_suffix(".tmp")
        temporary.write_text(content)
        temporary.replace(output)
    print(f"Cached {len(works)} public ORCID works")
    for key, title in CATEGORIES:
        print(f"  {title}: {sum(work['category'] == key for work in works)}")


if __name__ == "__main__":
    main()
