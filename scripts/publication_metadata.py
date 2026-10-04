"""Shared identifiers and cache helpers for the publication importers."""

import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


def normalize_doi(doi):
    doi = unquote(doi or "").strip()
    doi = re.sub(r"^doi:\s*", "", doi, flags=re.I)
    resolver = re.match(r"^(?:https?://)?(?:dx\.)?doi\.org/", doi, re.I)
    if resolver:
        doi = doi[resolver.end():].split("?", 1)[0].split("#", 1)[0]
    return doi.lower().rstrip(".")


def doi_from_text(text):
    match = re.search(r"10\.\d{4,9}/[^\s<>\"?&#]+", unquote(text or ""), re.I)
    return normalize_doi(match[0]) if match else ""


def normalized_title(title):
    text = unicodedata.normalize("NFKD", title or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def conference_identity(work):
    """Meeting and abstract identifiers, including those embedded in DOIs."""
    text = " ".join(str(work.get(key) or "") for key in ("doi", "venue", "abstract_id", "url"))
    match = re.search(r"\b(egu|ems)(\d{2}|\d{4})-(\d+)\b", text, re.I)
    if match:
        year = match[2] if len(match[2]) == 4 else "20" + match[2]
        return f"{match[1].lower()}:{year}", match[3]
    match = re.search(r"\b(egu|ems)\s*(\d{2}|\d{4})\b", text, re.I)
    if match:
        year = match[2] if len(match[2]) == 4 else "20" + match[2]
        return f"{match[1].lower()}:{year}", ""
    # EGU's older venue label spells out the organisation name.
    if re.search(r"European Geosciences Union|EGU General Assembly", text, re.I):
        return f"egu:{work['year']}", ""
    if re.search(r"AGU|American Geophysical Union", text, re.I):
        match = re.search(r"\b([A-Z]{1,3}\d{2}[A-Z]-\d{2,4})\b", text)
        return f"agu:{work['year']}", match[1] if match else ""
    return normalized_title(work.get("venue", "")) + ":" + str(work.get("year", "")), ""


def display_abstract_id(meeting, abstract):
    if not abstract:
        return ""
    if meeting.startswith("egu:"):
        return f"EGU{meeting[-2:]}-{abstract}"
    if meeting.startswith("ems:"):
        return f"EMS{meeting.split(':')[1]}-{abstract}"
    return abstract


def same_work(first, second):
    doi_a, doi_b = (normalize_doi(work.get("doi")) for work in (first, second))
    if doi_a and doi_b:
        # Distinct DOI versions remain separate, even when their titles match.
        return doi_a == doi_b
    if first.get("category") != second.get("category"):
        return False
    meeting_a, abstract_a = conference_identity(first)
    meeting_b, abstract_b = conference_identity(second)
    if meeting_a != meeting_b:
        return False
    if abstract_a and abstract_b:
        return abstract_a == abstract_b
    return normalized_title(first["title"]) == normalized_title(second["title"])


def write_cache(path, data):
    """Write atomically, and avoid commits for unchanged content."""
    content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if not path.exists() or path.read_text() != content:
        temporary = path.with_suffix(".tmp")
        temporary.write_text(content)
        temporary.replace(path)
