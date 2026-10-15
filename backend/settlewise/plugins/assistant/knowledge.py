"""Reviewed-source retrieval and guardrails for the AI Settlement Assistant."""

import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

SOURCES_FILE = Path(__file__).parent / "sources.yaml"
_WORD = re.compile(r"[a-z0-9']+")
_STOP = set(
    "a an and are as at be by can do does for from how i if in is it me my of on or so that the this "
    "to was what when where which who will with you your should need do i".split()
)

# 3.4 Refer to Professional - questions that need case-specific legal or immigration
# judgement. SettleWise explains general steps but never answers these itself.
PROFESSIONAL_PATTERNS = [
    r"\bam i eligible\b",
    r"\bis my (?:application|case)\b",
    r"\bwill (?:my|i) (?:application|be approved|get)\b",
    r"\bchances?\b.*\b(?:approv|accept|refus)",
    r"\b(?:appeal|judicial review)\b",
    r"\brefus(?:al|ed)\b",
    r"\binadmissib",
    r"\bdeport",
    r"\bremoval order\b",
    r"\bmisrepresent",
    r"\bcriminal (?:record|charge)",
    r"\blose my (?:pr|status)\b",
    r"\bshould i (?:apply|sponsor|claim)\b",
    r"\bsponsor(?:ship)? (?:my|for)\b",
    r"\bcan i stay\b",
    r"\bout of status\b",
    r"\brestor(?:e|ation) (?:my )?status\b",
    r"\blegal advice\b",
    r"\bsue\b",
    r"\blawsuit\b",
    r"\btribunal\b",
]
_PRO = [re.compile(p) for p in PROFESSIONAL_PATTERNS]


def tokenize(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP]


@lru_cache
def load_sources() -> list[dict[str, Any]]:
    return yaml.safe_load(SOURCES_FILE.read_text())


@lru_cache
def _index():
    docs = []
    for s in load_sources():
        text = " ".join([s["title"], s["title"], " ".join(s.get("tags", [])) * 2, s.get("summary", "")])
        docs.append(Counter(tokenize(text)))
    df = Counter(term for doc in docs for term in doc)
    avg = sum(sum(d.values()) for d in docs) / max(len(docs), 1)
    return docs, df, avg


def search(query: str, k: int = 4) -> list[tuple[dict[str, Any], float]]:
    """BM25 over title, tags and summary. Small, dependency-free and good enough for a
    curated knowledge base of reviewed pages."""
    docs, df, avg = _index()
    n = len(docs)
    terms = tokenize(query)
    scored = []
    for source, doc in zip(load_sources(), docs, strict=True):
        length = sum(doc.values())
        score = 0.0
        for t in terms:
            if t not in doc:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            tf = doc[t]
            score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / avg))
        if score > 0:
            scored.append((source, score))
    scored.sort(key=lambda p: p[1], reverse=True)
    return scored[:k]


def needs_professional(question: str) -> str | None:
    q = question.lower()
    for pattern in _PRO:
        if pattern.search(q):
            return (
                "This depends on the details of your own case. A licensed immigration consultant or "
                "lawyer can give advice; SettleWise can only share general information."
            )
    return None


def source_by_id(source_id: str) -> dict[str, Any] | None:
    return next((s for s in load_sources() if s["id"] == source_id), None)
