# WinningHunter API — complete reference

Source: the public docs at `https://app.winninghunter.com/docs` (index: `https://app.winninghunter.com/llms.txt`), fetched 2026-09-08. Base URL = the app origin, i.e. `https://app.winninghunter.com`; the docs write it as `{origin}`. Auth: `X-API-Key: <key>`.

Billing note: unlike DataForSEO (per-call pricing) and TrendTrack (per-row credits), WinningHunter meters a **flat 1 credit per successful metered call**, whatever the page size. Cost control is therefore about *call count*, not row count — always ask for the largest page the endpoint allows.

## Table of contents

- [Capability map — SpyMarket feature → WinningHunter endpoint](#capability-map--spymarket-feature--winninghunter-endpoint)
- [1. Fundamentals](#1-fundamentals)
- [2. Meta Ad Library](#2-meta-ad-library)
- [3. TikTok Ads](#3-tiktok-ads)
- [4. Pinterest Ads](#4-pinterest-ads)
- [5. Google Ads](#5-google-ads)
- [6. Magic AI (similar-ad discovery)](#6-magic-ai-similar-ad-discovery)
- [7. Landers](#7-landers)
- [8. Saved Ads](#8-saved-ads)
- [9. Brands & Brand tracker](#9-brands--brand-tracker)
- [10. Notifications](#10-notifications)
- [11. TikTok Shop](#11-tiktok-shop)
- [12. Shopify Explorer](#12-shopify-explorer)
- [13. Shopify Tracker](#13-shopify-tracker)
- [14. Trends (Exploding Topics)](#14-trends-exploding-topics)
- [15. Credits probe & ad transcripts](#15-credits-probe--ad-transcripts)
- [16. MCP surface](#16-mcp-surface)
- [17. Usage / resale terms](#17-usage--resale-terms)
- [18. Integration notes for our gateway](#18-integration-notes-for-our-gateway)

---

## Capability map — SpyMarket feature → WinningHunter endpoint

Our SpyMarket tool (`src/components/spymarket-tools.tsx`, `src/lib/spymarket-tools.functions.ts`) runs on the TrendTrack public API. Tabs today: **Lookup**, **Shop explorer**, **Shop detail** (products / advertisers / TikTok library / similar / socials / emails), **Ad library**, **Emails**, **Usage**.

Legend: **EQUIVALENT** = direct replacement exists · **PARTIAL** = close but different shape/coverage · **NONE** = no WinningHunter equivalent.

| SpyMarket feature | TrendTrack today | WinningHunter equivalent | Verdict |
|---|---|---|---|
| Lookup (free typeahead) | `GET /v1/lookup` (free) | `GET /api/v1/tiktok-shop/suggestions` (TikTok entities only) — **costs 1 credit**, no free store/brand typeahead | PARTIAL |
| Shop discovery + filters | `POST /v1/shops/query` | `POST /api/v1/store-explorer` — `search`, `country`, `sortingKey` (`revenue_30d`, `monthly_visits`, `aov`, `revenue_1y`, growth), `page`, `pageSize`, `includeWlads` | EQUIVALENT |
| Growth filters (traffic/ads growth, periods) | `trafficGrowth[]`, `adsGrowth[]`, `pageReachGrowth[]` | Explorer: `visits_growth_pct_m1/m3`, `revenue_change_pct_min/max`, `traffic_growth_rules_json` (`{months:1\|3, direction, percentage}`); Meta ads: `min/max_active_ads_growth` + `active_ads_growth_period`, `min/max_reach_growth` + `reach_growth_period` | EQUIVALENT |
| Filter facets (niche / theme / app / pixel) | 5 free `GET /v1/facets/*` | `list_shopify_store_filter_options` (MCP; sections: apps, themes, taxonomy), `GET /api/niche-counts` (Meta niches, unmetered) | PARTIAL (facets are metered/MCP-side) |
| Shop detail (products, similar, socials) | `GET /v1/shops/{id}` + sub-routes | Store explorer row carries `monthly_visits`, `monthly_visits_historical` (~6 months), `estimated_revenue` daily/monthly min-max; **similar stores by image** via `POST /api/v1/store-explorer/visual-search`. No per-shop products/socials-history route on the public API | PARTIAL |
| Shop emails / email creatives | `POST /v1/emails/query`, `GET /v1/emails/{id}` | none | **NONE** |
| Ad library (Meta) | `GET /v1/ads`, `POST /v1/ads/query` | `GET /api/v1/adlibrary` — full dashboard filter set, `scroll` cursor, max 50/page | EQUIVALENT |
| Ad rank / scaling signals | `GET /v1/brandtrackers/{id}/ad-rank`, `/scaling-ads` | ad cards carry `ad_rank`, `adscore`, `total_active_ads_on_page` + absolute historicals `_growth_1w/_14d/_1m/_3m` (5-point scaling curve); filters `min/max_ad_rank`; brand route `GET /api/v1/brands/ad-rank-leaderboard` | EQUIVALENT |
| Ad copies | `GET /v1/brandtrackers/{id}/ad-copies` | `GET /api/v1/brands/ad-copies` (tracked brands only) | EQUIVALENT (tracked brands) |
| Headlines / hooks | `/headlines`, `/hooks` | `GET /api/v1/brands/ad-headlines`, `GET /api/v1/brands/ad-hooks` | EQUIVALENT (tracked brands) |
| Creatives download | `GET /v1/ads/{id}/media-url`, `/creatives` | media URLs come inline on ad cards (`media_url`, `video`, `image`, `poster`); no dedicated signed-media route | PARTIAL |
| Reach history | `GET /v1/ads/{adId}/reach-history` | reach histories arrive as enrichment fields on ad cards; brand series via `/api/v1/brands/live-ads-over-time`, `/ads-launched` | PARTIAL |
| Usage / remaining credits | free `GET /v1/usage` | `GET /api/v1/credits` — **costs 1 credit**; free only from a browser session (`GET /api/usage`, `GET /api/logs`) | PARTIAL |

### What WinningHunter has that TrendTrack's API did not

| Area | Endpoints | Why it matters for FlySales |
|---|---|---|
| **TikTok Ads** | `GET /api/v1/tiktok-ads`, `/api/v1/tiktok-ads/{id}` | TrendTrack only exposed a per-shop TikTok *library*; this is a full searchable TikTok ad index with likes/comments/shares/scaling filters |
| **Pinterest Ads** | `GET /api/v1/pinterest-ads` | no TrendTrack equivalent at all |
| **Google Ads** | `GET /api/v1/google-ads`, `GET /api/v1/store/google-ads[/count\|/detail\|/overview\|/advertiser\|/creative]` | TrendTrack had a Google Ads domain we never touched; WinningHunter adds store-scoped rollups and creative history |
| **TikTok Shop** | `/api/v1/tiktok-shop/*` — products, shops, creators, videos, categories, explore/count/detail/history/suggestions | entirely new: real GMV/sold/growth data per product and shop, the closest thing to sourcing demand signal we have |
| **Trends** | `POST /api/v1/trends/search`, `/detail`, `/autocomplete` (Exploding Topics passthrough) | product-trend discovery with 3/6/12/24/60-month exploding classifications and search-volume history |
| **Landers** | `POST /api/v1/landers/explore`, `/favorites`, `/favorites/toggle` | a landing-page library filterable by ad volume, monthly visits and store revenue |
| **Brand personas / angles / hooks** | `/api/v1/brands/personas`, `/themes`, `/angles`, `/desires`, `/emotions`, `/awareness-stages`, `/funnel-stages`, `/usps`, `/partner-pages`, `/partnership-ads`, `/associated-domains`, `/landing-pages` | TrendTrack had hooks/headlines; WinningHunter adds a full creative-strategy breakdown per tracked brand |
| **Magic AI** | `POST /api/v1/magic-ai` | reverse image / text search for similar ads — no TrendTrack equivalent |
| **Visual store search** | `POST /api/v1/store-explorer/visual-search` | find stores selling a product from a photo |
| **Ad transcripts** | `GET /api/v1/ad-transcript`, `POST /api/v1/ad-transcript-generate`, `POST /api/v1/ad-similar-script-generate` | video ad transcription + script generation |
| **Notifications inbox** | `/api/v1/notifications*`, `/api/v1/brands/notifications/prefs` | server-side digest/alerting we could mirror into our own notifications |

Verdict in one line: WinningHunter is **cheaper per call and much wider** (5 ad networks + TikTok Shop + trends + landers), but **loses email creatives** and the **free** lookup/usage routes TrendTrack gave us, and its shop-detail depth is thinner.

---

## 1. Fundamentals

### Authentication

Send the key on every metered `/api/v1/...` request:

```bash
curl -sS -H "X-API-Key: $WH_API_KEY" "{origin}/api/v1/credits"
```

| Method | Form |
|---|---|
| Preferred | `X-API-Key: <key>` |
| Bearer | `Authorization: Bearer <key>` |
| Query | `?api_key=<key>` (avoid — leaks into logs) |

First non-empty value wins: `X-API-Key` → Bearer → `api_key`. Keys are created and regenerated at `/api`; the plaintext value is shown once. Regeneration is immediate and kills the old key.

**Plan gate:** the key must belong to a **Basic plan or higher** account, else HTTP 403 `WinningHunter Basic plan or higher required`.

**Two path families:**

| Prefix | Auth | Use |
|---|---|---|
| `/api/v1/...` | API key or dashboard session (both metered) | integrations — always use this |
| `/api/tiktok-shop/*`, `/api/brands/*`, `/api/magic-ai`, … (no `v1`) | browser session only | legacy dashboard paths |

Unversioned aliases `/api/adlibrary`, `/api/store-tracker`, `/api/store-explorer` hit the same metered surface.

### Credits & billing

**1 credit per successful metered call**, regardless of rows returned.

| Plan tier | Monthly API credits |
|---|---|
| Standard and above | 20,000 |
| Basic | 100 |
| Below Basic | 0 (all calls fail the credit check) |

- Resets when the calendar month changes (server `Y-m`).
- Add-on packs live in `addon_remaining` and are drawn only after the monthly allowance is spent.
- The proxy **charges before** the handler runs; an **uncaught exception refunds** the credit. `401`/`403` and both kinds of `429` do **not** consume a credit. A handler that returns an error JSON *without throwing* **keeps** the charge.
- MCP `tools/call` draws from the same monthly pool (1 credit per successful tool call).

Metered surface: all `/api/v1/tiktok-shop/*`; `GET /api/v1/adlibrary`, `/pinterest-ads`, `/google-ads`, `/tiktok-ads`; `POST /api/v1/magic-ai`; `POST /api/v1/landers/explore` and lander favorites; `GET /api/v1/store-tracker`, `POST /api/v1/store-explorer(/visual-search)`; `/api/v1/brands*`; `/api/v1/notifications*`; `/api/v1/store/google-ads*`; `/api/v1/saved-ads/*`; `POST /api/v1/trends/*`; `GET /api/v1/credits`; `/api/v1/ad-transcript*`.

Balance probe (**itself 1 credit — do not poll it**):

```json
{ "success": true,
  "credits": { "used": 142, "limit": 20000, "remaining": 19858,
               "addon_remaining": 500, "total_remaining": 20358 } }
```

`total_remaining = remaining + addon_remaining`.

**Not the same pool:** `GET /api/v1/tiktok-shop/credits` → `{ "success": true, "credits_remaining": null, "credits_unlimited": true }` is the TikTok Shop **daily search** quota (a positive integer on Basic). The same pair is injected into explore responses as `credits_remaining` / `credits_unlimited`. Ignore it for API budgeting.

Free while logged in as a browser session: `/api`, `GET /api/usage`, `GET /api/logs`. Also unmetered: `GET /api/niche-counts`.

### Rate limits

| Setting | Value |
|---|---|
| Window | rolling 60 seconds |
| HTTP `/api/v1/*` | **60 requests/min per billing account** |
| MCP `tools/call` | **300/min** (separate counter) |
| Counted | metered calls that pass auth, including rate-limit/credit `429`s and uncaught `500`s. `401`/`403` are not counted |

Backoff: wait 1–2 s on a rate-limit `429`, then exponential with a ~30 s cap. On a credit-exhaustion `429`, **stop** — retrying cannot help.

### Error shape

```json
{ "success": false, "error": "<human-readable message>" }
```

Some handlers (notably TikTok Shop) use `{ "error": "<code>", "message": "…" }`. **Always branch on HTTP status first.**

| Status | When |
|---|---|
| 200 | success (note: some plan gates return 200 with `{ "upgrade": "standard_reach", "message": … }` instead of data) |
| 400 | invalid argument — e.g. an unsupported Meta targeting country; body carries `allowed_values` and `hint` |
| 401 | missing/invalid key |
| 403 | plan below Basic, **or** TikTok Shop daily search quota exhausted (`{"error":"insufficient_credits","upgrade":"premium"}`) |
| 404 | unknown TikTok Shop path |
| 429 | rate limit **or** credit exhaustion |
| 500 | uncaught handler error (credit refunded) |

**Distinguish the two 429s by the presence of a `credits` object**: rate-limit 429 has none; credit exhaustion carries `credits` plus a `purchase.url`.

A `414 URI Too Long` from a reverse proxy means the TikTok filter set is too big for a query string — resend as `POST` JSON.

### Time windows

Pick one mechanism per request; never mix them.

| Surface | Parameter | Values |
|---|---|---|
| TikTok Shop explore/count/detail/history | `period` | `7d`, `30d`, `90d`, bare integer days, sometimes `all` |
| TikTok Shop visit-event routes (`product-other-visits`, `category-visit-events`, `detail-visit-events`) | `period` | `7d`, `30d`, `all`/`alltime`, integer; default `30d`; responses carry `period_label` |
| `GET /api/v1/tiktok-shop/products` (flat list) | `date_from` / `date_to` | `Y-m-d` |
| Brands tracker tabs | `date_range` (+ `date_from`/`date_to`) | omitted/`all`, `live` (last seen ≤4 days), `7d`, `30d`, `3m`, `6m`, `custom` |
| Meta / TikTok / Pinterest ads | `from`/`to` (ad start), `fromlastseen`/`tolastseen` | `Y-m-d` |
| Google Ads | `date_from`/`date_to`, `first_seen_from`/`first_seen_to` | `Y-m-d` |

Most common mistake: sending `start_date`/`end_date` alongside `period` on TikTok Shop. Send only `period`.

---

## 2. Meta Ad Library

`GET /api/v1/adlibrary` (alias `/api/adlibrary`). MCP: `search_facebook_ads`, `find_winning_products`.

**Parameters** (dashboard-compatible; missing entry-guard keys are defaulted server-side):

| Param | Notes |
|---|---|
| `keyword` | free text |
| `searchkeyword` | `All` \| `landingurl` \| `pagename` \| `adtext` \| `productname`; auto `All` when `keyword` is set |
| `countries` | **Meta ad-targeting markets only** (US, GB, ES, BR…). Unsupported codes (MX, CO, CL, AR, PE) return **400** |
| `store_based_in` / `storebasedin` | store HQ (`shop_origin_country`) — use this for MX/CO/CL/AR/PE |
| `sorting` | `relevance` (default), `reach`, `lastseen`, `datefound`, `mostrecent`, `adspend`, `trending`, `longestrunning`, `adsetamount`, `consistency`, `monthlyvisits`, `pageactiveads`, `toprank` (ad_rank ascending) |
| `sortdirection` | `desc` (default) \| `asc` |
| `page`, `scroll`, `limit` | `page` 0-based; `scroll` opaque cursor (empty on first call); `limit` first request only, default 20, **max 50** |
| `mediafilter`, `activestatus`, `niches` | media type, active/inactive, niche codes (`GET /api/niche-counts`, unmetered, `?refresh=1`) |
| `from`/`to`, `fromlastseen`/`tolastseen` | ad created / last seen windows (`Y-m-d`) |
| `min`/`max` | min/max duplicates |

Snake_case aliases normalize to the internal names (internal wins if both are sent): `min_ad_spend`→`minadspend`, `min_reach`→`minreach`, `min_monthly_visits`→`mintraffic`, `min_days_running`→`mindays`, `min_active_ads(_growth)`→`minactiveads(growth)` + `active_ads_growth_period`, `min_reach_growth`→`minreachgrowth` + `reach_growth_period`, `min_ad_rank`→`minadrank`, `ad_created_from/to`→`from`/`to`, `last_seen_from/to`→`fromlastseen`/`tolastseen`, `product_created_from/to`→`product_from`/`product_to`, `page_created_from/to`→`pagefrom`/`pageto`, `media_type`→`mediafilter`, `page_type`→`pagetypefilter`, `ad_score`→`adscorefilter`, `rank_growth_filter`→`rankgrowthfilter`, `sort_by`/`sort_order`→`sorting`/`sortdirection`, `technology`→`website`, `theme(s)`/`apps`/`exclude_apps`→`themes`/`apps`/`excludeApps`.

**Response** — *not* wrapped in `{"success": true}`:

```json
{ "data": [ { "productid": "1284…", "page_id": "1088…", "pageName": "Glow Beauty Co.",
              "countries": ["US","CA"], "started": "2024-05-12", "lastSeen": "2026-03-14",
              "caption": "…", "copy": "…", "urlStore": "https://…/products/…",
              "daysrunning": 128, "countActive": 12, "total_active_ads_on_page": 47,
              "ad_rank": 3, "adscore": "Winning", "total_adspend": 8420,
              "saved": false, "hidden": false } ],
  "total": 240, "total_relation": "eq", "scroll": "sa:opaque-cursor-token", "limit": 20 }
```

Field notes:
- Cards come from `Utils::process_ads` — the **same shape** as Magic AI and brand ads. Use `productid`, `pageName`, `daysrunning`, `urlStore`. There is **no** top-level `id`, `ad_url`, `platform` or `headline`.
- `total_active_ads_on_page_growth_1w|_14d|_1m|_3m` are **absolute historical counts**, not percentages — a 5-point scaling curve.
- `store_traffic.monthly_visits_historical` (or top-level on some store rows) holds ~6 months of monthly visits; prefer it over the single `monthly_visits`.
- `technologies` carries detected stack codes (`SH`, `KV`, `TA`, …). Top level may include `nextscrapetime`, `message`.
- Scroll errors: `Invalid or expired scroll token`, `Scroll token does not match current query filters`. Stop when `scroll` is null; use stable sorts for deep paging.

---

## 3. TikTok Ads

`GET /api/v1/tiktok-ads` and `GET /api/v1/tiktok-ads/{id}` (dashboard `/api/tt-ads` is session-only).

| Param | Default | Notes |
|---|---|---|
| `keyword` (aliases `q`, `search`) | — | free text / comma list |
| `searchkeyword` | `All` | `landingurl`, `pagename`, `adtext`, `productname` |
| `countries` | — | comma list or `All` |
| `sorting` | `likes` | `likes`, `shares`, `comments`, `datefound`, `lastseen`, `adspend`, `adsetamount`, `consistency`, `daysrunning` |
| `sortdirection` | `desc` | |
| `niches` | — | 15 TikTok keys: `beauty`, `bags`, `car`, `romanticgifts`, `clothing`, `watches`, `jewelry`, `womenclothing`, `menclothing`, `toys`, `child`, `home`, `pet`, `gadgets`, `outdoor`, or raw `label_########` ids. Meta codes return `invalid_argument` |
| `min`/`max` (likes), `mincomments`/`maxcomments`, `minshares`/`maxshares` | 1 / large | engagement bands |
| `scaling` | `All` | `upscaling`, `nodownscaling`, `downscaling` |
| `languages`, `websites` | — | platform tech codes `SH`, `WOO`, `MAG`, `BIG` |
| `from`/`to`, `fromlastseen`/`tolastseen`, `product_from`/`product_to` | — | `Y-m-d` (aliases `date_from`, `last_seen_from`, `product_created_from`, …) |
| `pagetype` | `All` | `collections` |
| `mintraffic`/`maxtraffic` | — | monthly store visits |
| `mindays`/`maxdays` | — | days running |
| `scroll`, `limit` | 20 | opaque cursor; max 50 on first request |

Sort keys available through MCP `search_tiktok_*` tools mirror these.

---

## 4. Pinterest Ads

`GET /api/v1/pinterest-ads`.

| Param | Default | Values |
|---|---|---|
| `keyword` | — | |
| `searchkeyword` | `All` | `landingurl`, `storeurl`, `pagename`, `adtext`, `productname` |
| `countries` | — | |
| `sorting` | `datefound` | `comments`, `likes`, `shares`, `reactions`, `lastseen`, `daysrunning` |
| `sortdirection` | `desc` | |
| `page`, `scroll`, `limit` | 0 / — / 20 | max 50 first request |

Semantics: **likes = saves**, **shares = repins**; response fields are `save_count` / `repin_count`. Cards carry `id`, `ad_id`, `productid`, `platform: "pinterest"`, `page_id`, `page_name`/`pageName`, `promoter_username`, `title`, `text`, `copy`, `description`, `media_type`, `media_url`, `image`, `poster`, `video`, `pin_url`, `page_url`. No niche/category filter on Pinterest — use `keyword`/`domain`.

---

## 5. Google Ads

`GET /api/v1/google-ads` — global creative search.

| Param | Default | Notes |
|---|---|---|
| `search` (alias `keyword`), `searchkeyword` | / `All` | scope: `All`, `landingurl`, `adtext`, … |
| `page`, `limit` | 1 / 24 | **1-based** page; `limit` max **48** |
| `sort`, `sort_dir` | `lastseen` / `desc` | `firstseen`, `reach`, `adspend`, `days_running` |
| `status` | — | `active` \| `inactive` (alias `is_active=1/0`) |
| `country_inc`, `country_exc`, `format`, `platform` | — | `format`: image \| video \| text |
| `date_from`/`date_to`, `first_seen_from`/`first_seen_to` | — | `Y-m-d` |
| `days_min`/`max`, `reach_min`/`max`, `adspend_min`/`max` | — | |
| `adspend_cpm` | `11` | CPM used for spend estimates |
| `domain`, `visits_min`/`visits_max` | — | store-level filters |

**Store-scoped Google Ads** (all metered, 1 credit each):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/store/google-ads` | paginated creatives for a store (`page`, `limit`, filters) |
| GET | `/api/v1/store/google-ads/count` | total for the store's domains |
| GET | `/api/v1/store/google-ads/detail` | single creative (`doc_id`) |
| GET | `/api/v1/store/google-ads/overview` | store-level KPI rollup |
| GET | `/api/v1/store/google-ads/advertiser` | advertiser rollup (`advertiser_id`) |
| GET | `/api/v1/store/google-ads/creative` | creative metrics history (`creative_id`) |

No niche filter on Google — use `search`, `domain`, `advertiser_name`.

---

## 6. Magic AI (similar-ad discovery)

`POST /api/v1/magic-ai` — find similar Meta ads from text, an uploaded image, or an image URL. (Session UI uses `/api/magic-ai`.)

Body: `text` | `image_url` | `image` (multipart) — supply one; `page` (0 first), `scroll`, `limit` (20, max 50), `countries`/`exclude_countries` (default `All`), `language`/`exclude_language`, `from`/`to`, `fromlastseen`/`tolastseen`, `activefilter` (`active` = last seen within ~4 days), `minadspend`/`maxadspend`, `minactiveads`/`maxactiveads`, `ads_per_brand` (set 1 for one ad per page), `mindays`/`maxdays`, `adscorefilter`.

Results use the same `Utils::process_ads` card shape as the Meta ad library.

---

## 7. Landers

`POST /api/v1/landers/explore` — the Premium Explorer landing-page library. JSON or form body; query params merged as fallback.

| Body param | Default | Notes |
|---|---|---|
| `page`, `pageSize` | 1 / 10 | **max 250 rows** — the cheapest bulk endpoint in the API |
| `sortingKey`, `sortingDirection` | `relevant` / `desc` | `landers_ad_volume`, `monthly_visits`, `store_revenue` |
| `search`, `landersAdvertiser`, `landersUrl` | — | text filters |
| `landersNiche`, `landersPageType` | — | `product`, `collection`, `homepage`, … |
| `landersAdVolume`, `landersRunningTime`, `landersMonthlyVisits`, `landersMonthlyRevenue` | — | band filters |
| `country` | `All` | |

Favorites (1 credit each): `GET /api/v1/landers/favorites`; `POST /api/v1/landers/favorites/toggle` with `lander_key` (required), `lander_url`, `advertiser_name`, `entity_data`.

Session-only helpers: `POST /api/shops/explore`, `GET /api/landers/filter-bootstrap`, `GET /api/lander/overview`.

---

## 8. Saved Ads

Board-backed library mirroring the dashboard. Platforms: `facebook`, `facebook_post`, `pinterest`, `tiktok`, `google`. 1 credit per call.

`POST /api/v1/saved-ads/save` — body `ad_id` (required), `platform` (default `facebook`), `board_id` (defaults to your default board) → `{ success, ad_id, platform, board_id, already_saved, message }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/saved-ads/folders` | list folders (bare array) |
| GET | `/api/v1/saved-ads/boards` | list boards (bare array) |
| GET | `/api/v1/saved-ads/folders-with-boards` | nested tree; optional `ad_id`+`platform` marks boards holding the ad |
| POST | `/api/v1/saved-ads/create-folder` \| `create-board` | `name` / `folder_id`+`name` |
| POST | `/api/v1/saved-ads/rename-folder` \| `rename-board` | `folder_id`/`board_id` + `name` |
| POST | `/api/v1/saved-ads/delete-folder` \| `delete-board` | |
| POST | `/api/v1/saved-ads/add-ad` \| `remove-ad` | `ad_id`, `board_id`, optional `platform` |

TikTok saves are mirrored into the legacy per-user TikTok list that drives the filled heart on `/tiktok-ads`; unsaving clears both.

---

## 9. Brands & Brand tracker

`GET /api/v1/brands` — tracked brands for the key owner.

Params: `sort` (`date_added` default, `name`, `active_ads`, `new_ads`, `growth`, `traffic`, `revenue`), `dir`, `search`, `board_id`, `page` (1-based), `limit` (max 50), `lite=1`, `filter_active_ads`, `filter_traffic`, `filter_revenue`, `revenue_period` (`1d` \| `30d`).

Response is an object with a **`brands`** array (not `{success,data}`), plus `total`, `page`, `limit`, `total_pages` and `brand_request_quota { used, limit, remaining, month }`. Brand rows: `id` (page_id), `name`, `logo_url`, `page_url`, `status`, `total_ads`, `active_ads_on_page`, `formats {videos, images, dco, carousels}`, `new_ads_count`, `new_ads_change`, `traffic`, `traffic_change`, `commerce`, `added_at`, `primary_domain`, `source_shopid`, `details_url`.

`GET /api/v1/brands/ads` — `id` (page_id, required), `page` (0-based), `date_range` + `date_from`/`date_to`. Returns a **bare JSON array** of processed ad cards (`daysrunning`, `pageName`, `productid`; no `id`/`platform`).

Track / untrack: `POST /api/v1/brands/follow` (`url` = Facebook Ad Library URL), `POST /api/v1/brands/follow-by-domain` (`{"domain":"allbirds.com"}`), `POST /api/v1/brands/unfollow`, `POST /api/v1/brands/request` (brand not yet indexed). Already-tracked follow returns `{ success, already_tracked: true, has_data, details_url, message }`.

**Analytics tabs** — all take `id` (page_id) plus optional `date_range`/`date_from`/`date_to`; 1 credit each:

| Path | Purpose |
|---|---|
| `/api/v1/brands/amount-tracked` | `{ amount, max_allowed }` |
| `/api/v1/brands/overview-cards` | KPI summary (personas, themes, angles, desires, emotions, USPs) |
| `/api/v1/brands/top-ads`, `/top-ads-platform-counts` | top ads (`platform`, `sort`), counts by platform |
| `/api/v1/brands/ad-rank-leaderboard` | rank leaderboard |
| `/api/v1/brands/ads-launched`, `/live-ads-over-time`, `/first-ad-date` | launch and live-count series |
| `/api/v1/brands/ad-copies`, `/ad-headlines`, `/ad-hooks` | copy, headlines, hooks |
| `/api/v1/brands/personas`, `/themes`, `/angles`, `/desires`, `/emotions`, `/awareness-stages`, `/funnel-stages`, `/usps` | creative-strategy breakdown |
| `/api/v1/brands/commerce`, `/associated-domains`, `/landing-pages` | commerce signals, domains, landers |
| `/api/v1/brands/partner-pages`, `/partnership-ads` | influencer/partnership ads |
| `/api/v1/brands/ads-by-ids` | batch fetch by ad ids |
| `/api/v1/brands/fetch-status` | readiness — takes **`page_id`**, not `id` → `{ success, has_data, summary }` |

Boards & folders: `/api/v1/brands/folders-with-boards`, `create-folder`, `rename-folder`, `delete-folder`, `create-board`, `rename-board`, `delete-board`, `add-to-board`, `remove-from-board`, `generate-shareable-board-link` (→ `{ success, url, token }`).

Digest prefs: `GET /api/v1/brands/notifications/prefs` (+ POST counterparts).

---

## 10. Notifications

Product inbox (navbar bell). 1 credit each.

| Method | Path | Params |
|---|---|---|
| GET | `/api/v1/notifications` | `limit` (max 30), `before_id` cursor — newest first |
| GET | `/api/v1/notifications/unread-count` | — |
| POST | `/api/v1/notifications/mark-read` | ids |
| POST | `/api/v1/notifications/mark-all-read` | — |

Brand digest email preferences live under `/api/v1/brands/notifications/*`.

---

## 11. TikTok Shop

All paths prefixed `/api/v1/tiktok-shop/`. Parameters can be sent as query string, POST JSON, or form (merged); empty and `"undefined"` values are stripped. Use POST JSON for big filter sets to avoid 414.

### Explore & count

`products`, `shops`, `creators`, `videos`, `categories` each expose `…/explore` and `…/count` (GET or POST).

Shared params: `country` (default `US`, normalized uppercase), `period` (default ~30 days), `limit` (20), `page` (1), `after` (keyset cursor for deep pagination), `sort` / `order` (`desc`), plus `category_ids`, `category_l1_id`, … when the hierarchy applies.

Entity filters:
- **Products** — `name`, `min_revenue`/`max_revenue`, growth rates, `min_item_sold`/`max_item_sold` (alias `min_sold`), price / commission / score / review / creator / launch filters. Sorts: `revenue`, `revenue_30_days`, `sold_count`, `avg_unit_price`, `commission_rate`, `creator_count`, `first_seen`, `creator_conversion_ratio`, `revenue_growth_rate`, `sales_growth_rate`, `product_score`, `product_rating`, `product_review_cnt`.
- **Shops** — `name`, revenue/growth, rating, seller type, product/creator/video counts, channel-strategy %. Aliases such as `min_gmv_30d` → `min_revenue`.
- **Creators** — revenue/growth, followers (+ lifetime, growth rate), views, verified, product/video counts.
- **Videos** — revenue, engagement, `gpm`, `ad_spend`, `ad2_cost`, `ad2_roas`, `estimated_roas`, publish date, flags (`is_ad`, `is_affiliate`).
- **Categories** — `level`, revenue / shop / video ratios; default sort `revenue_origin`.

Explore responses proxy the upstream TikTok Shop v2 payload; WinningHunter injects `credits_remaining`, `credits_unlimited`, and deep links `winninghunter_product_url` / `tiktok_shop_product_url` (product rows) and `winninghunter_shop_url` / `tiktok_shop_url` (shop rows). `meta` usually accompanies `data`; `success` and `pagination` appear only when upstream sends them.

### Other GETs

| Path | Notes |
|---|---|
| `products` | flat list — `page`, `limit`, `sort`, `date_from`/`date_to` |
| `search` | `q` required |
| `trending` | `limit`, `timeframe`, `category` |
| `suggestions` | see below |
| `credits` | TikTok daily search quota (not the API pool) |
| `shops/details` / `shop-details` | `id` required |
| `categories/hierarchy`, `/layers`, `/summary`, `/history`, `/siblings` | category tree and history |
| `categories/top-products`, `/top-shops`, `/top-creators` | POST |
| `shops/summary`, `shops/products` | shop rollups |

### Details

| Method | Path | Purpose |
|---|---|---|
| POST | `shop-detail` (+ `/total`, `/extraTotal`, `/history`) | full shop detail and aggregates |
| POST | `shop-detail/product/queryList`, `/searchVideos`, `/searchNewProducts`, `/searchCooperativeCreators` | shop drill-downs |
| POST | `shop-detail/salesStrategy/selfPromotion`, `/affiliate` | channel strategy |
| GET | `product-detail/{id}` | product detail |
| POST | `product-detail/total`, `/history` | product aggregates and series |
| POST | `creator-detail` (+ `/total`, `/history`, `/searchShopList`, `/searchProducts`) | creator detail |
| GET | `videos/{id}/metrics` | video metrics |

`/total` and `/history` routes are **upstream passthrough** — do not assume invented flat field names. Capture a real dashboard request from the Network tab and replay it against `/api/v1/tiktok-shop/...`.

### Suggestions

`GET /api/v1/tiktok-shop/suggestions` — `type` (`categories` \| `shops` \| `creators` \| `products` \| `videos`, required), `q` (required; empty → empty list, HTTP 200), `limit` (1–20, default 10), `country` (default `US`). Case-insensitive partial match sorted by a popularity signal (revenue / followers / views). **Still 1 credit per call even when empty** — debounce ~300 ms and require ≥2 characters.

---

## 12. Shopify Explorer

`POST /api/v1/store-explorer` (alias `/api/store-explorer`). MCP: `search_shopify_stores`, `find_similar_stores_by_image`, `list_shopify_store_filter_options`.

Body: `search`, `country` (merchant ISO2; omit/`All` = no filter), `sortingKey` (default `revenue_30d`; also `monthly_visits`, `30d_rev_estimated_max`, `1d_rev_estimated_max`, `revenue_1y`, `aov`, `visits_growth_pct_m1`, `visits_growth_pct_m3`), `sortingDirection`, `page` (1), `pageSize` (20; MCP caps size at 50), `includeWlads` (0 skips Meta ad enrichment — cheaper and faster).

Richer filters documented on the MCP tool (same underlying search): `category`/`niche` (`Clothing`, `Arts & Crafts`, `Accessories`, `Beauty`, `Health`, `Toys & Games`, `Electronics`, `Pet Supplies`, `Other`), `product_taxonomy_l1..l3`, `visitor_country_main`/`_among`/`_exclude`, `min_revenue`/`max_revenue`/`min_annual_revenue`/`max_annual_revenue`, `aov_min`/`aov_max`, `monthly_visits_min`/`max`, `product_count_min`/`max`, `language`, `currency`, `store_apps`, `shopify_themes`, `revenue_change_pct_min`/`max` (both bounds ≥ 0), `trustpilot_rating_min`/`max`, `trustpilot_reviews_min`/`max`, `traffic_growth_rules_json`, `store_created_from`/`store_created_to` (both required, filters first catalog signal, not Shopify `created_at`).

Response:

```json
{ "data": [ { "shopid": "glow-beauty", "storeid": "b796…", "domain": "glowbeauty.com",
              "name": "Glow Beauty", "monthly_visits": 412000,
              "monthly_visits_historical": { "2026-02": 380000, "…": 0 },
              "30d_rev_estimated_min": 126000, "30d_rev_estimated_max": 204000,
              "estimated_revenue": { "daily": {"min":4200,"max":6800},
                                     "monthly": {"min":126000,"max":204000} } } ],
  "count_deferred": true, "credits": null, "credits_unlimited": true }
```

`POST /api/v1/store-explorer/visual-search` — similar stores from an image (same result shape).

---

## 13. Shopify Tracker

`GET /api/v1/store-tracker` (alias `/api/store-tracker`) → `{ "amount": 37, "max_allowed": 100 }` — **no** top-level `success`.

Add/remove are **session-only**: `POST /api/storetracker/add` (`storeurl`), `POST /api/salestracker/delete` (`shopid`), `GET /api/storetracker/amount-stores-tracked`.

---

## 14. Trends (Exploding Topics)

Passthrough JSON from Exploding Topics / Algolia. 1 API credit per call regardless of the dashboard's own free-trend counter (`trends_searches_remaining` may also appear on browse).

| Method | Path | Body |
|---|---|---|
| POST | `/api/v1/trends/search` | `query` (omit to browse the feed; MCP alias `keyword`), `offset`, `category`, `timeframe`, `sorting`, `deduct` (browser only) |
| POST | `/api/v1/trends/detail` | `topic` (slug; alias `slug`), required |
| POST | `/api/v1/trends/autocomplete` | `keyword` (alias `query`), required |

Search response: `total` plus `result[]` of `{ keyword, path, description, absolute_volume, classifications { "3","6","12","24","60": "regular"|"exploding" }, categories[], date_added, search_history { last_12_months[], last_3_months[] … } }`. MCP sorts: `default`, `growth`, `gradient`, `exponent`, `absolute_volume`, `date_added`; timeframes `default`, `3`, `6`, `12`, `24` months.

---

## 15. Credits probe & ad transcripts

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/credits` | programmatic balance (costs 1) |
| GET | `/api/v1/ad-transcript` | stored transcript for an ad |
| POST | `/api/v1/ad-transcript-generate` | generate a transcript |
| POST | `/api/v1/ad-similar-script-generate` | generate a similar-ad script |

---

## 16. MCP surface

A Streamable-HTTP MCP server at `/mcp` exposes ~20 mostly read-only tools with the same key and the same monthly credit pool (1 credit per successful `tools/call`, 300 calls/min): `find_winning_products`, `search_facebook_ads`, `scan_ad`, `search_tiktok_products` / `_shops` / `_creators` / `_videos`, `get_tiktok_trending_products`, `search_shopify_stores`, `find_similar_stores_by_image`, `list_shopify_store_filter_options`, `list_tracked_brands`, `analyze_tracked_brand`, `track_brand`, `track_store`, `search_exploding_topics`, `creative_inspiration_pack`, `daily_radar`, and more.

Only `track_brand` and `track_store` write. TikTok Shop favorites, presets and transcripts are **not** on MCP — use REST.

---

## 17. Usage / resale terms

**The public docs state no licensing, resale, redistribution, caching or attribution terms.** The only constraints documented anywhere in `/docs` are commercial and technical:

- Key must sit on a **Basic plan or higher**; below Basic every call fails the credit check.
- Metering is per WinningHunter **account/team** ("per billing account"), and API keys are team keys — the docs do not describe a per-end-customer or reseller key model.
- 60 requests/min and the monthly credit pool are the only enforced ceilings; add-on packs are bought through a `purchase.url` returned on exhaustion.
- Much of the data is explicit passthrough from third parties (Exploding Topics / Algolia for trends, TikTok Shop v2 upstream for TikTok Shop, Meta ad library data for ads), so those upstream providers' own terms plausibly apply.

Before we resell or re-expose any of this inside FlySales, this must be confirmed in writing with WinningHunter — do not infer permission from the absence of a clause.

---

## 18. Integration notes for our gateway

If we ever swap or supplement SpyMarket's TrendTrack backend:

1. **Cost model inverts.** TrendTrack charges per returned row; WinningHunter charges per call. Our current per-row cost estimation and the "cost shown before firing" UI would become a flat "1 credit" chip, and page sizes should be maxed (`limit=50` on ads, `pageSize=250` on landers, `limit=48` on Google Ads) instead of minimized.
2. **No free typeahead or free usage.** Our Lookup and Usage tabs are free today; both become metered. Cache suggestions aggressively and derive remaining credits from our own `spymarket_usage_log` rather than probing `/api/v1/credits`.
3. **Cache TTLs.** Same discipline as the SEO module: ad/store searches are volatile (hours), brand analytics tabs and TikTok Shop detail aggregates are stable enough for a day, trends detail for a week.
4. **Two 429s.** The retry logic must branch on the `credits` object — retrying a credit-exhaustion 429 is pure waste.
5. **Field naming is dashboard-legacy.** `pageName`, `daysrunning`, `productid`, `urlStore` — no camel/snake consistency, and no `id` on Meta cards. Any shared ad type between the two providers needs an explicit mapper.
6. **Country semantics differ per surface.** Meta `countries` = ad-targeting market (400 on MX/CO/CL/AR/PE); `store_based_in` = store HQ; store explorer `country` = merchant country while `visitor_country_*` = traffic mix. Our single country picker cannot map to all three.
7. **Writes exist.** Follow/unfollow brands, track stores, saved-ad boards and lander favorites all mutate the WinningHunter account — a shared team key means every FlySales admin writes into the same tracker. Keep writes behind an explicit admin action, as with SpyMarket today.
