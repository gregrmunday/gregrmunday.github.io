"""Checks for duplicate matching and safe parsing of source metadata."""

import unittest

from merge_publications import merge
from publication_metadata import normalize_doi, same_work
from sync_scholar import parse_profile


def conference(**changes):
    work = {
        "title": "A climate model", "category": "conferences", "year": "2026",
        "sort_date": "2026-03-01", "venue": "EGU 2026", "doi": "", "url": "",
    }
    work.update(changes)
    return work


class PublicationTests(unittest.TestCase):
    def test_doi_resolver_variants(self):
        variants = ["10.5194/EGUSPHERE-EGU26-4851", "doi:10.5194/egusphere-egu26-4851",
                    "https://doi.org/10.5194/egusphere-egu26-4851?utm_source=test",
                    "https://dx.doi.org/10.5194%2Fegusphere-egu26-4851",
                    "doi.org/10.5194/egusphere-egu26-4851"]
        self.assertEqual({normalize_doi(value) for value in variants}, {"10.5194/egusphere-egu26-4851"})

    def test_doi_matches_despite_title_edits(self):
        self.assertTrue(same_work(conference(doi="10.1234/example"), conference(title="Revised title", doi="https://doi.org/10.1234/EXAMPLE")))

    def test_distinct_dois_preserve_versions(self):
        self.assertFalse(same_work(conference(doi="10.1234/preprint"), conference(doi="10.1234/published")))

    def test_abstract_id_fallback(self):
        first = conference(doi="10.5194/egusphere-egu26-4851")
        second = conference(title="Updated abstract title", abstract_id="EGU26-4851")
        self.assertTrue(same_work(first, second))

    def test_different_abstracts_stay_separate(self):
        self.assertFalse(same_work(conference(abstract_id="EGU26-1"), conference(abstract_id="EGU26-2")))

    def test_title_fallback_ignores_punctuation(self):
        self.assertTrue(same_work(conference(title="Sea-level projections – the SLEIP project"), conference(title="Sea level projections-the SLEIP project.")))

    def test_same_title_different_conferences_stay_separate(self):
        self.assertFalse(same_work(conference(), conference(venue="AGU 2026")))
        self.assertFalse(same_work(conference(), conference(venue="EGU 2025", year="2025")))

    def test_merge_retains_provenance_and_corrects_conference_year(self):
        orcid = {"profile_url": "https://orcid.org/example", "categories": [], "works": [
            conference(year="2025", doi="10.5194/egusphere-egu24-9046")
        ]}
        scholar = {"profile_url": "https://scholar.google.com/example", "works": [
            conference(year="2024", venue="EGU24", abstract_id="EGU24-9046")
        ]}
        works = merge(orcid, scholar)["works"]
        self.assertEqual(len(works), 1)
        self.assertEqual(works[0]["year"], "2024")
        self.assertEqual(works[0]["abstract_id"], "EGU24-9046")
        self.assertEqual([source["name"] for source in works[0]["sources"]], ["ORCID", "Google Scholar"])

    def test_blocked_scholar_response_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_profile("<html><body>Too many requests</body></html>", "https://scholar.google.com/citations?user=test")


if __name__ == "__main__":
    unittest.main()
