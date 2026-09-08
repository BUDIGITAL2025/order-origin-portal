# Pipeboard Ads MCP — API Reference (FlySales Ads module)

Source of truth for building the FlySales Ads module on Pipeboard's hosted MCP servers.
Compiled 2026-09-08 from: `https://pipeboard.co/llms.txt`, `/guides/meta-ads-mcp`,
`/guides/meta-ads-mcp-server` (API reference), `/guides/google-ads-mcp-api`,
`/guides/api-token-permissions`, `/pricing`, `/blog/unlimited-commands-and-account-slots`,
plus live probes of `meta-ads.mcp.pipeboard.co`.

Anything marked **[unverified]** is not documented publicly and must be confirmed by a live
`tools/list` call once we hold a token. Pipeboard does not publish per-tool JSON Schemas on the
website — the authoritative schemas come from `tools/list` on the server itself.

---

## 1. Authentication

### 1.1 Token

Pipeboard issues API tokens at `https://pipeboard.co/api-tokens` (prefix `pipeboard_...`).
Two accepted transports, per the server's own 401 body:

```
Authorization: Bearer pipeboard_xxx           # preferred, server-to-server
https://meta-ads.mcp.pipeboard.co/?token=...  # fallback for clients without custom headers
```

Unauthenticated request (verified live):

```
HTTP/2 401
www-authenticate: Bearer realm="MCP", resource_metadata="https://meta-ads.mcp.pipeboard.co/.well-known/oauth-protected-resource?platform=meta-ads"
{"error":"invalid_token","error_description":"Missing or invalid access token. Provide via Authorization header or ?token= query parameter"}
```

The servers also advertise OAuth 2.1 protected-resource metadata (scopes `mcp:read`, `mcp:write`,
dynamic registration at `https://pipeboard.co/oauth/register?platform=<platform>`). That path exists
for chat clients doing browser auth. **For FlySales, use a static API token stored as a secret** —
no OAuth dance from our server functions.

FlySales storage: one secret, e.g. `PIPEBOARD_API_TOKEN`, read inside the handler only. The browser
never sees the token or the MCP URLs (same rule as the middleware integration).

### 1.2 How ad accounts get connected

Connection happens on Pipeboard's side, not ours:

1. Sign up at `pipeboard.co/auth/signup`.
2. Connect the Meta / Google Ads account at `pipeboard.co/connections` (OAuth with the ad platform;
   Pipeboard is a badged Meta Business Partner and runs Google Ads on Standard Access — no developer
   token needed from us).
3. Everything the token's Pipeboard user can reach is then reachable through the MCP servers.

Consequence for FlySales: **there is no API to connect a client's ad account.** A client either
grants access to our Pipeboard-connected Business Manager / MCC, or we onboard their account into
our Pipeboard workspace manually. Design the dashboard around "accounts already connected".

### 1.3 Token permissions (access control)

- **Read-only tokens** — view campaigns/ad sets/ads, pull insights, list accounts, view creatives.
  Cannot create, update, pause, duplicate, upload or delete. **Pro plan and above.**
- **Custom tool scoping** — pick exactly which tools a token may call (e.g. a reporting token limited
  to `get_campaigns`, `get_adsets`, `get_ads`, `get_insights`, `get_ad_creatives`, `get_account_info`).
  **Pro+.**
- **Per-account scoping** — restrict a token to specific `act_` ids. **Agency plan.**

FlySales Ads is read-only: mint a **read-only, tool-scoped token** and never store a write-capable one.

### 1.4 Account slots

Pipeboard meters **connected ad accounts**, not calls. Each account the assistant touches occupies a
*slot*; a new account auto-claims a free slot when one is available, otherwise it is blocked
(hard enforcement since July 2026). Slots are managed at Settings → Slots; extra slots cost
**$10/month each**. On Premium/Enterprise slots are pooled across the team.

### 1.5 Plans and what is premium

| | Free | Pro $29.90/mo | Premium $99/mo | Agency $199/mo |
|---|---|---|---|---|
| Weekly AI tool executions | **30** | Unlimited | Unlimited | Unlimited |
| Ad account slots | 2 | 3 | 10 | 25 |
| API access | yes | yes | yes | yes |
| Permission-scoped tokens | — | yes | yes | yes |
| Per-account token scoping | — | — | — | yes |
| Campaign / ad set / ad / creative duplication | — | yes | yes | yes |
| Bulk operations | — | — | yes | yes |
| Carousel ads | — | yes | yes | yes |
| Batch creative upload | 10/batch | 10/batch | 100/batch | 100/batch |
| Team accounts | — | — | 5 | unlimited |

Annual billing saves 17%. 7-day trial on Pro/Premium.

**Premium-only tools** (paid plans): `duplicate_campaign`, `duplicate_adset`, `duplicate_ad`,
`duplicate_creative`, plus bulk operations on Premium+. None of these are read tools — **every tool
the FlySales dashboard needs is available on the Free plan**, subject to the 30 executions/week cap
and 2 account slots. `bulk_get_insights` is remote-MCP-only (not in the open-source GitHub build);
plan gating **[unverified]**.

---

## 2. Protocol — calling an MCP server over HTTP

Endpoints (Streamable HTTP MCP, POST to the root path):

- `https://meta-ads.mcp.pipeboard.co/`
- `https://google-ads.mcp.pipeboard.co/`
- others: `tiktok-ads`, `snap-ads`, `reddit-ads`, `google-analytics`, `google-merchant`
  `.mcp.pipeboard.co`

Required headers:

```
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer $PIPEBOARD_API_TOKEN
MCP-Protocol-Version: 2025-06-18        # echo the version returned by initialize
```

`Accept` must list **both** JSON and SSE — Streamable HTTP servers reject POSTs otherwise (406).
Responses may come back as an SSE stream (`text/event-stream`); parse `data:` lines when the
content-type is SSE, plain JSON otherwise.

### 2.1 initialize

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":"2025-06-18",
  "capabilities":{},
  "clientInfo":{"name":"flysales-ads","version":"1.0.0"}}}
```

The response may carry an `Mcp-Session-Id` header; if present, send it back on every subsequent
request as `Mcp-Session-Id: <value>`. Follow with the notification (no `id`, expect `202`):

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

Pipeboard's docs show a bare `tools/call` with no prior `initialize` working over curl, so the
handshake appears optional here — implement it anyway and tolerate its absence.

### 2.2 tools/list

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

Returns `result.tools[] = { name, description, inputSchema }`. **Run this once per server and commit
the output** — it is the only authoritative schema source. Paginate via `result.nextCursor` →
`params.cursor`.

### 2.3 tools/call

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name":"get_insights",
  "arguments":{"object_id":"act_123456789","time_range":"last_30d","level":"campaign"}}}
```

Result shape:

```json
{"jsonrpc":"2.0","id":3,"result":{
  "content":[{"type":"text","text":"{ ...JSON payload as a string... }"}],
  "isError":false}}
```

MCP tool results are **content blocks**, usually a single `text` block containing JSON. Our client
must `JSON.parse` that inner text and validate it with Zod. Two distinct failure classes:

- transport/protocol errors → top-level `"error": {code, message}`
- tool errors (bad account id, Meta API failure) → `result.isError === true`, message inside `content`

Verified curl from Pipeboard's docs:

```bash
curl -X POST https://meta-ads.mcp.pipeboard.co/ \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $PIPEBOARD_API_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"get_ad_accounts","arguments":{}}}'
```

### 2.4 FlySales gateway pattern

Mirror the `wh-gateway` discipline already live in SpyMarket:

- one server-side `pipeboardCall(server, tool, args)` helper; browser never calls Pipeboard
- 30s timeout, single retry on 429/5xx with backoff
- every call logged (server, tool, args hash, duration, ok/error) in an `ads_api_calls` table
- 24h cache keyed by `(server, tool, canonical args)`; cached repeats are free and must be labelled
- nothing fires without an explicit user action

---

## 3. Tools for a read-only insights dashboard

Input-schema fields below are the documented/observed names; **argument names and enums must be
confirmed against `tools/list`** before coding. Treat this section as a shopping list, not a contract.

### 3.1 Meta — `meta-ads.mcp.pipeboard.co` (30+ tools)

**Accounts**

| Tool | Purpose | Arguments |
|---|---|---|
| `get_ad_accounts` | all ad accounts the token can reach, with details | `{}` (optionally `limit`) |
| `get_account_info` | one account: status, currency, timezone, spend caps | `{ account_id: "act_123..." }` |
| `get_account_pages` | Facebook pages tied to the account | `{ account_id }` |

`list_meta_connections` is **not** a documented tool name **[unverified]** — the connection list lives
in the Pipeboard web app. Use `get_ad_accounts` as the account discovery entry point.

**Hierarchy**

| Tool | Purpose | Arguments |
|---|---|---|
| `get_campaigns` | campaigns, filterable by status and objective (`OUTCOME_SALES`, `OUTCOME_LEADS`, `OUTCOME_TRAFFIC`, …) | `{ account_id, status?, objective?, limit? }` |
| `get_campaign_details` | one campaign in full | `{ campaign_id }` |
| `get_adsets` | ad sets, optionally filtered by campaign | `{ account_id?, campaign_id?, limit? }` |
| `get_adset_details` | one ad set (targeting, budget, schedule) | `{ adset_id }` |
| `get_ads` | ads, filtered by campaign or ad set | `{ account_id?, campaign_id?, adset_id?, limit? }` |
| `get_ad_details` | one ad | `{ ad_id }` |

**Insights**

| Tool | Purpose | Arguments |
|---|---|---|
| `get_insights` | performance for an account, campaign, ad set or ad | `{ object_id, time_range?, level?, breakdown?, ... }` |
| `bulk_get_insights` | same metrics across **all** accounts in one call; 3–5s, smart-cached; remote MCP only | `{ time_range? }` |

- `object_id` accepts `act_…`, campaign, ad set or ad id — the level of the object determines scope.
- `time_range` presets documented: `today`, `last_7d`, `last_30d`, "and more" — expect the Meta
  `date_preset` vocabulary (`yesterday`, `last_14d`, `last_90d`, `this_month`, `last_month`,
  `maximum`) plus a custom `{since, until}` form **[unverified]**.
- `level`: `account` | `campaign` | `adset` | `ad` **[unverified enum]**.
- `breakdown`: `age`, `gender`, `country`, `region`, `publisher_platform`, `platform_position`,
  `impression_device`, `device_platform` — Meta's breakdown vocabulary; docs name "age, gender,
  platform, etc.".
- Metrics returned (documented for `bulk_get_insights`, same family for `get_insights`):
  **spend, impressions, clicks, CTR, CPC, CPM, reach, conversions**. Frequency, actions/action_values
  and purchase ROAS come from Meta's `actions` / `action_values` / `purchase_roas` arrays — expose
  purchases and ROAS in our UI only after confirming these fields appear in a live payload
  **[unverified]**. If ROAS is absent, derive it: `purchase_value / spend`.

**Creatives**

| Tool | Purpose | Arguments |
|---|---|---|
| `get_ad_creatives` | creative details for an ad (copy, headline, CTA, image/video refs) | `{ ad_id }` |
| `get_ad_image` | download / visualise the ad image | `{ ad_id }` or `{ image_hash }` |

`get_ad_previews` is **not** in Pipeboard's published tool list **[unverified]** — plan the creative
gallery on `get_ad_creatives` + `get_ad_image`, and check `tools/list` for a preview tool before
promising rendered previews.

**Not needed for the dashboard** (write/premium): `create_*`, `update_*`, `upload_ad_image`,
`duplicate_*`, `create_budget_schedule`, and the targeting-research family (`search_interests`,
`get_interest_suggestions`, `estimate_audience_size`, `search_behaviors`, `search_demographics`,
`search_geo_locations`).

### 3.2 Google Ads — `google-ads.mcp.pipeboard.co` (35+ tools)

| Tool | Purpose | Notes |
|---|---|---|
| `list_google_ads_customers` | all customer accounts the token can reach | account discovery |
| `get_google_ads_account_info` | status, currency, timezone, settings | `{ customer_id }` |
| `get_google_ads_campaigns` | campaigns, filter by status / network / bidding strategy | `{ customer_id, status?, ... }` |
| `get_google_ads_ad_groups` | ad groups, optional campaign filter | |
| `get_google_ads_ads` | ads with type, URLs, headlines, descriptions | |
| `get_google_ads_campaign_metrics` | campaign performance **with time series** | segmentation: `day`, `week`, `month`, `hour`; ranges `TODAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, `LAST_90_DAYS`, and more |
| `get_google_ads_ad_group_metrics` | ad-group performance with time segmentation | |
| `get_google_ads_ad_metrics` | per-ad performance with time breakdown | |
| `get_google_ads_keyword_metrics` | keyword performance incl. quality-score components | |
| `get_google_ads_search_terms_report` | actual user queries that triggered ads | |
| `get_google_ads_geo_performance` | performance by location | |
| `get_google_ads_device_performance` | mobile / desktop / tablet / connected TV | |
| `get_google_ads_hour_of_day_performance` | hourly peaks | |
| `get_google_ads_keywords`, `get_google_ads_negative_keywords`, `get_google_ads_extensions`, `get_google_ads_audiences` | read-side inventory | |

Note the naming asymmetry: **Meta tools are unprefixed** (`get_campaigns`), **Google tools are
prefixed** (`get_google_ads_campaigns`). Our gateway must key tool names per server.

Metric names on the Google side follow Google Ads API fields (`metrics.cost_micros`,
`metrics.impressions`, `metrics.clicks`, `metrics.ctr`, `metrics.average_cpc`,
`metrics.conversions`, `metrics.conversions_value`). **Cost arrives in micros — divide by 1,000,000**
before display **[unverified for this MCP's normalisation]**. ROAS = `conversions_value / cost`.

---

## 4. Rate limits and cost model

Two independent budgets:

**A. Pipeboard quota — per account slot, not per call.**
- Paid plans: **unlimited tool executions**. No per-call credits, no metering.
- Free plan: **30 tool executions per week**, hard cap.
- The scarce resource is **ad account slots** (2 / 3 / 10 / 25 by plan, +$10/mo each).
- A single MCP round trip = one tool execution. `bulk_get_insights` across N accounts still counts as
  one execution — cheapest way to fan out on the Free plan.

**B. Meta Marketing API limits — the real ceiling.**
- **200 calls per hour per user** (Meta's limit, documented by Pipeboard).
- Pipeboard retries with exponential backoff automatically, so a throttled call becomes a slow call.
- One MCP tool call can expand into several Meta calls (paging, sub-entity fetches) — assume worse
  than 1:1.
- Pipeboard's own advice: filter to reduce calls, batch, and **cache insights for reporting**.

**Google Ads** limits are operations-per-day at the developer-token level, managed by Pipeboard on
Standard Access; not published per customer **[unverified]**.

**FlySales implications**
- Cache aggressively: insights 24h (intraday 1h for "today"), hierarchy 24h, creatives 7d.
- Never poll on page load. Explicit refresh only, with a visible "cached / live" indicator.
- Prefer `bulk_get_insights` for the overview row, drilling down only on click.
- Budget line: Pipeboard subscription (Pro $29.90 or Premium $99) + $10/slot beyond the plan.
  There is no per-call cost to log — so our `ads_api_calls` table logs **executions and latency**, not
  dollars (unlike the SpyMarket credit model).

---

## 5. Capability map — FlySales Ads dashboard

| Dashboard feature | Server | Tool(s) | Plan |
|---|---|---|---|
| Account picker (which ad accounts are connected) | meta | `get_ad_accounts` | Free |
| Account header: currency, timezone, status | meta | `get_account_info` | Free |
| Overview KPIs across all accounts (spend, impressions, clicks, CTR, CPC, CPM, reach, conversions) | meta | `bulk_get_insights` | Free (remote MCP only) |
| Spend / ROAS trend chart | meta | `get_insights` per period bucket | Free |
| Campaign table with performance | meta | `get_campaigns` + `get_insights` (`level=campaign`) | Free |
| Campaign drill-down → ad sets | meta | `get_adsets` + `get_insights` (`level=adset`) | Free |
| Ad set drill-down → ads | meta | `get_ads` + `get_insights` (`level=ad`) | Free |
| Breakdowns: age / gender / platform / placement / country | meta | `get_insights` with `breakdown` | Free |
| Creative gallery for top ads | meta | `get_ad_creatives` + `get_ad_image` | Free |
| Rendered ad previews | meta | `get_ad_previews` **[unverified — confirm via tools/list]** | ? |
| Google account picker | google | `list_google_ads_customers` | Free |
| Google campaign table | google | `get_google_ads_campaigns` | Free |
| Google performance time series (day/week/month/hour) | google | `get_google_ads_campaign_metrics` | Free |
| Google ad-group / ad drill-down | google | `get_google_ads_ad_group_metrics`, `get_google_ads_ad_metrics` | Free |
| Google search-terms report | google | `get_google_ads_search_terms_report` | Free |
| Geo / device / hour-of-day panels | google | `get_google_ads_geo_performance`, `..._device_performance`, `..._hour_of_day_performance` | Free |
| Multi-client isolation (one token per client account) | both | per-account token scoping | **Agency** |
| Read-only guarantee on our token | both | permission-scoped token | **Pro+** |
| Any write action (pause, budget change, duplicate) | — | out of scope for this module | Pro/Premium |

Practical plan read: the read-only dashboard runs entirely on Free-tier **tools**, but Free's 30
executions/week and 2 slots make it a proof-of-concept tier only. **Pro ($29.90) is the realistic
floor** — it also unlocks the read-only permission-scoped token we should be using. Move to Agency
only when we serve multiple client ad accounts with hard isolation.

---

## 6. Open items before writing code

1. Run `tools/list` against both servers with a real token; commit the raw JSON schemas.
2. Confirm the exact `get_insights` argument names, `time_range` vocabulary, `level` enum, and whether
   purchases / purchase ROAS come back natively.
3. Confirm whether an ad-preview tool exists.
4. Confirm whether Google metrics are already normalised out of micros.
5. Decide the account model: our Pipeboard workspace holding client accounts vs one Pipeboard
   workspace per client — this drives slot cost and token scoping (Agency plan).
