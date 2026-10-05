#!/usr/bin/env python3
"""Merge ORCID, Scholar and additional programme records into one bibliography."""

import copy
import json

from publication_metadata import ROOT, conference_identity, display_abstract_id, normalize_doi, same_work, write_cache


def merge(orcid, scholar, additional=None):
    works = []
    for name, data in (("ORCID", orcid), ("Google Scholar", scholar), ("Conference programme", additional or {})):
        for raw in data.get("works", []):
            work = copy.deepcopy(raw)
            work["doi"] = normalize_doi(work.get("doi"))
            source_url = work.get("scholar_url") if name == "Google Scholar" else work.get("orcid_url")
            # An explicit empty source URL denotes a personal record with no
            # public page; do not attribute it to another meeting's profile.
            if "source_url" in work:
                source_url = work["source_url"]
            else:
                source_url = source_url or data.get("profile_url") or work.get("url", "")
            source = {"name": work.get("source_name", name), "url": source_url or ""}
            if work["category"] == "conferences":
                meeting, abstract = conference_identity(work)
                # Conference years come from identifiers, not abstract deposit dates.
                if meeting.startswith(("egu:", "ems:", "agu:", "juliacon:")):
                    organisation, year = meeting.split(":")
                    organisation_label = "JuliaCon" if organisation == "juliacon" else organisation.upper()
                    work["venue"] = f"{organisation_label} {year}"
                    if work["year"] != year:
                        work["sort_date"] = year + "-00-00"
                    work["year"] = year
                if abstract:
                    work["abstract_id"] = display_abstract_id(meeting, abstract)
            duplicate = next((item for item in works if same_work(item, work)), None)
            if duplicate:
                if source not in duplicate["sources"]:
                    duplicate["sources"].append(source)
                # Scholar supplies author order absent from ORCID's works summary.
                for key in ("doi", "abstract_id", "authors"):
                    if not duplicate.get(key) and work.get(key):
                        duplicate[key] = work[key]
                if not duplicate.get("url") and work.get("url"):
                    duplicate["url"] = work["url"]
            else:
                work["sources"] = [source]
                works.append(work)
    works.sort(key=lambda work: (work["sort_date"], work["title"]), reverse=True)
    return {
        "profile_url": orcid["profile_url"], "scholar_url": scholar.get("profile_url", ""),
        "categories": orcid["categories"], "works": works,
    }


def main():
    orcid = json.loads((ROOT / "_data/orcid_publications.json").read_text())
    scholar_path = ROOT / "_data/scholar_publications.json"
    scholar = json.loads(scholar_path.read_text()) if scholar_path.exists() else {"works": []}
    additional_path = ROOT / "_data/additional_publications.json"
    additional = json.loads(additional_path.read_text()) if additional_path.exists() else {"works": []}
    data = merge(orcid, scholar, additional)
    write_cache(ROOT / "_data/publications.json", data)
    print(f"Merged {len(orcid['works'])} ORCID works, {len(scholar['works'])} Scholar conferences and {len(additional['works'])} additional records into {len(data['works'])} unique entries")


if __name__ == "__main__":
    main()
