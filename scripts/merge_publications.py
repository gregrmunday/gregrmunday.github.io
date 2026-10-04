#!/usr/bin/env python3
"""Merge cached ORCID works and Scholar conferences into the website bibliography."""

import copy
import json

from publication_metadata import ROOT, conference_identity, display_abstract_id, normalize_doi, same_work, write_cache


def merge(orcid, scholar):
    works = []
    for name, data in (("ORCID", orcid), ("Google Scholar", scholar)):
        for raw in data.get("works", []):
            work = copy.deepcopy(raw)
            work["doi"] = normalize_doi(work.get("doi"))
            source_url = work.get("scholar_url") if name == "Google Scholar" else work.get("orcid_url")
            source = {"name": name, "url": source_url or data["profile_url"]}
            if work["category"] == "conferences":
                meeting, abstract = conference_identity(work)
                # Conference years come from identifiers, not abstract deposit dates.
                if meeting.startswith(("egu:", "ems:", "agu:")):
                    organisation, year = meeting.split(":")
                    work["venue"] = f"{organisation.upper()} {year}"
                    if work["year"] != year:
                        work["sort_date"] = year + "-00-00"
                    work["year"] = year
                if abstract:
                    work["abstract_id"] = display_abstract_id(meeting, abstract)
            duplicate = next((item for item in works if same_work(item, work)), None)
            if duplicate:
                if source not in duplicate["sources"]:
                    duplicate["sources"].append(source)
                for key in ("doi", "abstract_id"):
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
    data = merge(orcid, scholar)
    write_cache(ROOT / "_data/publications.json", data)
    print(f"Merged {len(orcid['works'])} ORCID works and {len(scholar['works'])} Scholar conferences into {len(data['works'])} unique entries")


if __name__ == "__main__":
    main()
