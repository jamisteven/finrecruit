#!/usr/bin/env python3
"""
Train the job-post gate from classifier_log and export weights for lib/gate.ts.

    pip install -r scripts/gate/requirements.txt
    NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/gate/train_gate.py

    # or from a file you exported yourself (one JSON object per line, same columns):
    python3 scripts/gate/train_gate.py --input rows.jsonl

What it does, in order
  1. Pulls every row of classifier_log (or reads --input).
  2. AUDITS the data and refuses to train if there isn't enough signal: too few
     model-rejected negatives, no final decisions, etc. Every refusal says what to do.
  3. Labels each row: positive = a job we would actually show (model said yes, quality
     not 'low', not off-market); negative = everything the model or the rules turned
     down. human_label, when set, overrides the model.
  4. Dedupes by post_url, groups near-identical reposts so they can't leak between
     train and test, splits 70/15/15 by group.
  5. Trains logistic regression on hashed TF-IDF features (features.py), picks C on
     the validation split, prunes to the strongest buckets, and re-scores with the
     exact arithmetic lib/gate.ts will use.
  6. Chooses two thresholds on validation: LOW (below it, discard without asking the
     LLM — tuned so we lose <=0.5% of real jobs) and HIGH (above it, certainly a job).
  7. Reports on the untouched test split: overall, per discard-reason category, and
     separately on hand-labelled rows if there are enough of them — that last number
     is the only one that measures accuracy rather than agreement with the LLM.
  8. Writes lib/gate-weights.json and scripts/gate/parity.json.

Nothing is switched on by writing weights. GATE_MODE in Vercel controls that.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(Path(__file__).parent))
import features as F  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WEIGHTS_OUT = ROOT / 'lib' / 'gate-weights.json'
PARITY_OUT = Path(__file__).parent / 'parity.json'

MIN_MODEL_NEGATIVES = 1500      # rows the LLM itself rejected (not rules, not backfill stubs)
MIN_POSITIVES = 1500
MIN_HUMAN_FOR_REPORT = 100
MAX_POS_LOSS = 0.005            # LOW threshold: lose at most 0.5% of real jobs
MIN_HIGH_PRECISION = 0.98
PRUNE_TO = 80_000               # buckets kept in the exported model

COLUMNS = ('id,post_url,pipeline,model,is_job,quality,decision,reason,human_label,'
           'raw_text,author_headline,author_linkedin_url,created_at')


# ----------------------------------------------------------------------------- data

def fetch_rows(url: str, key: str) -> list[dict]:
    rows: list[dict] = []
    page = 1000
    offset = 0
    while True:
        q = urllib.parse.urlencode({'select': COLUMNS, 'order': 'id.asc', 'limit': page, 'offset': offset})
        req = urllib.request.Request(f'{url.rstrip("/")}/rest/v1/classifier_log?{q}', headers={
            'apikey': key, 'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as r:
            batch = json.loads(r.read().decode('utf-8'))
        rows.extend(batch)
        print(f'  fetched {len(rows):>7} rows', end='\r', flush=True)
        if len(batch) < page:
            break
        offset += page
    print()
    return rows


def read_jsonl(path: str) -> list[dict]:
    with open(path, encoding='utf-8') as fh:
        return [json.loads(line) for line in fh if line.strip()]


REASON_CATEGORIES: list[tuple[str, re.Pattern]] = [
    ('rule: aggregator', re.compile(r'^prefilter: aggregator', re.I)),
    ('rule: ai-training gig', re.compile(r'^prefilter: ai-training', re.I)),
    ('rule: off-market', re.compile(r'^prefilter:', re.I)),
    ('off-market (post-extraction)', re.compile(r'^(location|country):', re.I)),
    ('roundup', re.compile(r'roundup|several (roles|positions|openings)|multiple (roles|positions|openings)|list of (roles|jobs)', re.I)),
    ('candidate seeking work', re.compile(r'seeking|open to work|looking for (a |my |new )?(job|role|opportunit|position)|job ?seeker|candidate', re.I)),
    ('commentary / article', re.compile(r'thought leadership|article|newsletter|advice|commentary|opinion|insight|recap|digest|story|tips', re.I)),
    ('promo / event', re.compile(r'promo|promotion|marketing|event|conference|webinar|career fair|fair|workshop|course|program', re.I)),
    ('platform funnel', re.compile(r'platform|sign ?up|talent network|job board|community', re.I)),
    ('filled / closed', re.compile(r'filled|closed|no longer|hired', re.I)),
]


def reason_category(reason: str | None, doc: dict | None = None) -> str:
    r = reason or ''
    if doc is not None and doc.get('is_job') and (doc.get('quality') or '') == 'low' and not r:
        return 'rated low quality (never shown)'
    for name, rx in REASON_CATEGORIES:
        if rx.search(r):
            return name
    return 'other' if r else '(no reason)'


def label_row(r: dict) -> int | None:
    """1 = show it, 0 = don't, None = exclude from training."""
    if r.get('human_label') is True:
        return 1
    if r.get('human_label') is False:
        return 0
    reason = r.get('reason') or ''
    if reason.startswith('classifier failed'):
        return None                      # fallback output, not a verdict
    decision = r.get('decision')
    if decision in ('error', 'pending'):
        return None
    if decision in ('prefiltered', 'off-market', 'discarded'):
        return 0
    if not r.get('is_job'):
        return 0
    if (r.get('quality') or '') == 'low':
        return 0                         # real-ish, but never shown — not worth paying for
    return 1


def text_group(text: str) -> str:
    t = re.sub(r'\s+', ' ', (text or '').lower())[:160]
    return hashlib.md5(t.encode('utf-8')).hexdigest()[:12]


def is_truncated_backfill(r: dict) -> bool:
    return '600 chars' in (r.get('model') or '')


# ---------------------------------------------------------------------------- audit

def audit(rows: list[dict], force: bool) -> None:
    print('\n== Data audit ==')
    by_model = Counter(r.get('model') for r in rows)
    by_decision = Counter(r.get('decision') for r in rows)
    print('rows by model:   ', dict(by_model.most_common()))
    print('rows by decision:', dict(by_decision.most_common()))

    labelled = [(r, label_row(r)) for r in rows]
    pos = sum(1 for _, y in labelled if y == 1)
    neg = sum(1 for _, y in labelled if y == 0)
    model_neg = sum(1 for r, y in labelled if y == 0 and not is_truncated_backfill(r)
                    and (r.get('model') or '') != 'prefilter' and not (r.get('reason') or '').startswith('prefilter'))
    stubs = sum(1 for r in rows if is_truncated_backfill(r))
    human = sum(1 for r in rows if r.get('human_label') is not None)
    german = sum(1 for r in rows if re.search(r'\b(wir suchen|gesucht|bewerben|m/w/d|stelle)\b', (r.get('raw_text') or '').lower()))
    failed = sum(1 for r in rows if (r.get('reason') or '').startswith('classifier failed'))
    print(f'positives (would show): {pos:>7}')
    print(f'negatives (all):        {neg:>7}   of which rejected by the LLM itself: {model_neg}')
    print(f'600-char backfill stubs:{stubs:>7}   (included; use --exclude-truncated to drop)')
    print(f'hand-labelled rows:     {human:>7}   (need >= {MIN_HUMAN_FOR_REPORT} for a trustworthy accuracy number)')
    print(f'German-language rows:   {german:>7}')
    print(f'classifier failures:    {failed:>7}   (excluded)')

    problems = []
    if model_neg < MIN_MODEL_NEGATIVES:
        problems.append(f'only {model_neg} LLM-rejected negatives; need {MIN_MODEL_NEGATIVES}. '
                        f'At ~300/day that is about {math.ceil((MIN_MODEL_NEGATIVES - model_neg) / 300)} more days of logging.')
    if pos < MIN_POSITIVES:
        problems.append(f'only {pos} positives; need {MIN_POSITIVES}.')
    if by_decision.get(None, 0) == len(rows):
        problems.append('no row has a decision; run the decision migration in supabase/2026-10-18-classifier-log.sql.')
    if human < MIN_HUMAN_FOR_REPORT:
        print(f'\nNOTE: with {human} hand-labelled rows the metrics below measure AGREEMENT WITH THE LLM, not accuracy.')
        print('      Label a sample with:\n' + SAMPLE_SQL)
    if problems:
        print('\nNOT ENOUGH SIGNAL TO TRAIN:')
        for p in problems:
            print('  -', p)
        if not force:
            print('\nRe-run with --force to train anyway (weights will be unreliable).')
            sys.exit(2)


SAMPLE_SQL = """
      -- 60 rows the model was least sure about, for hand review
      select id, is_job, quality, reason, left(raw_text, 300) as post, post_url
      from classifier_log
      where human_label is null and model not in ('prefilter') and model not like '%backfill%'
      order by random() limit 60;
      -- then: update classifier_log set human_label = false, human_note = 'why' where id = ...;
"""


# ----------------------------------------------------------------------------- train

def build_matrix(docs: list[dict], idf: dict[int, float] | None):
    """Returns (csr_matrix, idf). When idf is None it is fitted on these docs."""
    counts_per_doc = [F.hashed_counts(F.feature_strings(
        d['raw_text'] or '', d.get('author_headline'), d.get('author_linkedin_url'), d.get('post_url'))) for d in docs]
    if idf is None:
        df: Counter = Counter()
        for c in counts_per_doc:
            df.update(c.keys())
        n = len(docs)
        idf = {b: math.log((1 + n) / (1 + k)) + 1.0 for b, k in df.items() if k >= 2}
    indptr = [0]
    indices: list[int] = []
    data: list[float] = []
    for c in counts_per_doc:
        nnz = len(c)
        norm = math.sqrt(nnz) if nnz else 1.0
        for b, k in c.items():
            w = idf.get(b)
            if w is None:
                continue
            indices.append(b)
            data.append((1.0 + math.log(k)) * w / norm)
        indptr.append(len(indices))
    X = csr_matrix((np.array(data, dtype=np.float64), np.array(indices, dtype=np.int64), np.array(indptr, dtype=np.int64)),
                   shape=(len(docs), F.N_BUCKETS))
    return X, idf


def score_with(weights: dict[int, float], bias: float, idf: dict[int, float], docs: list[dict]) -> np.ndarray:
    """Scores through the exact path lib/gate.ts uses (pruned sparse weights)."""
    out = np.zeros(len(docs))
    for i, d in enumerate(docs):
        vec = F.vector(d['raw_text'] or '', d.get('author_headline'), d.get('author_linkedin_url'), d.get('post_url'), idf)
        out[i] = F.score(vec, weights, bias)
    return out


def pick_thresholds(p: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    pos = np.sort(p[y == 1])
    # LOW: the largest cut that still keeps >= (1 - MAX_POS_LOSS) of positives above it
    k = int(math.floor(MAX_POS_LOSS * len(pos)))
    low = float(pos[k]) if len(pos) else 0.0
    low = max(0.0, min(low, 0.5)) - 1e-9
    # HIGH: smallest cut with precision >= MIN_HIGH_PRECISION
    order = np.argsort(-p)
    tp = np.cumsum(y[order] == 1)
    n = np.arange(1, len(p) + 1)
    prec = tp / n
    high = 1.0
    for i in range(len(p) - 1, -1, -1):
        if prec[i] >= MIN_HIGH_PRECISION:
            high = float(p[order[i]])
            break
    high = max(high, low + 0.05)
    return round(low, 4), round(high, 4)


def report(name: str, p: np.ndarray, y: np.ndarray, low: float, high: float, docs: list[dict] | None = None) -> dict:
    n = len(y)
    pos = int((y == 1).sum()); neg = n - pos
    below = p < low; above = p >= high
    lost_pos = int((below & (y == 1)).sum())
    caught_neg = int((below & (y == 0)).sum())
    fp_high = int((above & (y == 0)).sum())
    auc = _auc(p, y)
    acc = float(((p >= 0.5) == (y == 1)).mean()) if n else float('nan')
    m = {
        'n': n, 'positives': pos, 'negatives': neg, 'auc': round(auc, 4), 'acc@0.5': round(acc, 4),
        'below_low': {'share_of_all': round(float(below.mean()), 4), 'real_jobs_lost': lost_pos,
                      'real_jobs_lost_pct': round(100.0 * lost_pos / max(pos, 1), 2),
                      'negatives_caught_pct': round(100.0 * caught_neg / max(neg, 1), 1)},
        'above_high': {'share_of_all': round(float(above.mean()), 4), 'false_positives': fp_high,
                       'precision': round(float((above & (y == 1)).sum() / max(above.sum(), 1)), 4)},
    }
    print(f'\n-- {name}: n={n} (+{pos} / -{neg})  AUC={auc:.4f}  acc@0.5={acc:.4f}')
    print(f'   below LOW={low}:  {100*below.mean():.1f}% of posts  ->  {caught_neg}/{neg} negatives caught '
          f'({m["below_low"]["negatives_caught_pct"]}%), {lost_pos}/{pos} real jobs lost ({m["below_low"]["real_jobs_lost_pct"]}%)')
    print(f'   above HIGH={high}: {100*above.mean():.1f}% of posts  ->  precision {m["above_high"]["precision"]:.4f} ({fp_high} false positives)')
    if docs is not None:
        cats: dict[str, list[int]] = defaultdict(list)
        for i, d in enumerate(docs):
            if y[i] == 0:
                cats[reason_category(d.get('reason'), d)].append(i)
        print('   negatives caught below LOW, by why they were rejected:')
        rows = []
        for cat, idx in sorted(cats.items(), key=lambda kv: -len(kv[1])):
            idx_a = np.array(idx)
            caught = int((p[idx_a] < low).sum())
            rows.append((cat, len(idx), caught))
            print(f'     {cat:<30} {caught:>5}/{len(idx):<5} ({100*caught/len(idx):.0f}%)')
        m['by_reason'] = rows
        worst = np.argsort(p)[:12]
        print('   lowest-scoring REAL jobs (the ones LOW would wrongly discard — read these):')
        shown = 0
        for i in worst:
            if y[i] == 1 and p[i] < low:
                print(f'     p={p[i]:.3f}  {re.sub(r"\\s+", " ", (docs[i]["raw_text"] or ""))[:110]}')
                shown += 1
        if not shown:
            print('     (none below LOW)')
    return m


def _auc(p: np.ndarray, y: np.ndarray) -> float:
    pos = p[y == 1]; neg = p[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float('nan')
    order = np.argsort(np.concatenate([pos, neg]))
    ranks = np.empty(len(order)); ranks[order] = np.arange(1, len(order) + 1)
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', help='JSONL export of classifier_log instead of pulling from Supabase')
    ap.add_argument('--exclude-truncated', action='store_true', help='drop the 600-char backfill negatives')
    ap.add_argument('--force', action='store_true', help='train even if the audit says there is not enough data')
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args()

    t0 = time.time()
    if args.input:
        rows = read_jsonl(args.input)
    else:
        url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL'); key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        if not url or not key:
            sys.exit('set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --input rows.jsonl)')
        print('Pulling classifier_log …')
        rows = fetch_rows(url, key)
    print(f'{len(rows)} rows')

    audit(rows, args.force)

    # label, dedupe by post_url (latest wins), optional stub exclusion
    latest: dict[str, dict] = {}
    for r in rows:
        if args.exclude_truncated and is_truncated_backfill(r):
            continue
        y = label_row(r)
        if y is None or not (r.get('raw_text') or '').strip():
            continue
        r = dict(r, y=y)
        prev = latest.get(r['post_url'])
        if prev is None or (r.get('created_at') or '') >= (prev.get('created_at') or ''):
            latest[r['post_url']] = r
    docs = list(latest.values())
    y_all = np.array([d['y'] for d in docs])
    print(f'\n{len(docs)} unique posts after dedupe: +{int(y_all.sum())} / -{int((1 - y_all).sum())}')

    # grouped split so reposts of the same text never straddle train/test
    rng = np.random.default_rng(args.seed)
    groups = sorted({text_group(d['raw_text']) for d in docs})
    rng.shuffle(groups)
    n_tr = int(0.70 * len(groups)); n_va = int(0.15 * len(groups))
    split_of = {g: ('train' if i < n_tr else 'val' if i < n_tr + n_va else 'test') for i, g in enumerate(groups)}
    parts: dict[str, list[dict]] = defaultdict(list)
    for d in docs:
        parts[split_of[text_group(d['raw_text'])]].append(d)
    tr, va, te = parts['train'], parts['val'], parts['test']
    ytr = np.array([d['y'] for d in tr]); yva = np.array([d['y'] for d in va]); yte = np.array([d['y'] for d in te])
    print(f'split: train {len(tr)}  val {len(va)}  test {len(te)}  ({len(groups)} text groups)')

    print('\nFeaturising …')
    Xtr, idf = build_matrix(tr, None)
    Xva, _ = build_matrix(va, idf)
    print(f'  {Xtr.nnz:,} nonzeros, {len(idf):,} buckets with df>=2')

    best = None
    for C in (0.3, 1.0, 3.0, 10.0):
        clf = LogisticRegression(C=C, class_weight='balanced', solver='liblinear', max_iter=2000)
        clf.fit(Xtr, ytr)
        pva = clf.predict_proba(Xva)[:, 1]
        auc = _auc(pva, yva)
        print(f'  C={C:<5} val AUC={auc:.4f}')
        if best is None or auc > best[0]:
            best = (auc, C, clf)
    auc, C, clf = best
    print(f'using C={C}')

    # prune to the strongest buckets and re-score through the exported path
    coef = clf.coef_[0]
    nz = np.flatnonzero(coef)
    keep = nz[np.argsort(-np.abs(coef[nz]))[:PRUNE_TO]]
    weights = {int(b): float(coef[b]) for b in keep}
    bias = float(clf.intercept_[0])
    idf_kept = {b: idf[b] for b in weights if b in idf}
    print(f'pruned {len(nz):,} -> {len(weights):,} buckets')

    pva = score_with(weights, bias, idf_kept, va)
    low, high = pick_thresholds(pva, yva)
    print(f'\nthresholds from validation: LOW={low}  HIGH={high}')
    report('validation (pruned model)', pva, yva, low, high)

    pte = score_with(weights, bias, idf_kept, te)
    test_metrics = report('TEST (never seen)', pte, yte, low, high, te)

    human_idx = [i for i, d in enumerate(te) if d.get('human_label') is not None]
    human_metrics = None
    if len(human_idx) >= MIN_HUMAN_FOR_REPORT:
        hi = np.array(human_idx)
        human_metrics = report('TEST, hand-labelled rows only (this is the real accuracy)', pte[hi], yte[hi], low, high)
    else:
        print(f'\n(only {len(human_idx)} hand-labelled rows in the test split; no accuracy number yet)')

    # export
    idx = sorted(weights)
    out = {
        'version': FEATURIZER_VERSION_TAG(),
        'featurizer': F.FEATURIZER_VERSION,
        'n_buckets': F.N_BUCKETS,
        'trained_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'train_rows': len(tr), 'val_rows': len(va), 'test_rows': len(te),
        'thresholds': {'low': low, 'high': high},
        'metrics': {'test': test_metrics, 'test_human': human_metrics},
        'bias': bias,
        'idx': idx,
        'idf': [round(idf_kept.get(b, 0.0), 6) for b in idx],
        'w': [round(weights[b], 6) for b in idx],
    }
    WEIGHTS_OUT.write_text(json.dumps(out, separators=(',', ':')))
    print(f'\nwrote {WEIGHTS_OUT}  ({WEIGHTS_OUT.stat().st_size/1e6:.1f} MB)')

    sample = (te[:6] + va[:4]) if te else va[:10]
    parity = [{
        'text': d['raw_text'], 'author_headline': d.get('author_headline'),
        'author_linkedin_url': d.get('author_linkedin_url'), 'post_url': d.get('post_url'),
        'expected': float(score_with(weights, bias, idf_kept, [d])[0]),
    } for d in sample]
    PARITY_OUT.write_text(json.dumps(parity, indent=1))
    print(f'wrote {PARITY_OUT}  -> run: npx tsx scripts/gate/check_parity.ts')
    print(f'\ndone in {time.time()-t0:.0f}s. Nothing is live: set GATE_MODE=shadow in Vercel to start scoring without acting.')


def FEATURIZER_VERSION_TAG() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M')


if __name__ == '__main__':
    main()
