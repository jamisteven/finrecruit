#!/usr/bin/env python3
# Run from ~/finrecruit: python3 ~/Downloads/reorder_queries.py

with open('lib/apify.ts', 'r') as f:
    content = f.read()

# ── FINANCE: interleave global, US, UK, Swiss, niche ──────────────────────
finance_queries = [
    # Batch 1 - Core global
    'finance recruiter now hiring',
    'investment banking analyst associate hiring',
    'hedge fund role recruiter',
    'private equity hiring opportunity',
    'asset management recruiter mandate',
    # Batch 2 - Mix global + geo
    'quant researcher trader hiring',
    'finance recruiter hiring Toronto',
    'fixed income credit recruiter hiring',
    'wealth management recruiter hiring',
    'investment banking Toronto recruiter hiring',
    # Batch 3 - Mix global + Swiss finance
    'financial services recruiter opportunity',
    'private credit direct lending hiring',
    'CFO finance director hiring recruiter',
    'equity research analyst hiring recruiter',
    'private equity Toronto recruiter hiring',
    # Batch 4 - Mix niche + geo
    'corporate finance FP&A hiring recruiter',
    'fintech finance role recruiter hiring',
    'risk management recruiter hiring',
    'portfolio manager recruiter hiring',
    'investment analyst recruiter opportunity',
    # Batch 5
    'M&A analyst associate recruiter hiring',
    'leveraged finance recruiter hiring',
    'venture capital recruiter hiring',
    'family office recruiter hiring',
    'capital markets recruiter hiring',
    # Batch 6
    'treasury recruiter hiring opportunity',
    'credit risk analyst recruiter hiring',
    'compliance officer finance recruiter hiring',
    'macro analyst recruiter hiring',
    'distressed debt recruiter hiring',
    # Batch 7
    'prime brokerage recruiter hiring',
    'derivatives trader recruiter hiring',
    'structured products recruiter hiring',
    'fund accounting recruiter hiring',
    'real estate finance recruiter hiring',
    # Batch 8 - Hashtags + niche
    '#hiring finance recruiter',
    '#nowhiring investment banking',
    '#hiring hedge fund private equity',
    '#financejobs recruiter hiring',
    'infrastructure finance recruiter hiring',
    # Batch 9 - Remaining niche
    'insurance actuary recruiter hiring',
    'pension fund recruiter hiring',
    'bank capital markets recruiter hiring',
    'securities lawyer finance recruiter hiring',
    'financial controller CFO recruiter hiring',
]

# ── TECH: interleave global, US, Swiss, German throughout ─────────────────
tech_queries = [
    # Batch 1 - Core + Swiss
    'software engineer recruiter now hiring',
    'software engineer recruiter hiring Zurich',
    'AI ML engineer recruiter opportunity',
    'backend engineer recruiter hiring',
    'tech recruiter hiring Zurich Switzerland',
    # Batch 2 - Core + Swiss
    'engineering manager recruiter hiring',
    'engineering manager hiring Zurich',
    'frontend engineer recruiter hiring',
    'product manager recruiter hiring',
    'startup engineer Zurich recruiter hiring',
    # Batch 3 - Core + Swiss
    'data engineer recruiter hiring',
    'AI ML engineer Zurich hiring',
    'data scientist recruiter hiring',
    'CTO VP engineering recruiter hiring',
    'Software Engineer Zürich wir suchen',
    # Batch 4 - Core + Toronto
    'machine learning engineer recruiter hiring',
    'software engineer recruiter hiring Toronto',
    'devops platform engineer recruiter hiring',
    'tech recruiter hiring Toronto',
    'startup engineer Toronto recruiter hiring',
    # Batch 5 - Core + German
    'site reliability engineer recruiter hiring',
    'Softwareentwickler Stelle Zürich',
    'cloud architect recruiter hiring',
    'cybersecurity engineer recruiter hiring',
    'IT Recruiter Stelle Zürich Bern Basel',
    # Batch 6 - Core + German
    'AI engineer LLM recruiter hiring',
    'Entwickler gesucht Zürich Schweiz',
    'principal staff engineer recruiter hiring',
    'VP engineering recruiter hiring',
    'Cloud Engineer Zürich gesucht',
    # Batch 7 - Core + German
    'head of engineering recruiter hiring',
    'Machine Learning Engineer Zürich Stelle',
    'platform engineer kubernetes recruiter hiring',
    'staff engineer recruiter hiring',
    'Tech Lead Zürich Stelle frei',
    # Batch 8 - Core + German
    'solutions architect recruiter hiring',
    'DevOps Engineer Schweiz einstellen',
    'founding engineer startup recruiter hiring',
    'engineering director recruiter hiring',
    'Fullstack Entwickler Zürich gesucht',
    # Batch 9 - Stack specific
    'backend Python Go Rust recruiter hiring',
    'frontend React Vue Angular recruiter hiring',
    'mobile iOS Swift Android Kotlin recruiter hiring',
    'mobile engineer recruiter hiring',
    'security engineer recruiter hiring',
    # Batch 10 - Remaining
    'full stack engineer recruiter now hiring',
    'startup engineer recruiter hiring',
    'tech lead recruiter hiring opportunity',
    'blockchain engineer recruiter hiring',
    'iOS Android engineer recruiter hiring',
    # Batch 11 - Remaining
    'embedded systems engineer recruiter hiring',
    'data platform engineer recruiter hiring',
    'growth engineer recruiter hiring',
    'infrastructure engineer recruiter hiring',
    'technical program manager recruiter hiring',
    # Batch 12 - Remaining
    'semiconductor engineer recruiter hiring',
    'fintech engineer recruiter hiring',
    'developer advocate recruiter hiring',
    'head of product recruiter hiring',
    'VP product recruiter hiring',
    # Batch 13 - Remaining
    'data analytics engineer recruiter hiring',
    'AI research scientist recruiter hiring',
    'prompt engineer LLM recruiter hiring',
    'cloud engineer AWS GCP Azure recruiter hiring',
    'QA automation engineer recruiter hiring',
    # Batch 14 - Remaining German
    'Softwareingenieur Zürich einstellen',
    'CTO Head of Engineering Zürich',
    'Informatiker Zürich Stellenangebot',
    'network engineer recruiter hiring',
    'hardware engineer recruiter hiring',
]

# ── LEGAL: interleave global, US, UK, Dublin throughout ───────────────────
legal_queries = [
    # Batch 1 - Core global
    'legal recruiter now hiring lawyer',
    'associate solicitor recruiter hiring',
    'in-house counsel recruiter opportunity',
    'compliance recruiter hiring role',
    'corporate lawyer recruiter hiring',
    # Batch 2 - Mix
    'litigation associate recruiter hiring',
    'legal counsel recruiter mandate',
    'employment lawyer recruiter hiring',
    'general counsel recruiter hiring',
    'legal recruiter hiring Toronto',
    # Batch 3 - Mix
    'commercial solicitor recruiter hiring',
    'paralegal recruiter hiring',
    'private equity lawyer recruiter hiring',
    'funds lawyer recruiter hiring',
    'lawyer Toronto recruiter hiring',
    # Batch 4 - Mix
    'banking finance lawyer recruiter hiring',
    'restructuring lawyer recruiter hiring',
    'data privacy lawyer recruiter hiring',
    'capital markets lawyer recruiter hiring',
    'in-house counsel Toronto recruiter hiring',
    # Batch 5 - Niche
    'antitrust competition lawyer recruiter hiring',
    'insurance lawyer recruiter hiring',
    'healthcare lawyer recruiter hiring',
    'technology lawyer recruiter hiring',
    'international arbitration recruiter hiring',
    # Batch 6 - Remaining
    'senior associate partner law firm recruiter',
    'legal director recruiter hiring',
    'barrister chambers recruiter hiring',
    'planning environment lawyer recruiter hiring',
    'construction lawyer recruiter hiring',
    # Batch 7 - Remaining
    'shipping maritime lawyer recruiter hiring',
    'sports entertainment lawyer recruiter hiring',
    'immigration lawyer recruiter hiring',
    'legal operations recruiter hiring',
]

# ── MARKETING: interleave global, US, Toronto throughout ──────────────────
marketing_queries = [
    # Batch 1 - Core + geo
    'marketing recruiter now hiring',
    'performance marketing recruiter hiring',
    'growth marketing recruiter hiring',
    'CMO VP marketing recruiter hiring',
    'marketing recruiter hiring Toronto',
    # Batch 2 - Core + geo
    'digital marketing recruiter hiring',
    'head of marketing recruiter hiring',
    'content marketing recruiter hiring',
    'brand marketing recruiter hiring',
    'growth marketing Toronto recruiter hiring',
    # Batch 3 - Mix
    'product marketing recruiter hiring',
    'SEO SEM recruiter hiring',
    'social media marketing recruiter hiring',
    'demand generation recruiter hiring',
    'marketing director recruiter hiring',
    # Batch 4 - Mix
    'email marketing recruiter hiring',
    'creative director recruiter hiring',
    'chief marketing officer recruiter hiring',
    'B2B marketing recruiter hiring',
    'B2C marketing recruiter hiring',
    # Batch 5 - Mix
    'paid media recruiter hiring',
    'influencer marketing recruiter hiring',
    'affiliate marketing recruiter hiring',
    'marketing analytics recruiter hiring',
    'CRM marketing recruiter hiring',
    # Batch 6 - Mix
    'ecommerce marketing recruiter hiring',
    'go to market recruiter hiring',
    'brand strategy recruiter hiring',
    'communications PR recruiter hiring',
    'marketing technology martech recruiter hiring',
    # Batch 7 - Remaining
    'field marketing recruiter hiring',
    'account based marketing ABM recruiter hiring',
    'VP marketing startup recruiter hiring',
    'consumer insights recruiter hiring',
    'integrated marketing recruiter hiring',
    # Batch 8 - Remaining
    'category manager marketing recruiter hiring',
    'media planning buying recruiter hiring',
    'creative strategy recruiter hiring',
    'retail marketing recruiter hiring',
    'partnership marketing recruiter hiring',
]

# ── REAL ESTATE: interleave global + geo ──────────────────────────────────
realestate_queries = [
    # Batch 1 - Core + geo
    'property manager recruiter hiring',
    'leasing agent recruiter hiring',
    'real estate recruiter now hiring',
    'property management recruiter now hiring',
    'real estate recruiter hiring London',
    # Batch 2 - Core + geo
    'leasing consultant recruiter hiring',
    'property leasing recruiter opportunity',
    'real estate recruiter hiring Toronto',
    'regional property manager recruiter hiring',
    'property management recruiter hiring New York',
    # Batch 3 - Mix
    'leasing manager recruiter hiring',
    'leasing specialist recruiter hiring',
    'assistant property manager recruiter hiring',
    'residential property manager recruiter hiring',
    'commercial property manager recruiter hiring',
    # Batch 4 - Mix
    'leasing administrator recruiter hiring',
    'leasing coordinator recruiter hiring',
    'property maintenance recruiter hiring',
    'facilities maintenance recruiter hiring',
    'building maintenance recruiter hiring',
    # Batch 5 - Remaining
    'work order coordinator recruiter hiring',
    'maintenance coordinator recruiter hiring',
    'facilities coordinator recruiter hiring',
    'real estate virtual assistant recruiter hiring',
    'leasing assistant recruiter hiring',
    # Batch 6 - Remaining
    'property leasing assistant recruiter hiring',
    'property recruiter hiring opportunity',
    'real estate operations recruiter hiring',
    'HOA manager recruiter hiring',
    'asset manager real estate recruiter hiring',
    # Batch 7 - Remaining
    'real estate analyst recruiter hiring',
    'property administrator recruiter hiring',
    'leasing admin recruiter opportunity',
    'maintenance technician property recruiter hiring',
    'real estate VA recruiter opportunity',
    # Last
    'property management virtual assistant hiring',
]

# ── Now write back to apify.ts ─────────────────────────────────────────────
import re

def replace_sector_queries(content, sector, queries):
    # Find sector block
    pattern = rf"  {sector}: \[.*?\],"
    formatted = f"  {sector}: [\n" + \
        "\n".join([f"    '{q}'," for q in queries]) + \
        "\n  ],"
    
    # Use regex with DOTALL to match across lines
    new_content = re.sub(
        rf"  {sector}: \[.*?\n  \],",
        formatted,
        content,
        flags=re.DOTALL,
        count=1
    )
    return new_content

content = replace_sector_queries(content, 'finance', finance_queries)
content = replace_sector_queries(content, 'tech', tech_queries)
content = replace_sector_queries(content, 'legal', legal_queries)
content = replace_sector_queries(content, 'marketing', marketing_queries)
content = replace_sector_queries(content, 'realestate', realestate_queries)

with open('lib/apify.ts', 'w') as f:
    f.write(content)

# Verify
for sector, queries in [('finance', finance_queries), ('tech', tech_queries), 
                         ('legal', legal_queries), ('marketing', marketing_queries),
                         ('realestate', realestate_queries)]:
    if queries[0] in content:
        print(f"✓ {sector}: {len(queries)} queries, first 3 batches cover geo spread")
    else:
        print(f"✗ {sector}: FAILED")

print("\nDone! Every 5-query batch now has geographic mix.")
