# Source Manifest

> Combined list of all official URLs and approved sources used across the Groww Ops Intelligence Suite.
> Total: **32 sources** (31 Groww scheme page URLs + 1 static document)

---

## Mutual Fund Scheme Pages (Groww) — 31 sources

All URLs follow the pattern `https://groww.in/mutual-funds/hdfc-*-direct-growth` and are scraped via Playwright during ingestion.

| # | Source ID | Scheme Name | Fund Type | Risk | URL |
|---|---|---|---|---|---|
| 1 | src_001 | HDFC Defence Fund Direct Growth | Sectoral | Very High | https://groww.in/mutual-funds/hdfc-defence-fund-direct-growth |
| 2 | src_002 | HDFC Transportation and Logistics Fund Direct Growth | Sectoral | Very High | https://groww.in/mutual-funds/hdfc-transportation-and-logistics-fund-direct-growth |
| 3 | src_003 | HDFC Pharma and Healthcare Fund Direct Growth | Sectoral | Very High | https://groww.in/mutual-funds/hdfc-pharma-and-healthcare-fund-direct-growth |
| 4 | src_004 | HDFC Manufacturing Fund Direct Growth | Sectoral | Very High | https://groww.in/mutual-funds/hdfc-manufacturing-fund-direct-growth |
| 5 | src_005 | HDFC Mid-Cap Fund Direct Plan Growth Option | Diversified | Very High | https://groww.in/mutual-funds/hdfc-mid-cap-opportunities-fund-direct-growth |
| 6 | src_006 | HDFC Nifty Midcap 150 Index Fund Direct Growth | Index | Very High | https://groww.in/mutual-funds/hdfc-nifty-midcap-150-index-fund-direct-growth |
| 7 | src_007 | HDFC Nifty Smallcap 250 Index Fund Direct Growth | Index | Very High | https://groww.in/mutual-funds/hdfc-nifty-smallcap-250-index-fund-direct-growth |
| 8 | src_008 | HDFC Nifty Next 50 Index Fund Direct Growth | Index | Very High | https://groww.in/mutual-funds/hdfc-nifty-next-50-index-fund-direct-growth |
| 9 | src_009 | HDFC Nifty 100 Equal Weight Index Fund Direct Growth | Index | Very High | https://groww.in/mutual-funds/hdfc-nifty-100-equal-weight-index-fund-direct-growth |
| 10 | src_010 | HDFC Small Cap Fund Direct Growth Option | Diversified | Very High | https://groww.in/mutual-funds/hdfc-small-cap-fund-direct-growth |
| 11 | src_011 | HDFC Infrastructure Fund Direct Plan Growth Option | Sectoral | Very High | https://groww.in/mutual-funds/hdfc-infrastructure-fund-direct-growth |
| 12 | src_012 | HDFC Nifty50 Equal Weight Index Fund Direct Growth | Index | Very High | https://groww.in/mutual-funds/hdfc-nifty50-equal-weight-index-fund-direct-growth |
| 13 | src_013 | HDFC Value Fund Direct Plan Growth | Diversified | Very High | https://groww.in/mutual-funds/hdfc-value-fund-direct-plan-growth |
| 14 | src_014 | HDFC Banking & Financial Services Fund Direct Growth | Sectoral | Very High | https://groww.in/mutual-funds/hdfc-banking-financial-services-fund-direct-growth |
| 15 | src_015 | HDFC Large Cap Fund Direct Growth | Large Cap | Very High | https://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth |
| 16 | src_016 | HDFC Focused Fund Direct Growth | Focused | Very High | https://groww.in/mutual-funds/hdfc-focused-fund-direct-growth |
| 17 | src_017 | HDFC Dividend Yield Fund Direct Growth | Dividend Yield | Very High | https://groww.in/mutual-funds/hdfc-dividend-yield-fund-direct-growth |
| 18 | src_018 | HDFC Multi Cap Fund Direct Growth | Multi Cap | Very High | https://groww.in/mutual-funds/hdfc-multi-cap-fund-direct-growth |
| 19 | src_019 | HDFC Gold ETF Fund of Fund Direct Growth | Gold | High | https://groww.in/mutual-funds/hdfc-gold-fund-direct-growth |
| 20 | src_020 | HDFC Flexi Cap Fund Direct Growth | Diversified | Very High | https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth |
| 21 | src_021 | HDFC Balanced Advantage Fund Direct Growth | Hybrid | High | https://groww.in/mutual-funds/hdfc-balanced-advantage-fund-direct-growth |
| 22 | src_022 | HDFC Hybrid Equity Fund Direct Growth | Hybrid | Very High | https://groww.in/mutual-funds/hdfc-premier-multi-cap-fund-direct-growth |
| 23 | src_023 | HDFC Large and Mid Cap Fund Direct Growth | Large & Mid Cap | Very High | https://groww.in/mutual-funds/hdfc-large-and-mid-cap-fund-direct-growth |
| 24 | src_024 | HDFC Technology Fund Direct Growth | Sectoral | Very High | https://groww.in/mutual-funds/hdfc-technology-fund-direct-growth |
| 25 | src_025 | HDFC ELSS Tax Saver Fund Direct Plan Growth | ELSS | Very High | https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth |
| 26 | src_026 | HDFC Short Term Debt Fund Direct Growth | Debt | Moderate | https://groww.in/mutual-funds/hdfc-short-term-opportunities-fund-direct-growth |
| 27 | src_027 | HDFC Liquid Fund Direct Growth | Debt | Low | https://groww.in/mutual-funds/hdfc-liquid-fund-direct-growth |
| 28 | src_028 | HDFC Overnight Fund Direct Growth | Debt | Low | https://groww.in/mutual-funds/hdfc-overnight-fund-direct-growth |
| 29 | src_029 | HDFC Money Market Fund Direct Growth | Debt | Low | https://groww.in/mutual-funds/hdfc-money-market-fund-direct-growth |
| 30 | src_030 | HDFC Nifty 50 Index Fund Direct Growth | Index | Very High | https://groww.in/mutual-funds/hdfc-nifty-50-index-fund-direct-growth |
| 31 | src_031 | HDFC Corporate Bond Fund Direct Growth | Debt | Moderate | https://groww.in/mutual-funds/hdfc-medium-term-opportunities-fund-direct-growth |

## Static Documents — 1 source

| # | Source ID | Title | Location |
|---|---|---|---|
| 32 | fee_static_001 | Groww — Expense Ratio (approved educational explainer) | `config/static_fee_explainer.md` |

---

**Notes:**
- All URLs are predefined and approved. No runtime web search is performed.
- Scheme pages are scraped using Playwright during the ingestion pipeline (`npm run phase3:ingest`).
- The static fee explainer is loaded directly from the filesystem during ingestion.
- Sources are refreshed daily via GitHub Actions (`.github/workflows/rag_refresh.yml`).
- The canonical machine-readable manifest is at `config/source_urls.json`.
- The current approved corpus contains scheme facts and the static fee explainer only. Add any future help or regulatory source to `config/source_urls.json` before allowing the FAQ to answer from it.
