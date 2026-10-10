#!/usr/bin/env python3
"""Cache conference entries and citation counts from Google Scholar."""

import argparse
import json
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

from publication_metadata import ROOT, conference_identity, display_abstract_id, doi_from_text, same_work, write_cache


class Element:
    """Minimal HTML tree for reading Scholar's public metadata, without libraries."""

    def __init__(self, tag="", attributes=None):
        self.tag = tag
        self.attributes = attributes or {}
        self.children = []

    @property
    def text(self):
        parts = [child if isinstance(child, str) else child.text for child in self.children]
        return re.sub(r"\s+", " ", " ".join(parts)).strip()

    def find_all(self, tag=None, class_name=None, element_id=None):
        result = []
        for child in self.children:
            if not isinstance(child, Element):
                continue
            if (tag is None or child.tag == tag) and (
                class_name is None or class_name in child.attributes.get("class", "").split()
            ) and (element_id is None or child.attributes.get("id") == element_id):
                result.append(child)
            result.extend(child.find_all(tag, class_name, element_id))
        return result


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = Element()
        self.stack = [self.root]
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        element = Element(tag, dict(attributes))
        self.stack[-1].children.append(element)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(element)

    def handle_startendtag(self, tag, attributes):
        self.stack[-1].children.append(Element(tag, dict(attributes)))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def read_html(url):
    request = Request(url, headers={"User-Agent": "AcademicWebsite-Publications/1.0"})
    # No CAPTCHA handling, proxies or repeated retries. A failed run keeps the cache.
    with urlopen(request, timeout=45) as response:
        return response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def read_saved(path):
    raw = path.read_bytes()
    charset = re.search(rb'charset\s*=\s*["\']?([a-zA-Z0-9_-]+)', raw[:16000], re.I)
    return raw.decode(charset[1].decode() if charset else "utf-8", errors="replace")


def parse_profile(text, profile_url):
    tree = Document(text).root
    rows = tree.find_all("tr", class_name="gsc_a_tr")
    if not rows:
        raise ValueError("Scholar did not return a publication table; keeping its previous cache")
    works = []
    for row in rows:
        titles = row.find_all("a", class_name="gsc_a_at")
        metadata = row.find_all("div", class_name="gs_gray")
        years = row.find_all("td", class_name="gsc_a_y")
        if not titles or len(metadata) < 2 or not years:
            raise ValueError("Scholar's publication markup changed; keeping its previous cache")
        title, venue = titles[0].text, metadata[1].text
        # Import conferences only; ORCID remains authoritative for papers/preprints.
        if not re.search(r"\b(?:AGU|EGU|EMS)\b|\b(?:EGU|EMS)\d{2,4}\b|European Geosciences Union|Conference|General Assembly", venue, re.I):
            continue
        year_match = re.search(r"\b\d{4}\b", years[0].text)
        if not year_match:
            raise ValueError(f"Missing year for Scholar conference entry: {title}")
        source = urljoin(profile_url, titles[0].attributes["href"])
        scholar_id = parse_qs(urlparse(source).query).get("citation_for_view", [""])[0]
        work = {
            "scholar_id": scholar_id, "title": title, "authors": metadata[0].text,
            "type": "conference-abstract", "category": "conferences", "label": "Conference abstract",
            "year": year_match[0], "sort_date": year_match[0] + "-00-00",
            "venue": venue, "doi": doi_from_text(venue), "url": source, "scholar_url": source,
        }
        meeting, abstract = conference_identity(work)
        if abstract:
            work["abstract_id"] = display_abstract_id(meeting, abstract)
        works.append(work)
    # Do not silently omit older conference records beyond the first 100 entries.
    next_buttons = tree.find_all("button", element_id="gsc_bpf_next")
    has_more = bool(next_buttons and "disabled" not in next_buttons[0].attributes)
    return works, has_more


def enrich_from_detail(work, text):
    tree = Document(text).root
    links = tree.find_all("a", class_name="gsc_oci_title_link")
    if not links:
        raise ValueError("Scholar detail page unavailable; keeping the entry's existing metadata")
    url = links[0].attributes.get("href", "")
    if urlparse(url).scheme in {"http", "https"}:
        work["url"] = url
    work["doi"] = doi_from_text(url)
    # Copernicus detail links expose the EGU/EMS abstract ID directly.
    meeting, abstract = conference_identity(work)
    if abstract:
        work["abstract_id"] = display_abstract_id(meeting, abstract)
    if not work["doi"]:
        for element in tree.find_all("div", class_name="gsc_oci_value"):
            doi = doi_from_text(element.text)
            if doi:
                work["doi"] = doi
                break


def parse_citations(text, profile_url):
    """Read counts for every profile entry without importing extra publications."""
    rows = Document(text).root.find_all("tr", class_name="gsc_a_tr")
    if not rows:
        raise ValueError("Scholar did not return a publication table; keeping its previous cache")
    citations = []
    for row in rows:
        titles = row.find_all("a", class_name="gsc_a_at")
        cells = row.find_all("td", class_name="gsc_a_c")
        years = row.find_all("td", class_name="gsc_a_y")
        metadata = row.find_all("div", class_name="gs_gray")
        if not titles or not cells or not years or len(metadata) < 2:
            raise ValueError("Scholar's citation markup changed; keeping its previous cache")
        links = cells[0].find_all("a", class_name="gsc_a_ac")
        if not links:
            raise ValueError("Scholar's citation count is unavailable; keeping its previous cache")
        count = links[0].text.replace(",", "")
        if count and not re.fullmatch(r"\d+", count):
            raise ValueError("Invalid Scholar citation count; keeping its previous cache")
        source = urljoin(profile_url, titles[0].attributes["href"])
        year = re.search(r"\b\d{4}\b", years[0].text)
        href = links[0].attributes.get("href", "")
        citations.append({
            "scholar_id": parse_qs(urlparse(source).query).get("citation_for_view", [""])[0],
            "title": titles[0].text, "year": year[0] if year else "",
            "venue": metadata[1].text, "doi": doi_from_text(metadata[1].text),
            "citation_count": int(count or 0),
            "citation_url": urljoin(profile_url, href) if href else source,
        })
    return citations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Import a saved public profile HTML file")
    parser.add_argument("--details-dir", type=Path, help="Read saved detail pages named by Scholar citation ID")
    parser.add_argument("--no-details", action="store_true", help="Use profile metadata and existing cached identifiers")
    args = parser.parse_args()
    config = (ROOT / "_config.yml").read_text()
    match = re.search(r'googlescholar\s*:\s*[\"\']?(https://scholar\.google\.com/citations\?[^\"\'\s]+)', config)
    if not match:
        raise ValueError("Set author.googlescholar in _config.yml")
    profile_url = match[1]
    user = parse_qs(urlparse(profile_url).query)["user"][0]
    fetch_url = "https://scholar.google.com/citations?" + urlencode({"user": user, "hl": "en", "pagesize": 100})
    text = read_saved(args.source) if args.source else read_html(fetch_url)
    works, has_more = parse_profile(text, profile_url)
    citations = parse_citations(text, profile_url)
    offset = 100
    while has_more:
        if args.source:
            raise ValueError("Saved profile is incomplete; export all entries or fetch the profile live")
        time.sleep(1)
        page = fetch_url + "&cstart=" + str(offset)
        page_text = read_html(page)
        more, has_more = parse_profile(page_text, profile_url)
        citations.extend(parse_citations(page_text, profile_url))
        works.extend(more)
        offset += 100
    output = ROOT / "_data/scholar_publications.json"
    cached = json.loads(output.read_text()).get("works", []) if output.exists() else []
    orcid_path = ROOT / "_data/orcid_publications.json"
    orcid = json.loads(orcid_path.read_text()).get("works", []) if orcid_path.exists() else []
    if not works and cached:
        raise ValueError("Scholar returned no conferences; keeping its previous cache")
    for work in works:
        existing = next((item for item in cached if item.get("scholar_id") == work["scholar_id"]), None)
        if existing:
            for key in ("doi", "url", "abstract_id"):
                if existing.get(key):
                    work[key] = existing[key]
        match = next((item for item in orcid if same_work(item, work)), None)
        if match:
            work["doi"] = match.get("doi", "") or work["doi"]
            work["url"] = match.get("url", "") or work["url"]
        elif not existing and not args.no_details:
            try:
                if args.details_dir:
                    detail = read_saved(args.details_dir / (work["scholar_id"].split(":")[-1] + ".html"))
                else:
                    time.sleep(1)
                    detail = read_html(work["scholar_url"])
                enrich_from_detail(work, detail)
            except Exception as error:
                # The complete profile is still usable without a detail-page DOI.
                print(f"Detail metadata unavailable for {work['title']}: {error}")
    works.sort(key=lambda work: (work["sort_date"], work["title"], work["scholar_id"]), reverse=True)
    write_cache(output, {"profile_url": profile_url, "works": works, "citations": citations})
    print(f"Cached {len(works)} Google Scholar conference entries and {len(citations)} citation counts")


if __name__ == "__main__":
    main()
