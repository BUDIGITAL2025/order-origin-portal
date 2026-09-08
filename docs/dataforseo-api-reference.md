# DataForSEO API v3 — practical reference for the FlySales SEO module

Source: `https://docs.dataforseo.com/v3/` plus the public pricing pages on `dataforseo.com/pricing/*` (fetched 2026-09-08). Base URL `https://api.dataforseo.com/v3`. Sandbox `https://sandbox.dataforseo.com/v3` (free, dummy data, mirrors every path, supports pingback/postback).

Pricing note: DataForSEO publishes prices per endpoint on dynamic pricing pages, and the authoritative per-account price table is the free `GET /v3/appendix/user_data` `price` object. Every dollar figure below is what the public pages stated on the fetch date — **read `user_data.price` at runtime rather than hardcoding costs**, exactly as the SpyMarket gateway learns TrendTrack's per-row price instead of assuming it.

## Table of contents

- [Capability map — FlySales feature → endpoint](#capability-map--flysales-feature--endpoint)
- [1. Fundamentals](#1-fundamentals)
  - [Authentication](#authentication)
  - [Response envelope](#response-envelope)
  - [Live vs Standard retrieval](#live-vs-standard-retrieval)
  - [Pingback / postback](#pingback--postback)
  - [Free endpoints](#free-endpoints)
  - [Rate limits](#rate-limits)
- [2. Phase 1 endpoints](#2-phase-1-endpoints)
- [3. Phase 2 endpoints](#3-phase-2-endpoints)
- [4. Phase 3 endpoints](#4-phase-3-endpoints)
- [5. Integration notes for our gateway](#5-integration-notes-for-our-gateway)

---

## Capability map — FlySales feature → endpoint

| Planned feature | Endpoint | Method | Batch limit | Cost basis (published) |
|---|---|---|---|---|
| Store SEO health score / domain overview | `/v3/dataforseo_labs/google/domain_rank_overview/live` | Live | 1 task/call, `limit` ≤1000 items | $0.012/request + $0.00012/item |
| Bulk traffic estimate for a client's domains | `/v3/dataforseo_labs/google/bulk_traffic_estimation/live` | Live | up to **1000 targets** per call | $0.12/task + $0.0012/domain |
| Keyword volume/CPC for product keywords | `/v3/keywords_data/google_ads/search_volume/live` (or `/task_post`) | Live or Task | **1000 keywords/task**; 100 tasks per task_post | Live $0.09/task, Standard $0.06/task — flat, regardless of keyword count |
| "What does this store already rank for" seeding | `/v3/keywords_data/google_ads/keywords_for_site/live` | Live | 1 target; returns up to 2000 suggestions | per request |
| Keyword expansion from seeds | `/v3/keywords_data/google_ads/keywords_for_keywords/live` | Live | **20 seed keywords**; up to 20k suggestions | per request |
| Live SERP snapshot / rank check for a keyword | `/v3/serp/google/organic/live/advanced` | Live | 1 keyword per call, `depth` ≤200 | per SERP (10 results); ×5 if the keyword uses search operators; add-ons below |
| Competitor discovery | `/v3/dataforseo_labs/google/competitors_domain/live` | Live | `limit` ≤1000, `offset` to paginate | $0.012/request + $0.00012/item (×2 with clickstream) |
| Full ranked-keyword export for a domain | `/v3/dataforseo_labs/google/ranked_keywords/live` | Live | `limit` ≤1000 | $0.012/request + $0.00012/item |
| Keyword gap (us vs competitor) | `/v3/dataforseo_labs/google/domain_intersection/live` | Live | `limit` ≤1000, 2 targets | $0.012/request + $0.00012/item (×2 with clickstream) |
| Backlink authority summary | `/v3/backlinks/summary/live` | Live | 1 target | per request |
| Backlink list | `/v3/backlinks/backlinks/live` | Live | `limit` ≤1000; `offset` ≤20 000 then `search_after_token` | $0.024/request + $0.000036/row |
| Referring domains | `/v3/backlinks/referring_domains/live` | Live | `limit` ≤1000 | per request + per row |
| Anchor text profile | `/v3/backlinks/anchors/live` | Live | `limit` ≤1000 | per request + per row |
| Full site audit (crawl) | `/v3/on_page/task_post` → `summary/$id` → `pages` | Task (async) | 100 tasks/POST; `max_crawl_pages` sets scope | $0.00015/crawled page basic; JS/rendering multiply (see below) |
| Single-page audit, no crawl | `/v3/on_page/instant_pages` | Live | ≤20 tasks/request, ≤5 same-domain | $0.00015/page |
| Page screenshot for reports | `/v3/on_page/page_screenshot` | Live | ≤20 tasks/request | $0.0048/page |
| Seasonality / demand trend for a product | `/v3/keywords_data/google_trends/explore/live` (or `/task_post`) | Live or Task | **5 keywords/task** | Live $0.011/task, Standard $0.0027/task — flat per task |
| Account balance & price table | `/v3/appendix/user_data` | GET | — | **free** (6 req/min) |
| Location/language pickers | `/v3/<family>/locations`, `/languages` | GET | — | **free** |
| Task collection | `/v3/<family>/tasks_ready`, `task_get` | GET | — | **free** (posting was already billed) |

---

## 1. Fundamentals

### Authentication

HTTP **Basic** only — there is no token endpoint and credentials may never be passed as URL params.

```
Authorization: Basic base64(login:password)
```

- `login` and `password` come from the account's API access page. The **API password is auto-generated and is not the dashboard password**.
- Same credentials work against the sandbox host.

### Response envelope

Every response — success or failure — is HTTP `200` in almost all cases; the real state lives in the JSON.

Top level: `version`, `status_code`, `status_message`, `time`, `cost` (USD for the whole request), `tasks_count`, `tasks_error`, `tasks[]`.

Per task: `id` (UUID), `status_code`, `status_message`, `time`, `cost`, `result_count`, `path[]`, `data{}` (echo of what we sent), `result[]` (null on error).

Rules for our gateway: check top-level `status_code === 20000`, then **each task's own** `status_code`. Task codes ≥ 40000 mean `result` is null. `20100` = "Task Created" (queued, not an error).

HTTP codes that do appear: `401` bad credentials, `402` billing problem, `404` unknown path, `500` internal.

Useful internal codes: `20000` ok · `20100` task created · `40000` more than one task on a Live endpoint · `40006` more than 100 tasks in one POST · `40100` unauthorized. Full list: free `GET /v3/appendix/errors`.

### Live vs Standard retrieval

**Live** — `POST /v3/<...>/live/<type>`; synchronous, result in the same response, one task per call. Costs more per task and, for a few families (Google Ads, Trends), is much more tightly rate-limited.

**Standard** — asynchronous queue:

1. `POST /v3/<family>/<engine>/task_post` — up to **100 tasks per call**. **Billed here**, at post time.
2. Wait. Delivery is either pushed (pingback/postback) or polled.
3. `GET /v3/<family>/<engine>/tasks_ready` — free list of finished, uncollected task ids.
4. `GET /v3/<family>/<engine>/task_get/<type>/$id` — free retrieval, available for **30 days** after completion.

`priority` in the task_post body: `1` = normal (default), `2` = high (faster, costs more). Some endpoints also expose a cheaper `priority_low` tier in the price table.

### Pingback / postback

Set on `task_post`, both support `$id` and (URL-encoded) `$tag` template variables:

- `pingback_url` — DataForSEO sends a **GET** to the URL when the task finishes. No payload; we then call `task_get`.
- `postback_url` — DataForSEO sends a **POST** with the results, **gzip-compressed**.
- `postback_data` — **required** whenever `postback_url` is set. Values: `regular`, `advanced`, `html` (must match the task_get variant).

Failure recovery: `GET /v3/appendix/api_errors` lists task ids whose webhook delivery failed in the last 7 days; `POST /v3/appendix/webhook_resend` re-sends them.

For us this maps onto the existing public-route pattern: a handler under `src/routes/api/public/seo/dataforseo-pingback` that verifies a shared secret in the query string, then pulls the task via `task_get`.

### Free endpoints

| Endpoint | Returns | Limit |
|---|---|---|
| `GET /v3/appendix/user_data` | `money.balance` / `money.total`, `rates.limits` + `rates.statistics` (calls per minute/day per function), and the full **`price`** table: `api → func → priority_normal\|priority_high\|priority_low → {cost_type, cost}` where `cost_type` is `per_request` or `per_result` | 6 req/min |
| `GET /v3/appendix/status` | API/system status, 60-day history | 10 req/min |
| `GET /v3/appendix/errors` | Every possible status code/message | 10 req/min |
| `GET /v3/<family>/locations`, `/languages` (or `/locations_and_languages`) | Valid `location_code` / `language_code` values, per engine family | free |
| `GET /v3/<family>/tasks_ready` | Finished, uncollected task ids | 20 req/min |
| `task_get/...` | The results themselves (posting was billed) | 30-day window |

The `price` object gives only the **base** cost of a call — paid optional parameters (browser rendering, PAA click depth, clickstream) are excluded from it.

### Rate limits

- **General: 2000 API calls/minute** across the API (raisable via support).
- **≤100 tasks per `task_post`** call; exceeding it returns `40006`. Most Live endpoints accept only one task per call.
- **≤30 simultaneous in-flight requests** for the database-backed families: DataForSEO Labs, Backlinks, OnPage, Content Analysis, Trends. Exceeding it errors with "too many simultaneous requests". With ~1s responses that ceiling is ~1800 req/min in practice.
- **Live Google Ads endpoints (Keywords Data): 12 requests/minute per account.** This is the hard constraint for Phase 1 — anything above a handful of keyword lookups per minute must go through `task_post`.
- **Live Google Trends explore: 250 live tasks/minute system-wide across all customers** (not per-account), plus a **500k requests/day** system-wide cap across Trends endpoints. Treat live Trends as best-effort; prefer Standard.
- `user_data` 6/min · `appendix/status` and `appendix/errors` 10/min · `tasks_ready` 20/min.
- OnPage `instant_pages`, `page_screenshot` and content parsing: **≤20 tasks per request**, and `instant_pages` allows **≤5 URLs from the same domain** per request.

---

## 2. Phase 1 endpoints

### `POST /v3/dataforseo_labs/google/domain_rank_overview/live`

Ranking distribution and traffic value for **one** domain, organic and paid.

Params: `target` (required, bare domain — no scheme, no `www.`), `location_name`|`location_code`, `language_name`|`language_code`, `ignore_synonyms` (default `false`), `limit` (default 100, max 1000), `offset`, `tag`.

Result `items[]`: `se_type`, `location_code`, `language_code`, and `metrics.organic` / `metrics.paid` each with `pos_1`, `pos_2_3`, `pos_4_10`, `pos_11_20` … `pos_91_100`, `etv` (estimated traffic value), `count`, `estimated_paid_traffic_cost`, `is_new`, `is_up`, `is_down`, `is_lost`. Result level also carries `total_count`, `items_count`.

Cost: $0.012/request + $0.00012/item.

Sibling endpoints in the same family: **Bulk Traffic Estimation** (`/v3/dataforseo_labs/google/bulk_traffic_estimation/live` — `targets[]` up to 1000, `item_types` default `["organic","paid"]`, returns `metrics.*.{etv,count}` per target; $0.12/task + $0.0012/domain) and **Historical Rank Overview**. There is no endpoint literally named `domain_metrics_overview`.

### `POST /v3/keywords_data/google_ads/search_volume/live` (and `/task_post`)

Shared Google Ads params across all three keyword endpoints: `location_name`|`location_code`|`location_coordinate` (worldwide if omitted), `language_name`|`language_code`, `search_partners` (default `false`), `date_from` / `date_to` (`yyyy-mm-dd`; up to 4 years back; default last 12 months, `date_to` defaults to yesterday), `include_adult_keywords` (default `false`), `sort_by` (`relevance` default, `search_volume`, `competition_index`, `low_top_of_page_bid`, `high_top_of_page_bid`), `tag`.

`search_volume` specifics: `keywords[]` required, **max 1000 per task**, ≤80 chars each, ≤10 words each, auto-lowercased. Price is per task, so a 1000-keyword batch costs the same as a 1-keyword one — **always batch to 1000**.

Result items: `keyword`, `spell`, `search_partners`, `competition` (`LOW`/`MEDIUM`/`HIGH`), `competition_index` (int), `search_volume`, `cpc`, `low_top_of_page_bid`, `high_top_of_page_bid`, `monthly_searches[]` (`year`, `month`, `search_volume`).

Cost: Live $0.09/task · Standard `task_post` $0.06/task.

### `POST /v3/keywords_data/google_ads/keywords_for_site/live`

Params: shared set, plus `target` (required — domain or page URL) and `target_type` (`site` | `page`, default `page`). Returns up to **2000 suggestions**, billed per request. Item schema identical to `search_volume`.

### `POST /v3/keywords_data/google_ads/keywords_for_keywords/live`

Params: shared set, plus `keywords[]` required, **max 20 seed keywords**. Can return up to 20 000 suggestions. Item schema identical to `search_volume`.

All three Live variants share the **12 requests/minute** account cap.

### `POST /v3/serp/google/organic/live/advanced`

Params: `keyword` (required, ≤700 chars — **using operators such as `site:`, `inurl:`, `intitle:`, `filetype:` multiplies the task charge ×5**), `location_code`|`location_name` (one required), `language_code`|`language_name`, `depth` (default 10, max 200 — billed per SERP of 10), `device` (`desktop` default | `mobile`), `os` (`windows`/`macos`, or `android`/`ios`), `se_domain`, `group_organic_results` (default `true`), `max_crawl_pages` (≤100, billed per page), `stop_crawl_on_match[]` (≤10), `search_param`, `remove_from_url[]` (≤10), `location_coordinate` (`"lat,long,radius"`), `tag`.

Paid add-ons: `load_async_ai_overview` (+$0.002, refunded when no AI Overview element exists), `people_also_ask_click_depth` 1–4 (+$0.00015 per click), `calculate_rectangles` (+$0.002; enables `browser_screen_width`/`height`/`resolution_ratio`).

Result: `item_types[]` (which SERP features are present), `se_domain`, `check_url`, `se_results_count`, `items[]` — each with `type` (`organic`, `paid`, `featured_snippet`, `people_also_ask`, `ai_overview`, `local_pack`, `answer_box`, `top_stories`, `video`, `carousel`, `related_searches`, …), `rank_group` (position within its own type) and `rank_absolute` (position across all items).

Cost: per SERP request, published from $0.0006; exact figure varies by method/priority/depth — read it from `user_data.price`.

---

## 3. Phase 2 endpoints

Labs endpoints below are Live-only, data refreshed weekly, share the 2000 req/min and ≤30 concurrent limits, and cap `limit` at **1000** items (paginate with `offset`). `filters` accepts **max 8** conditions; `order_by` **max 3** rules. `include_clickstream_data: true` **doubles** the request cost.

### `POST /v3/dataforseo_labs/google/competitors_domain/live`

Params: `target` (required), location + language (one of each required), `item_types` (default `["organic","paid"]`, plus `featured_snippet`, `local_pack`), `include_clickstream_data`, `filters` (operators `regex`, `not_regex`, `<`, `<=`, `>`, `>=`, `=`, `<>`, `in`, `not_in`), `order_by` (default `["metrics.organic.count,desc"]`), `limit`, `offset`, `max_rank_group` (default 100), `exclude_top_domains`, `exclude_domains[]` (≤1000), `intersecting_domains[]` (≤20), `ignore_synonyms`, `tag`.

Items: `domain`, `avg_position`, `sum_position`, `intersections`, `full_domain_metrics.organic.*` / `.paid.*` (same `pos_*`/`etv`/`count`/`estimated_paid_traffic_cost`/`is_*` shape as domain_rank_overview), plus `clickstream_etv`, `clickstream_gender_distribution`, `clickstream_age_distribution` when clickstream is on.

### `POST /v3/dataforseo_labs/google/ranked_keywords/live`

Params: `target` (required — domain, subdomain or page URL), location + language, `item_types`, `ignore_synonyms`, `include_clickstream_data`, `filters`, `order_by`, `limit`, `offset`, `tag`.

Result: `target`, `total_count`, `items_count`, `items[]` — each combining `keyword_data` (search volume, cpc, competition …) with `ranked_serp_element` (position, SERP item snapshot, ETV contribution).

### `POST /v3/dataforseo_labs/google/domain_intersection/live` — keyword gap

Params: `target1` and `target2` (both required), location + language (one each required), `intersections` (default `true` → keywords where **both** rank in the same SERP; `false` → keywords where `target1` ranks and `target2` doesn't), `item_types`, `include_serp_info`, `include_clickstream_data`, `limit`, `offset`, `filters` (extra operators here: `match`, `not_match`, `like`, `not_like`, `ilike`, `not_ilike`), `order_by` (default `["keyword_data.keyword_info.search_volume,desc"]`), `tag`.

Items: `keyword_data`, `first_domain_serp_element` and `second_domain_serp_element` (each `type`, `rank_group`, `rank_absolute`, `etv`, `description`), optional `serp_info`.

Cost for all three: **$0.012/task + $0.00012/item**; ×2 with clickstream.

### Backlinks API

All Live, one task per call, ≤30 concurrent. `rank_scale` (`one_hundred` | `one_thousand`, default `one_thousand`) applies everywhere. `target` is a domain/subdomain without scheme or `www.`, or an absolute page URL.

**`POST /v3/backlinks/summary/live`** — `target` (required), `include_subdomains` (default `true`), `include_indirect_links` (default `true`), `exclude_internal_backlinks` (default `true`), `internal_list_limit` (default 10, max 1000 — caps the breakdown arrays), `backlinks_status_type` (`all` | `live` default | `lost`), `backlinks_filters`, `tag`.
Result: `target`, `first_seen`, `lost_date`, `rank`, `backlinks`, `backlinks_spam_score`, `crawled_pages`, `info{server, cms, platform_type, ip_address, country, is_ip, target_spam_score}`, `internal_links_count`, `external_links_count`, `broken_backlinks`, `broken_pages`, `referring_domains`, `referring_domains_nofollow`, `referring_main_domains(_nofollow)`, `referring_ips`, `referring_subnets`, `referring_pages(_nofollow)`, and the distribution objects `referring_links_tld` / `_types` / `_attributes` / `_platform_types` / `_semantic_locations` / `_countries`. Billed per request.

**`POST /v3/backlinks/backlinks/live`** — `target` (required), `mode` (`as_is` default | `one_per_domain` | `one_per_anchor`), `custom_mode` (`{field, value}`, overrides `mode`), `filters` (≤8; operators `=`, `<>`, `in`, `not_in`, `like`, `not_like`, `ilike`, `not_ilike`, `regex`, `not_regex`, `match`, `not_match`), `order_by` (≤3), `limit` (default 100, max 1000), `offset` (max 20 000 — beyond that use `search_after_token`), `backlinks_status_type`, `include_subdomains`, `exclude_internal_backlinks`, `rank_scale`, `tag`.
Items: `domain_from`, `url_from`, `domain_to`, `url_to`, `tld_from`, `is_new`, `is_lost`, `backlink_spam_score`, `rank`, `page_from_rank`, `domain_from_rank`, `domain_from_platform_type`, `domain_from_country`, `page_from_title`, `page_from_language`, `page_from_status_code`, `first_seen`, `prev_seen`, `last_seen`, `item_type` (`anchor`/`image`/`meta`/`canonical`/`alternate`/`redirect`), `attributes[]` (e.g. `nofollow`), `dofollow`, `anchor`, `text_pre`, `text_post`, `semantic_location`, `links_count`, `is_broken`, `url_to_status_code`, `url_to_spam_score`, `ranked_keywords_info{page_from_keywords_count_top_3/10/100}`, `is_indirect_link`, `indirect_link_path[]`.
Cost: **$0.024/request + $0.000036/row** (≈$0.06 for a 1000-row task).

**`POST /v3/backlinks/referring_domains/live`** — same param family (`limit` ≤1000, `offset`, `internal_list_limit`, `backlinks_status_type`, `filters`, `order_by`, `backlinks_filters`, `include_subdomains`, `include_indirect_links`, `exclude_internal_backlinks`).
Items: `domain`, `rank`, `backlinks`, `first_seen`, `lost_date`, `backlinks_spam_score`, `broken_backlinks`, `broken_pages`, `referring_domains(_nofollow)`, `referring_main_domains(_nofollow)`, `referring_ips`, `referring_subnets`, `referring_pages`, plus the same `referring_links_*` distributions.

**`POST /v3/backlinks/anchors/live`** — same params.
Items: `anchor`, `rank`, `backlinks`, `first_seen`, `lost_date`, `backlinks_spam_score`, `broken_backlinks`, `broken_pages`, `referring_domains(_nofollow)`, `referring_main_domains(_nofollow)`, `referring_ips`, `referring_subnets`, `referring_pages(_nofollow)`, `referring_links_*`.

Cost basis across the Backlinks family: per request **plus** per returned row — so `limit` directly drives spend.

---

## 4. Phase 3 endpoints

### OnPage — the async crawl flow

```
POST /v3/on_page/task_post          → task id (billed here, per crawled page)
   ↓ (pingback_url GET, or poll GET /v3/on_page/tasks_ready)
GET  /v3/on_page/summary/$id        → crawl_progress, aggregate checks   (free)
POST /v3/on_page/pages              → per-page items                     (free, 30 days)
```

**`task_post`** key params: `target` (required, domain), `max_crawl_pages` (required — this is the cost lever), `start_url`, `max_crawl_depth`, `crawl_delay` (default 2000 ms), `priority_urls[]` (≤20), `respect_sitemap` (default `false`), `custom_sitemap`, `crawl_sitemap_only`, `store_raw_html`, `enable_content_parsing`, `support_cookies`, `accept_language`, `custom_robots_txt` + `robots_txt_merge_mode` (`merge`/`override`), `custom_user_agent`, `browser_preset` (`desktop`/`mobile`/`tablet`), `browser_screen_width`/`height` (240–9999) / `scale_factor` (0.5–3), `load_resources` (extra cost), `enable_javascript` (extra cost), `enable_xhr` (needs JS), `enable_browser_rendering` (needs JS + `load_resources`; yields Core Web Vitals; extra cost), `disable_cookie_popup`, `custom_js` (≤2000 chars, ≤700 ms), `validate_micromarkup`, `allow_subdomains` / `allowed_subdomains` / `disallowed_subdomains`, `check_spell` (+ `check_spell_language`, `check_spell_exceptions`), `calculate_keyword_density` (extra cost), `checks_threshold{}` (e.g. `high_loading_time` default 3000 ms, `large_page_size` default 1 MB, `title_too_short`), `disable_sitewide_checks[]`, `disable_page_checks[]`, `switch_pool`, `return_despite_timeout`, `tag`, `pingback_url`.
`result` is `null` on task_post — results are fetched separately.

**`GET /v3/on_page/summary/$id`** — `crawl_progress` (`in_progress` | `finished`), `crawl_status{max_crawl_pages, pages_in_queue, pages_crawled}`, `domain_info{}`, `page_metrics{}`, `checks{}` (aggregated issue counts). **Free** — only the task post is billed. Poll this for a progress bar.

**`POST /v3/on_page/pages`** — `id` (required), `limit` (default 100, max 1000), `offset` (max 2 000 000), `filters` (≤8), `order_by` (≤3), `search_after_token` (beyond 20 000 results), `tag`. Returns `crawl_progress`, `crawl_status`, `total_items_count`, `items[]` with `url`, `status_code`, `resource_type`, `meta{title, title_length, description, description_length, canonical, htags, favicon, charset, follow, internal/external/inbound_links_count, images_count/size, scripts_count/size, stylesheets_count/size, render_blocking_*, cumulative_layout_shift, content{plain_text_size, plain_text_rate, plain_text_word_count, readability indices}}`, `page_timing`, and a `checks{}` object with 60+ boolean on-page flags. Free within 30 days.

**`GET /v3/on_page/tasks_ready`** — up to 20 calls/min; each returns up to 1000 tasks finished in the previous **3 days** (uncollected only — tasks not collected within 3 days drop off the list). Items: `id`, `target`, `date_posted`, `tag`.

**`POST /v3/on_page/instant_pages`** — Live single-page audit, no task lifecycle. Params: `url` (required, absolute), `custom_user_agent`, `browser_preset`, `browser_screen_*`, `store_raw_html`, `accept_language`, `load_resources`, `enable_javascript`, `enable_xhr`, `enable_browser_rendering`, `disable_cookie_popup`, `custom_js`, `validate_micromarkup`, `check_spell`, `checks_threshold`, `switch_pool`, `ip_pool_for_scan` (`us`/`de`), `return_despite_timeout`. Limits: ≤20 tasks/request, ≤5 URLs from the same domain.

**`POST /v3/on_page/page_screenshot`** — `url` (required), `full_page_screenshot` (default `true`), `browser_preset`, `browser_screen_*`, `accept_language`, `custom_user_agent`, `disable_cookie_popup`, `switch_pool`, `ip_pool_for_scan`. Browser rendering, JavaScript, resources and XHR are always on here. ≤20 tasks/request.

OnPage published pricing (per page):

| Mode | Price/page |
|---|---|
| Basic crawl | $0.00015 ($0.15 / 1000 pages) |
| + `load_resources` | $0.00045 |
| + `enable_javascript` | $0.0015 |
| + `enable_browser_rendering` (implies JS + resources) | $0.0051 |
| + `calculate_keyword_density` | $0.0003 |
| Instant Pages | $0.00015 |
| Page Screenshot | $0.0048 |
| Content Parsing (live) | $0.00015 |

**Pingback**: set `pingback_url` on task_post; DataForSEO sends a GET on completion with `$id`/`$tag` substituted. Preferred over polling `tasks_ready`.

### Google Trends — `POST /v3/keywords_data/google_trends/explore/live` (and `/task_post`)

Params: `keywords[]` required, **max 5** (≤100 chars each; commas stripped; the characters `| " - + = ~ ! : * ( ) [ ] { }` are forbidden; only **1** keyword is allowed when requesting `google_trends_topics_list` or `google_trends_queries_list`), `location_name`|`location_code` (global if omitted; may be arrays mapped per keyword), `language_name`|`language_code` (default `en`), `type` (`web` default, `news`, `youtube`, `images`, `froogle`), `category_code` (default 0 = all), `date_from`/`date_to` (`yyyy-mm-dd`; earliest `2004-01-01` for web, `2008-01-01` otherwise; default last year), `time_range` (`past_hour`, `past_4_hours`, `past_day`, `past_7_days`, `past_30_days`, `past_90_days`, `past_12_months`, `past_5_years`, `2004_present`/`2008_present`; ignored when explicit dates are set), `item_types[]` (default `["google_trends_graph"]`; also `google_trends_map`, `google_trends_topics_list`, `google_trends_queries_list` — request one at a time), `tag`. `task_post` adds `postback_url`/`postback_data` and `pingback_url`.

Result: `keywords`, `location_code`, `language_code`, `check_url`, `datetime`, `items[]`:
- `google_trends_graph_element_in_google_trends` — `data[]{date_from, date_to, timestamp, missing_data, values[]}` (0–100 index), `averages[]`
- `google_trends_map_element_in_google_trends` — `data[]{geo_id, geo_name, values[], max_value_index}`
- `google_trends_topics_list_element_in_google_trends` — `data{top[]{topic_id, topic_title, topic_type, value}, rising[]}`
- `google_trends_queries_list_element_in_google_trends` — `data{top[]{query, value}, rising[]{query, value}}`

Cost: Standard queue $0.0027/task (~45 min turnaround) · Live $0.011/task (~32 s). Flat per task, 1–5 keywords the same price — always pack 5 keywords.

Rate reality check: Live explore is capped at **250 tasks/minute across all DataForSEO customers** and Trends overall at 500k requests/day system-wide. Any batch job must use `task_post`.

---

## 5. Integration notes for our gateway

Mirroring the SpyMarket gateway (`src/lib/spymarket-tools.server.ts`), a DataForSEO gateway should:

1. **Single call path.** One server-only function performing Basic auth, envelope validation (top-level then per-task `status_code`), cost capture from `tasks[].cost`, cache write and usage logging. The browser never talks to DataForSEO.
2. **Learn the price, never assume it.** Costs are `per_request` or `per_result` depending on endpoint and change with parameters. Read `tasks[].cost` from each response and reconcile against the free `GET /v3/appendix/user_data` `price` table rather than hardcoding the figures above.
3. **Cache aggressively.** Labs data refreshes weekly and backlink data is not real-time — a 24h (or 7-day for Labs) response cache removes most repeat spend. SERP and Trends are the only genuinely time-sensitive calls.
4. **Batch to the documented ceiling.** `search_volume` is billed per task for up to 1000 keywords, Trends per task for up to 5, `bulk_traffic_estimation` per task for up to 1000 targets. Not batching multiplies cost linearly with no benefit.
5. **Respect the two hard throttles**: 12 Live Google Ads requests/minute per account, and ≤30 simultaneous requests to Labs/Backlinks/OnPage/Trends. Both need a queue, not retries.
6. **Async only for OnPage and bulk keyword work.** Route those through `task_post` + `pingback_url` into a public route under `src/routes/api/public/`, verifying a shared secret in the handler, then collect with `task_get`. Keep `tasks_ready` polling only as the recovery path — OnPage tasks disappear from that list after 3 days.
7. **Guard the cost levers explicitly** in any admin UI: `max_crawl_pages`, `limit` on Backlinks/Labs, `depth` on SERP, `include_clickstream_data`, `enable_browser_rendering`, `load_async_ai_overview`, `people_also_ask_click_depth`, and keywords containing search operators (×5 charge).
8. **Sandbox first.** `https://sandbox.dataforseo.com/v3/<same path>` is free and exercises the full task/pingback lifecycle with dummy data — use it for integration tests.
