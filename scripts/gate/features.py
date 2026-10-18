"""
Featurizer for the job-post gate.

This file and lib/gate.ts MUST produce identical features for identical input.
Any change here is a change to the featurizer version: bump FEATURIZER_VERSION,
mirror the change in lib/gate.ts, and re-run check_parity.ts before shipping weights.

Representation
  - text is NFKC-normalised (folds the 𝗯𝗼𝗹𝗱 unicode letters LinkedIn posts love into
    plain ASCII), lower-cased, URLs replaced by a placeholder token.
  - word unigrams + bigrams ("w:", "b:"), character 3/4/5-grams ("c:"),
    author headline tokens ("h:"), author slug tokens ("s:"), and a few bucketed
    meta features ("m:").
  - every feature string is hashed (FNV-1a 32-bit) into N_BUCKETS buckets, so no
    vocabulary needs to ship — only the weight of each bucket.
  - value = (1 + ln(count)) * idf[bucket] / sqrt(number of distinct features in doc)
    The sqrt(nnz) norm is deliberate: unlike an L2 norm it can be computed without
    knowing the idf of pruned-away buckets, so the TypeScript side stays exact.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from typing import Iterable

FEATURIZER_VERSION = 'v1'
N_BUCKETS = 1 << 20
MAX_TEXT_CHARS = 3000
MAX_TOKEN_LEN = 30

_URL = re.compile(r'https?://\S+')
_TOKEN = re.compile(r'[^\W_]+')          # letters + digits in any script (== JS [\p{L}\p{N}]+)
_WS = re.compile(r'\s+')
_SLUG = re.compile(r'linkedin\.com/(?:in|company|school)/([^/?#]+)|linkedin\.com/posts/([^_/?#]+)_', re.I)
_FOLLOWERS = re.compile(r'^\s*[\d.,]+\s*followers?\s*$', re.I)


def fnv1a32(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def bucket(feature: str) -> int:
    return fnv1a32(feature) % N_BUCKETS


def _log_bucket(n: int) -> int:
    return 0 if n <= 0 else min(12, int(math.floor(math.log2(n))) + 1)


def _emoji_count(text: str) -> int:
    n = 0
    for ch in text:
        cp = ord(ch)
        if 0x1F300 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF:
            n += 1
    return n


def slug_of(url: str | None) -> str:
    m = _SLUG.search(url or '')
    if not m:
        return ''
    return (m.group(1) or m.group(2) or '').lower()


def feature_strings(text: str, author_headline: str | None, author_url: str | None, post_url: str | None) -> list[str]:
    """Ordered list of feature strings (duplicates allowed; counts matter)."""
    raw = text or ''
    feats: list[str] = []

    # --- meta on the raw text, before normalisation ---
    links = len(_URL.findall(raw))
    hashtags = raw.count('#')
    lines = raw.count('\n')
    feats.append(f'm:len:{_log_bucket(len(raw))}')
    feats.append(f'm:links:{min(links, 5)}')
    feats.append(f'm:tags:{_log_bucket(hashtags)}')
    feats.append(f'm:lines:{_log_bucket(lines)}')
    feats.append(f'm:emoji:{_log_bucket(_emoji_count(raw))}')

    # --- normalised body ---
    t = unicodedata.normalize('NFKC', raw[:MAX_TEXT_CHARS]).lower()
    t = _URL.sub(' urltoken ', t)
    t = _WS.sub(' ', t).strip()

    toks = [w for w in _TOKEN.findall(t) if len(w) <= MAX_TOKEN_LEN]
    feats.extend('w:' + w for w in toks)
    feats.extend('b:' + a + '_' + b for a, b in zip(toks, toks[1:]))

    for n in (3, 4, 5):
        for i in range(0, max(0, len(t) - n + 1)):
            feats.append('c:' + t[i:i + n])

    # --- author ---
    hl = unicodedata.normalize('NFKC', author_headline or '').lower()
    if _FOLLOWERS.match(hl):
        feats.append('m:company_page')
    else:
        feats.extend('h:' + w for w in _TOKEN.findall(hl)[:40])

    slug = slug_of(author_url) or slug_of(post_url)
    if slug:
        feats.extend('s:' + p for p in slug.split('-') if p)

    return feats


def hashed_counts(feats: Iterable[str]) -> Counter:
    c: Counter = Counter()
    for f in feats:
        c[bucket(f)] += 1
    return c


def vector(text: str, author_headline: str | None, author_url: str | None, post_url: str | None,
           idf: dict[int, float]) -> dict[int, float]:
    """Sparse weighted vector {bucket: value}. Buckets missing from idf contribute 0."""
    counts = hashed_counts(feature_strings(text, author_headline, author_url, post_url))
    nnz = len(counts)
    if nnz == 0:
        return {}
    norm = math.sqrt(nnz)
    out: dict[int, float] = {}
    for b, n in counts.items():
        w = idf.get(b)
        if w is None:
            continue
        out[b] = (1.0 + math.log(n)) * w / norm
    return out


def score(vec: dict[int, float], weights: dict[int, float], bias: float) -> float:
    z = bias
    for b, v in vec.items():
        w = weights.get(b)
        if w is not None:
            z += v * w
    return 1.0 / (1.0 + math.exp(-z))
