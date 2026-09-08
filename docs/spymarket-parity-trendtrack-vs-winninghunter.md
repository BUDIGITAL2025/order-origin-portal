# SpyMarket parity — TrendTrack vs WinningHunter (after WH phase 2)

Written 2026-09-08, after shipping the WinningHunter Store explorer, Brands, Trends and
TikTok Shop tabs. Source of truth for endpoints: `docs/winninghunter-api-reference.md`.
This answers one question: **what do we lose the day we cut TrendTrack?**

| TrendTrack tab in use today | Covered by WinningHunter? | Where it lives now | Notes |
|---|---|---|---|
| Lookup (free typeahead) | **PARTIAL** | no dedicated tab | WH has no free typeahead. The Store explorer search box replaces the job, but each search costs 1 credit. TikTok Shop suggestions exist and also cost 1 credit per keystroke-batch, so we do not wire them to typing. |
| Shop explorer + growth rules | **EQUIVALENT** | Store explorer (WH) | Search, niche, merchant country, min revenue, min monthly visits, six sort keys including 1m/3m traffic growth. 50 stores per credit vs TrendTrack's per-row pricing. |
| Shop detail | **PARTIAL** | Store explorer (WH) → row click | Free detail panel: 6-month traffic curve, daily/monthly revenue bands, AOV, product count, active ads, traffic by country, bestsellers, store emails, Trustpilot, first-product date. Missing vs TrendTrack: per-shop advertiser history, per-shop TikTok library, similar-shops list (WH offers image-based similar stores instead), socials history. |
| Ad library | **EQUIVALENT +** | Ad Library (WH) | Same anatomy, plus TikTok, Pinterest and Google — three networks TrendTrack never had. |
| Ad copies | **EQUIVALENT (tracked brands)** | Brands (WH) → Ad copies | Only for brands we track; TrendTrack served any shop on demand. |
| Headlines / hooks | **EQUIVALENT (tracked brands) +** | Brands (WH) → Hooks / Headlines | Plus personas, angles, desires, emotions, themes, USPs, awareness and funnel stages, landing pages and associated domains — a full creative-strategy breakdown we never had. Copy buttons on every line. |
| Emails / email creatives | **NONE** | — | WinningHunter has no email endpoint at all. This is the single real loss. Store explorer still surfaces the store's public contact emails, but no campaign creatives. |
| Usage / remaining credits | **PARTIAL** | header chips | Our own call log and "spent today" are free; WinningHunter's balance probe itself costs 1 credit, so it only refreshes on click and is cached 15 minutes. |
| — (new) | **NEW** | Trends (WH) | Exploding-topics feed with 3/6/12-month growth and search-volume curves. |
| — (new) | **NEW** | TikTok Shop (WH) | Products, shops, creators and videos with real revenue, units sold, growth rates, ratings and commission — plus per-product drill-down. |

## Verdict

Cutting TrendTrack costs us exactly one capability outright — **email creatives** — plus
free lookup/usage, and a thinner shop-detail (no advertiser/socials history per shop).
Everything else is matched or improved, and we gain four networks of ads, TikTok Shop
demand data, exploding topics and the brand creative-strategy breakdown.

## Cost model, side by side

- TrendTrack: credits per row returned, so page size mattered.
- WinningHunter: **flat 1 credit per successful call**, so we always request the largest
  page the endpoint allows (50 stores, 50 ads, 50 TikTok Shop rows).
- Everything is cached 24h (brand list 6h, credits probe 15m); repeats are free and the
  UI says "cache hit — free".

## Verification (real probes, 2026-09-08)

| Tab | Probe | Credits | Repeat |
|---|---|---|---|
| Store explorer (WH) | default search, 50 rows | 1 | 0 — cache hit |
| Brands (WH) | list tracked brands (4) | 1 | 0 — cache hit |
| Brands (WH) → Hooks | one tracked brand's hooks | 1 | cached 24h |
| Trends (WH) | browse feed, 36 topics | 1 | 0 — cache hit |
| TikTok Shop (WH) | US products, 30d, 50 rows | 1 | 0 — cache hit |

All TrendTrack tabs were left untouched and still work.
