# TrendTrack Public API — complete reference

Source: `https://api.trendtrack.io/v1/openapi.json` (fetched 2026-08-25, OpenAPI 3.0.0). Base URL `https://api.trendtrack.io`. Auth: `Authorization: Bearer <PUBLIC_API_KEY>` (`publicApiBearer`).

Billing note: the spec carries no machine-readable price extension. Credit cost is stated in endpoint/response descriptions and is reproduced per endpoint below ("Metered" = charges credits, usually 1 per returned row; "Free" = no credit charge documented).

## Table of contents

- [Ads](#ads)
- [Advertisers](#advertisers)
- [Brandtrackers](#brandtrackers)
- [Discovery](#discovery)
- [Emails](#emails)
- [Facets](#facets)
- [Favorites](#favorites)
- [Google Ads](#google-ads)
- [Identity](#identity)
- [Shops](#shops)
- [System](#system)
- [TikTok](#tiktok)
- [Usage](#usage)
- [Workspace](#workspace)

---

## Ads

### `GET /v1/ads` — List ads

**Billing:** Free / no documented credit charge  
**Description:** Returns the lightweight public ads collection. This endpoint stays intentionally small and focuses on text search, brand search, simple filters, sorting, and pagination. The search parameter is required; for advanced filtering without a required text search, use POST /v1/ads/query.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string | yes | Canonical text query for the lightweight public ads listing. |
| `searchType` | query | enum[adCopy, brand] |  | Search mode for this request. Allowed values: `adCopy`, `brand`. |
| `platform` | query | enum[facebook, all] |  | Enum value accepted by this request. Allowed values: `facebook`, `all`. TikTok is not available in public v1. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `status` | query | enum[active, inactive, all] |  | Status filter for this request. Allowed values: `active`, `inactive`, `all`. |
| `mediaType` | query | enum[image, video, carousel] |  | Creative media type filter for this request. Allowed values: `image`, `video`, `carousel`. `carousel` maps to indexed carousel creatives and is not a DCO filter. |
| `sortBy` | query | enum[relevance, newest, longestRunning, reach] |  | Sort key for this request. Allowed values: `relevance`, `newest`, `longestRunning`, `reach`. |
| `query` | query | string |  | Deprecated alias for search. Use search instead. |

Response: `PublicApiSearchAdsResponseDto` — Paginated ads response using the public ads contract. The response also includes the X-Request-Id header.

**`PublicApiSearchAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiAdSummaryDto> | yes |  |
| `pagination` | PublicApiAdsPaginationDto | yes |  |

**`PublicApiAdSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `collationId` | string |  | Creative collation identifier when this result represents a deduplicated group of related Meta ads. Pass this value as scan_ad.collation_id to scan the same combined creative shown by search. |
| `platform` | enum[facebook] | yes |  |
| `status` | enum[active, inactive, unknown] | yes | For a result with collationId, active means at least one media-backed member ad is active. Without collationId, this is the individual ad status. |
| `createdAt` | string | yes |  |
| `firstSeenAt` | string | yes | For a result with collationId, the earliest first-seen date across the combined creative members. |
| `lastSeenAt` | string | yes | For a result with collationId, null while any media-backed member remains active; otherwise the latest member end date. |
| `daysRunning` | number | yes | Indexed running duration in days. For a result with collationId, this is the creative calendar span from the oldest member start to today while any member is active, or to the latest member end otherwise; it does not imply continuous delivery by one ad. Historical backfill is bounded by the available firstSeenAt floor (currently 2018-01-01), so very old ads can share the same maximum/clamped value. |
| `media` | PublicApiAdMediaDto | yes |  |
| `advertiser` | PublicApiAdAdvertiserDto | yes |  |
| `content` | PublicApiAdContentSummaryDto | yes |  |
| `metrics` | PublicApiAdMetricsDto | yes |  |
| `audience` | PublicApiAdAudienceDto | yes |  |
| `rank` | PublicApiAdRankDto | yes |  |
| `flags` | PublicApiAdFlagsDto | yes |  |

**`PublicApiAdMediaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `type` | enum[image, video, carousel, unknown] | yes | Creative media type from indexed ad data. `carousel` means carousel creative format and is not a DCO signal. |
| `thumbnailUrl` | string | yes |  |
| `mediaUrl` | string | yes |  |

**`PublicApiAdAdvertiserDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `logoUrl` | string | yes |  |
| `facebookPageId` | string | yes |  |
| `liveAdsCount` | number | yes |  |
| `reach30d` | number | yes | Advertiser reach for the last 30 days. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `totalReach` | number | yes | Advertiser total/current reach. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `countriesCount` | number | yes |  |
| `facebookLikes` | number | yes |  |
| `instagramFollowers` | number | yes |  |

**`PublicApiAdContentSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `title` | string | yes |  |
| `body` | string | yes |  |
| `transcript` | string | yes | Backward-compatible plain transcript text. Rich transcript metadata may also be available on detail responses. |
| `callToAction` | string | yes |  |
| `landingPageUrl` | string | yes |  |
| `landingPageDomain` | string | yes |  |
| `ctaDescription` | string | yes |  |
| `ctaLinkDescription` | string | yes |  |

**`PublicApiAdMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `reach` | number | yes | Ad reach where available. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric. |
| `aggregatedReach` | number | yes | Aggregated ad reach across duplicates where available; reach corresponds to the public impressions-style metric from Meta Ad Library data. |
| `estimatedSpend` | number | yes | Estimated spend in euros. Formula: reach * cpm / 1000, using the request cpm or the default CPM of 9 when cpm is omitted. Rounded to the nearest integer. |
| `duplicates` | number | yes |  |
| `reachDelta1d` | number | yes | One-day reach delta; reach corresponds to the public impressions-style metric from Meta Ad Library data. |
| `reachDelta7d` | number | yes | Seven-day reach delta; reach corresponds to the public impressions-style metric from Meta Ad Library data. |
| `reachDelta30d` | number | yes | Thirty-day reach delta; reach corresponds to the public impressions-style metric from Meta Ad Library data. |

**`PublicApiAdAudienceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `targetedCountries` | array<string> | yes | Full ad targeting country list, including non-EU markets such as US. |
| `mainCountry` | string | yes | Primary audience country from Meta's EU/UK ad transparency reporting. Null for ads outside that scope, even when targetedCountries is populated. |
| `gender` | enum[men, women, all] | yes |  |
| `ageMin` | number | yes |  |
| `ageMax` | number | yes |  |

**`PublicApiAdRankDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `positionInPage` | number | yes |  |
| `currentRank` | number | yes |  |
| `rankDelta` | number | yes |  |
| `improvementPct` | number | yes |  |

**`PublicApiAdFlagsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `isEuAd` | boolean | yes |  |
| `isLowReach` | boolean | yes | Whether the ad is flagged as low reach/low impressions in the indexed Meta Ad Library data. |
| `isMediaChanged` | boolean | yes |  |
| `hasPartnerBadge` | boolean | yes |  |

**`PublicApiAdsPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes |  |
| `total` | number | yes |  |
| `totalPages` | number | yes |  |

### `POST /v1/ads/query` — Query ads

**Billing:** Free / no documented credit charge  
**Description:** Returns the advanced public ads query surface. This endpoint supports the full current ads filtering set through a public camelCase contract with structured JSON for advanced growth, country, market, and ranking filters while keeping the response aligned with the standard public ad summary shape. Search terms are optional in this route.

Request body: `QueryPublicApiAdsRequestDto`

**`QueryPublicApiAdsRequestDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `search` | array<string> |  | Optional list of search terms used by the advanced ads query engine. |
| `searchType` | enum[adCopy, brand, website, domain, urlContains] |  | Search mode for this request. Public camelCase values map to the same internal /ads fields: `adCopy` → `ad_copy`, `brand` → `brand`, `website` → `website_copy`, `domain` → `domain`, `urlContains` → `url_contains`. |
| `keywordMode` | enum[any, all] |  | How multiple search keywords are combined. Allowed values: `any`, `all`. |
| `sortBy` | enum[createdAt, longestRunning, relevance, relevanceScore, newest, mostDuplicates, reach, reachDelta1d, reachDelta7d, reachDelta30d, rankDelta7d, rankDelta14d, rankDelta30d, adOrder] |  | Sort key for this request. Allowed values: `createdAt`, `longestRunning`, `relevance`, `relevanceScore`, `newest`, `mostDuplicates`, `reach`, `reachDelta1d`, `reachDelta7d`, `reachDelta30d`, `adOrder`. |
| `order` | enum[asc, desc] |  | Sort direction for this request. Allowed values: `asc`, `desc`. |
| `page` | number |  |  |
| `limit` | number |  |  |
| `platforms` | array<enum[facebook]> |  | Accepted public v1 platform values. TikTok is not available in public v1. |
| `mediaType` | enum[image, video, carousel] |  | Creative media type filter for this request. Allowed values: `image`, `video`, `carousel`. `carousel` maps to indexed carousel creatives and is not a DCO filter. |
| `createdAfter` | string |  |  |
| `createdBefore` | string |  |  |
| `minFbPageCreationDate` | string |  |  |
| `maxFbPageCreationDate` | string |  |  |
| `minLastSeenDate` | string |  |  |
| `maxLastSeenDate` | string |  |  |
| `minDaysRunning` | number |  |  |
| `maxDaysRunning` | number |  |  |
| `status` | enum[active, inactive, all] |  | Status filter for this request. Allowed values: `active`, `inactive`, `all`. |
| `minDuplicates` | number |  |  |
| `maxDuplicates` | number |  |  |
| `minDescriptionLength` | number |  |  |
| `maxDescriptionLength` | number |  |  |
| `minVideoDuration` | number |  |  |
| `maxVideoDuration` | number |  |  |
| `maxAdOrder` | number |  |  |
| `adRankMode` | enum[percentile, rank] |  | Rank interpretation mode. Allowed values: `percentile`, `rank`. |
| `adRankBasis` | enum[current, alltime] |  | Rank basis used for ad rank filters. Allowed values: `current`, `alltime`. |
| `maxAdRankValue` | number |  |  |
| `growthRank` | PublicApiAdsGrowthRankFilterDto |  | Advanced rank trend filter. Direction filters are ORed; period selects the rank-delta window when every rule uses the same supported window. minChange/unit are accepted for forward compatibility; use minRankDelta for an enforced absolute minimum rank improvement. |
| `rankDeltaWindow` | enum[7d, 14d, 30d] |  | Rank-delta window used by growthRank/minRankDelta. Overrides the window inferred from growthRank.period. |
| `minRankDelta` | number |  | Minimum absolute rank improvement for ad-rank mover filters. |
| `adLanguage` | array<string> |  |  |
| `cta` | array<string> |  |  |
| `landingPages` | array<string> |  | Landing page URL/domain filters. Mirrors the app ads table landingPages filter. |
| `adCopyHashes` | array<string> |  | Ad copy hash filters. Mirrors the app ads table adCopyHashes filter. |
| `minReach` | number |  | Minimum reach threshold. Backed by the internal reach/impressions analytics fields. |
| `maxReach` | number |  | Maximum reach threshold. Backed by the internal reach/impressions analytics fields. |
| `minAge` | number |  |  |
| `maxAge` | number |  |  |
| `sex` | enum[men, women, all] |  | Audience gender filter. Allowed values: `men`, `women`, `all`. |
| `adCountries` | PublicApiAdsCountryFilterDto |  | Countries where the ad is distributed. Uses ISO 3166-1 alpha-2 country codes. |
| `mainCountries` | array<string> |  | Primary audience country filter, backed by Meta's EU/UK ad transparency reporting. Only EU/EEA, UK and French overseas codes exist in that data: US and other non-EU codes match nothing. Use adCountries for those markets. |
| `spender` | enum[big-spender, rising-star, brandtracker] |  | Spender segment filter. Allowed values: `big-spender`, `rising-star`, `brandtracker`. |
| `partners` | boolean |  |  |
| `partnerIds` | array<string> |  | Partner badge ids to include. Mirrors the app ads table partnerIds filter. |
| `minTraffic` | number |  |  |
| `maxTraffic` | number |  |  |
| `trafficGrowth` | PublicApiAdsTrafficGrowthFilterDto |  | Traffic growth filter. Uses OR groups (`anyOf`) made of AND-ed rules (`all`). Values are percentage thresholds. |
| `minAds` | number |  |  |
| `maxAds` | number |  |  |
| `adsGrowth` | PublicApiAdsAdsGrowthFilterDto |  | Ads growth filter. Uses OR groups (`anyOf`) made of AND-ed rules (`all`). Values are percentage thresholds. |
| `pageReachGrowth` | PublicApiAdsReachGrowthFilterDto |  | Page reach growth filter. Uses OR groups (`anyOf`) made of AND-ed rules (`all`). |
| `adReachGrowth` | PublicApiAdsReachGrowthFilterDto |  | Ad reach growth filter. Uses OR groups (`anyOf`) made of AND-ed rules (`all`). |
| `categoryIds` | array<number> |  | Google category facet ids matched against ads/shop google_categories. |
| `minProducts` | number |  |  |
| `maxProducts` | number |  |  |
| `minBestSellerPrice` | number |  |  |
| `maxBestSellerPrice` | number |  |  |
| `themes` | array<string> |  |  |
| `pixels` | array<string> |  |  |
| `excludePixels` | array<string> |  |  |
| `languages` | array<string> |  |  |
| `currencies` | array<string> |  |  |
| `shopifyApps` | array<number> |  |  |
| `excludeShopifyApps` | array<number> |  |  |
| `adsTimePeriod` | enum[last24h, last7d, last30d] |  | Relative ad first-seen time window. When createdAfter is omitted, this is converted to an internal first-seen lower bound at the UTC day boundary for the selected period. It also selects the ads metric period used by minAds/maxAds. |
| `minDate` | string |  |  |
| `maxDate` | string |  |  |
| `creationCountry` | PublicApiAdsCountryFilterDto |  | Advertiser creation country filter using ISO 3166-1 alpha-2 country codes. |
| `market` | PublicApiAdsMarketFilterDto |  | Market filter grouped by primary markets, secondary markets, and excluded markets. |
| `shopifyPlus` | enum[plus, non-plus, all] |  | Shopify Plus filter. Allowed values: `plus`, `non-plus`, `all`. |
| `minTrustpilotScore` | number |  | Minimum Trustpilot score. |
| `maxTrustpilotScore` | number |  | Maximum Trustpilot score. |
| `minTrustpilotReviews` | number |  | Minimum Trustpilot review count. |
| `maxTrustpilotReviews` | number |  | Maximum Trustpilot review count. |
| `minSpend` | number |  | Minimum estimated spend. Uses cpm when provided, otherwise the public API default CPM of 9. |
| `maxSpend` | number |  | Maximum estimated spend. Uses cpm when provided, otherwise the public API default CPM of 9. |
| `cpm` | number |  | CPM in euros per 1,000 reach used for spend filters and estimatedSpend. Defaults to 9 when omitted. |
| `spendPeriod` | enum[total, last24h, last7d, last30d] |  | Metric period used by minSpend/maxSpend. By itself this parameter does not filter results. |
| `reachPeriod` | enum[total, last24h, last7d, last30d] |  | Metric period used by minReach/maxReach. Reach is the public Meta Ad Library vocabulary for impressions where available. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `minSpendPerPage` | number |  | Minimum estimated spend per page. Uses cpm when provided, otherwise the public API default CPM of 9. |
| `maxSpendPerPage` | number |  | Maximum estimated spend per page. Uses cpm when provided, otherwise the public API default CPM of 9. |
| `spendPerPagePeriod` | enum[total, last24h, last7d, last30d] |  | Metric period used by minSpendPerPage/maxSpendPerPage. By itself this parameter does not filter results. |
| `minFacebookLikes` | number |  |  |
| `maxFacebookLikes` | number |  |  |
| `minInstagramFollowers` | number |  |  |
| `maxInstagramFollowers` | number |  |  |
| `minReachPerPage` | number |  | Minimum page reach threshold. Backed by the internal page impressions fields. |
| `maxReachPerPage` | number |  | Maximum page reach threshold. Backed by the internal page impressions fields. |
| `reachPerPagePeriod` | enum[total, last24h, last7d, last30d] |  | Metric period used by minReachPerPage/maxReachPerPage. Reach is the public Meta Ad Library vocabulary for page impressions where available. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `technologies` | array<enum[checkoutchamp, clickfunnels, funnelish, gempages, magento, odoo, pagefly, prestashop, shopify, shoplazza, shopline, squarespace, wheelio, wix, woocommerce, wordpress, zipify-pages]> |  | Technology slugs supported by the current ads index. Supported values: checkoutchamp, clickfunnels, funnelish, gempages, magento, odoo, pagefly, prestashop, shopify, shoplazza, shopline, squarespace, wheelio, wix, woocommerce, wordpress, zipify-pages. |
| `hideLowReach` | boolean |  | Exclude low reach ads. Backed by the internal low impressions flag. |
| `hideNonEuUkAds` | boolean |  |  |
| `hideSavedAds` | boolean |  |  |
| `hideDecliningRankAds` | boolean |  |  |
| `trackedPages` | array<string> |  |  |
| `maxAdsPerBrand` | number |  |  |

**`PublicApiAdsGrowthRankFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `anyOf` | array<PublicApiAdsGrowthRankGroupDto> | yes | Structured rank trend request shape. Current filtering ORs all provided directions and ignores grouping, period, minChange, and unit. |

**`PublicApiAdsGrowthRankGroupDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `all` | array<PublicApiAdsGrowthRankRuleDto> | yes |  |

**`PublicApiAdsCountryFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `include` | array<string> |  | ISO 3166-1 alpha-2 country codes to include. |
| `exclude` | array<string> |  | ISO 3166-1 alpha-2 country codes to exclude. |

**`PublicApiAdsTrafficGrowthFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `anyOf` | array<PublicApiAdsTrafficGrowthGroupDto> | yes | OR groups of traffic growth rules. Each group combines its rules with AND. |

**`PublicApiAdsTrafficGrowthGroupDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `all` | array<PublicApiAdsTrafficGrowthRuleDto> | yes |  |

**`PublicApiAdsAdsGrowthFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `anyOf` | array<PublicApiAdsAdsGrowthGroupDto> | yes | OR groups of ads growth rules. Each group combines its rules with AND. |

**`PublicApiAdsAdsGrowthGroupDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `all` | array<PublicApiAdsAdsGrowthRuleDto> | yes |  |

**`PublicApiAdsReachGrowthFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `anyOf` | array<PublicApiAdsReachGrowthGroupDto> | yes | OR groups of reach growth rules. Each group combines its rules with AND. |

**`PublicApiAdsReachGrowthGroupDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `all` | array<PublicApiAdsReachGrowthRuleDto> | yes |  |

**`PublicApiAdsMarketFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `main` | array<string> |  | Countries that must match the primary market. |
| `among` | array<string> |  | Countries that can appear among the ad markets. |
| `exclude` | array<string> |  | Countries to exclude from the ad markets. |

Response: `PublicApiSearchAdsResponseDto` — Paginated advanced ads query response using the public ads contract. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiSearchAdsResponseDto`)

### `POST /v1/ads/{adId}/share` — Create or return an ad share URL

**Billing:** Free / no documented credit charge  
**Description:** Creates or returns the existing TrendTrack public webapp share URL for an ad. This is classified as a workspace-scoped write because it creates share state server-side when needed; delegated OAuth/API-key callers must be workspace writers.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `adId` | path | string | yes | TrendTrack ad identifier returned as `adId` by the Public API. |

Response: `PublicApiCreateAdShareResponseDto` — Public ad share URL response. The response also includes the X-Request-Id header.

**`PublicApiCreateAdShareResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiAdShareDto | yes |  |

**`PublicApiAdShareDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adId` | string | yes | TrendTrack ad identifier returned as `adId` by the Public API. |
| `id` | string | yes | Identifier of the share_ads row used by the webapp share page. |
| `slug` | string | yes | Human-readable share slug when available. |
| `shareUrl` | string | yes | Fully qualified TrendTrack webapp URL for this public share. |
| `sharePath` | string | yes | Webapp-relative path for this public share. |
| `createdAt` | string | yes |  |

### `GET /v1/ads/{adId}/media-url` — Get an ad media URL

**Billing:** Free / no documented credit charge  
**Description:** Returns URL metadata for the best available media asset for an ad. This endpoint does not proxy or download the binary media.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `adId` | path | string | yes | TrendTrack ad identifier returned as `adId` by the Public API. |

Response: `PublicApiGetAdMediaUrlResponseDto` — Public ad media URL response. The response also includes the X-Request-Id header.

**`PublicApiGetAdMediaUrlResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiAdMediaUrlDto | yes |  |

**`PublicApiAdMediaUrlDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adId` | string | yes | TrendTrack ad identifier returned as `adId` by the Public API. |
| `mediaType` | enum[image, video, carousel, unknown] | yes |  |
| `url` | string | yes | Best available media URL for this ad. This endpoint returns metadata only and does not proxy the binary asset. |
| `urlType` | enum[public_asset, external_direct] | yes | public_asset is a stable TrendTrack/public URL. external_direct may expire or be subject to upstream access controls. |
| `selectedSource` | enum[media_url, thumbnail_url] | yes | Source column selected for url. |
| `mediaUrl` | string | yes |  |
| `thumbnailUrl` | string | yes |  |
| `filename` | string | yes | Suggested filename derived from the ad id and selected URL. |

### `GET /v1/ads/facets/landing-pages` — List landing pages

**Billing:** Metered (credits)  
**Description:** Aggregates distinct normalized landing-page URLs for Meta pages or one shop domain. Charges one credit per distinct URL returned and never returns ad rows.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scopeTrackedPages` | query | array<string> |  | Repeated or comma-separated Meta/Facebook page identifiers. Mutually exclusive with scopeDomain. |
| `scopeDomain` | query | string |  | Shop URL or hostname. Mutually exclusive with scopeTrackedPages. |
| `status` | query | enum[active, inactive, all] |  |  |
| `limit` | query | integer |  |  |

Response: `PublicApiGetAdLandingPagesResponseDto` — Landing-page URL counts, active-ad counts, scope metadata, and truncation state.

**`PublicApiGetAdLandingPagesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiAdLandingPageFacetDto> | yes |  |
| `meta` | PublicApiAdLandingPagesMetaDto | yes |  |

**`PublicApiAdLandingPageFacetDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `url` | string | yes | Normalized landing-page URL in lowercase, without query parameters or trailing slashes. |
| `usageCount` | number | yes | Number of matching ads using this landing-page URL. |
| `activeAdsCount` | number | yes | Number of matching active ads using this landing-page URL. |

**`PublicApiAdLandingPagesMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `scopeType` | enum[trackedPages, domain] | yes |  |
| `scopeValueCount` | number | yes |  |
| `status` | enum[active, inactive, all] | yes |  |
| `limit` | number | yes |  |
| `isTruncated` | boolean | yes | True when more normalized domains matched than the response limit or Elasticsearch omitted buckets. |

### `GET /v1/ads/{adId}` — Get an ad by id

**Billing:** Free / no documented credit charge  
**Description:** Returns a single public ad detail object by ad id. The current backing identifier is the internal composite ad id, but the public contract exposes it as id.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `adId` | path | string | yes | TrendTrack ad identifier returned as `adId` by the Public API. |

Response: `PublicApiGetAdDetailResponseDto` — Public ad detail response. The response also includes the X-Request-Id header.

**`PublicApiGetAdDetailResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiAdDetailDto | yes |  |

**`PublicApiAdDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `collationId` | string |  | Creative collation identifier when this result represents a deduplicated group of related Meta ads. Pass this value as scan_ad.collation_id to scan the same combined creative shown by search. |
| `platform` | enum[facebook] | yes |  |
| `status` | enum[active, inactive, unknown] | yes | For a result with collationId, active means at least one media-backed member ad is active. Without collationId, this is the individual ad status. |
| `createdAt` | string | yes |  |
| `firstSeenAt` | string | yes | For a result with collationId, the earliest first-seen date across the combined creative members. |
| `lastSeenAt` | string | yes | For a result with collationId, null while any media-backed member remains active; otherwise the latest member end date. |
| `daysRunning` | number | yes | Indexed running duration in days. For a result with collationId, this is the creative calendar span from the oldest member start to today while any member is active, or to the latest member end otherwise; it does not imply continuous delivery by one ad. Historical backfill is bounded by the available firstSeenAt floor (currently 2018-01-01), so very old ads can share the same maximum/clamped value. |
| `media` | PublicApiAdMediaDto | yes |  |
| `advertiser` | PublicApiAdAdvertiserDto | yes |  |
| `content` | PublicApiAdContentSummaryDto | yes |  |
| `metrics` | PublicApiAdMetricsDto | yes |  |
| `audience` | PublicApiAdAudienceDto | yes |  |
| `rank` | PublicApiAdRankDto | yes |  |
| `flags` | PublicApiAdFlagsDto | yes |  |
| `transcript` | PublicApiAdTranscriptDto | yes |  |
| `creativeAnalysis` | PublicApiAdCreativeAnalysisDto | yes |  |
| `links` | PublicApiAdLinksDto | yes |  |
| `shops` | array<PublicApiAdShopDto> | yes |  |
| `pageAnalytics` | PublicApiAdPageAnalyticsDto | yes |  |

**`PublicApiAdTranscriptDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `language` | string | yes |  |
| `languageConfidence` | number | yes |  |
| `segments` | array<PublicApiAdTranscriptSegmentDto> | yes |  |
| `fullText` | string | yes |  |

**`PublicApiAdCreativeAnalysisDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `hook` | PublicApiAdCreativeHookDto | yes |  |

**`PublicApiAdLinksDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adLibraryUrl` | string | yes |  |
| `landingPageUrl` | string | yes |  |

**`PublicApiAdShopDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `shopId` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |
| `isPrimary` | boolean | yes |  |
| `traffic` | number | yes |  |
| `categories` | array<string> | yes |  |

**`PublicApiAdPageAnalyticsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `impressionsHistory` | array<PublicApiAdPageImpressionsHistoryPointDto> | yes | Historical Facebook page impressions when available; ad-level DTOs may expose comparable Meta Ad Library vocabulary as reach. |
| `facebookLikesHistory` | array<PublicApiAdPageValueHistoryPointDto> | yes |  |
| `instagramFollowersHistory` | array<PublicApiAdPageValueHistoryPointDto> | yes |  |

### `GET /v1/ads/{adId}/reach-history` — Get ad reach history

**Billing:** Free / no documented credit charge  
**Description:** Returns the public daily reach history for one ad. The series is intentionally lightweight and keeps reach as the canonical metric term.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `adId` | path | string | yes | TrendTrack ad identifier returned as `adId` by the Public API. |
| `limit` | query | integer |  |  |

Response: `PublicApiGetAdReachHistoryResponseDto` — Public ad reach history response. The response also includes the X-Request-Id header.

**`PublicApiGetAdReachHistoryResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiAdReachHistoryPointDto> | yes |  |

**`PublicApiAdReachHistoryPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `date` | string | yes |  |
| `reach` | number | yes | Daily ad reach. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |


---

## Advertisers

### `GET /v1/advertisers` — List advertisers

**Billing:** Free / no documented credit charge  
**Description:** Returns the lightweight public advertisers collection. This endpoint stays intentionally simple and focuses on brand/domain search, pagination, ordering, and stable scalar filters. Use POST /v1/advertisers/query for the advanced discovery surface.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | array<string> |  | Optional advertiser search keywords. Repeated query params and comma-separated values are both accepted. |
| `searchType` | query | enum[brand, domain] |  | Simple search strategy for the advertisers collection. Use POST /v1/advertisers/query for advanced text resolution modes. |
| `keywordMode` | query | enum[any, all] |  | How multiple search keywords should combine. Defaults to any. |
| `sortBy` | query | enum[relevance, newest, activeAds, newAds, euAdsShare, reach, reach14d, followers] |  | Primary sort key for advertiser discovery. Defaults to relevance. |
| `order` | query | enum[asc, desc] |  | Sort order. Ignored when sortBy=relevance because relevance is always ranked descending. |
| `offset` | query | integer |  | Pagination offset. Defaults to 0. |
| `limit` | query | integer |  | Maximum number of advertisers to return. Defaults to 20. |
| `minFbPageCreationDate` | query | string |  | Inclusive lower bound for the Facebook page creation date filter. |
| `maxFbPageCreationDate` | query | string |  | Inclusive upper bound for the Facebook page creation date filter. |
| `minActiveAds` | query | integer |  |  |
| `maxActiveAds` | query | integer |  |  |
| `adsTimePeriod` | query | enum[current, last24h, last7d, last14d, last30d] |  | Enum value accepted by this request. Allowed values: `current`, `last24h`, `last7d`, `last14d`, `last30d`. |
| `minFacebookLikes` | query | integer |  |  |
| `maxFacebookLikes` | query | integer |  |  |
| `minInstagramFollowers` | query | integer |  |  |
| `maxInstagramFollowers` | query | integer |  |  |
| `minAdsLaunched` | query | integer |  |  |
| `maxAdsLaunched` | query | integer |  |  |
| `adsLaunchedPeriod` | query | enum[last24h, last7d, last14d, last30d, last90d] |  | Time window accepted by this request. Allowed values: `last24h`, `last7d`, `last14d`, `last30d`, `last90d`. |
| `minReach` | query | integer |  | Minimum advertiser reach threshold. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `maxReach` | query | integer |  | Maximum advertiser reach threshold. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `reachPeriod` | query | enum[last24h, last7d, last14d, last30d, last90d, total] |  | Reach/impressions metric window. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. Allowed values: `last24h`, `last7d`, `last14d`, `last30d`, `last90d`, `total`. |
| `pageType` | query | array<enum[influencer, brand]> |  | Enum value accepted by this request. Allowed values: `influencer`, `brand`. |
| `categoryIds` | query | array<integer> |  | Google category facet ids matched through linked websites' website_overview.google_categories. Repeated query params and comma-separated values are both accepted. |
| `shopifyLinked` | query | enum[yes, no, all] |  | Filter by indexed linked-site Shopify technology. `no` means no indexed Shopify technology is present for the advertiser. |
| `gender` | query | enum[male, female, all] |  | Enum value accepted by this request. Allowed values: `male`, `female`, `all`. |

Response: `PublicApiGetAdvertisersResponseDto` — Paginated advertisers response. The response also includes the X-Request-Id header.

**`PublicApiGetAdvertisersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiAdvertiserSummaryDto> | yes |  |
| `pagination` | PublicApiAdvertisersPaginationDto | yes |  |
| `meta` | PublicApiAdvertisersMetaDto | yes |  |

**`PublicApiAdvertiserSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Current public advertiser identifier. This MVP uses the Facebook page id directly. |
| `platform` | enum[facebook] | yes |  |
| `facebookPageId` | string | yes |  |
| `name` | string | yes |  |
| `logoUrl` | string | yes |  |
| `profile` | PublicApiAdvertiserProfileDto | yes |  |
| `advertising` | PublicApiAdvertiserSummaryAdvertisingDto | yes |  |
| `lastAds` | array<PublicApiAdvertiserLastAdPreviewDto> | yes |  |
| `mainLandingPages` | array<PublicApiAdvertiserMainLandingPagePreviewDto> | yes |  |

**`PublicApiAdvertiserProfileDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `likes` | number | yes |  |
| `instagramFollowers` | number | yes |  |
| `createdAt` | string | yes | Facebook/page-explorer page creation date, aligned with minFbPageCreationDate and maxFbPageCreationDate filters. This is not the internal database ingestion timestamp. |

**`PublicApiAdvertiserSummaryAdvertisingDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `activeAds` | number | yes | Active ads count, preferring page-explorer running_ads_count with relational fallback when unavailable. |
| `reach30d` | number | yes | Advertiser reach over the last 30 days, preferring page-explorer eu_reach_30d with fb_page fallback when unavailable. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |

**`PublicApiAdvertiserLastAdPreviewDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `mediaUrl` | string | yes |  |
| `thumbnailUrl` | string | yes |  |

**`PublicApiAdvertiserMainLandingPagePreviewDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `landingPage` | string | yes |  |
| `screenshotUrl` | string | yes |  |

**`PublicApiAdvertisersPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `limit` | number | yes |  |
| `offset` | number | yes |  |
| `total` | number | yes |  |

**`PublicApiAdvertisersMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `isTruncated` | boolean | yes | True when an intermediary aggregation-based search stage truncated the intermediate id set before the final advertiser query. |

### `POST /v1/advertisers/query` — Query advertisers

**Billing:** Free / no documented credit charge  
**Description:** Returns the advanced public advertisers query surface. This endpoint supports the current richer advertiser discovery filters through a structured public camelCase contract while keeping the response aligned with the standard public advertiser summary shape. categoryIds uses linked websites' google_categories; pageNiches remains an advanced legacy page-niche filter. Empty JSON bodies are valid and use defaults.

Request body: `QueryPublicApiAdvertisersRequestDto`

**`QueryPublicApiAdvertisersRequestDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `search` | array<string> |  |  |
| `searchType` | enum[brand, domain, adCopy, websiteCopy, urlContains] |  | Advanced search strategy for advertiser discovery. Supports content and URL resolution modes in addition to simple brand/domain search. |
| `keywordMode` | enum[any, all] |  | Enum value accepted by this request. Allowed values: `any`, `all`. |
| `sortBy` | enum[relevance, newest, activeAds, newAds, euAdsShare, reach, reach14d, followers] |  | Sort key for this request. Allowed values: `relevance`, `newest`, `activeAds`, `newAds`, `euAdsShare`, `reach`, `reach14d`, `followers`. |
| `order` | enum[asc, desc] |  | Sort order. Ignored when sortBy=relevance because relevance is always ranked descending. |
| `offset` | number |  |  |
| `limit` | number |  |  |
| `minFbPageCreationDate` | string |  |  |
| `maxFbPageCreationDate` | string |  |  |
| `minActiveAds` | number |  |  |
| `maxActiveAds` | number |  |  |
| `adsTimePeriod` | enum[current, last24h, last7d, last14d, last30d] |  | Enum value accepted by this request. Allowed values: `current`, `last24h`, `last7d`, `last14d`, `last30d`. |
| `minFacebookLikes` | number |  |  |
| `maxFacebookLikes` | number |  |  |
| `minInstagramFollowers` | number |  |  |
| `maxInstagramFollowers` | number |  |  |
| `minAdsLaunched` | number |  |  |
| `maxAdsLaunched` | number |  |  |
| `adsLaunchedPeriod` | enum[last24h, last7d, last14d, last30d, last90d] |  | Time window accepted by this request. Allowed values: `last24h`, `last7d`, `last14d`, `last30d`, `last90d`. |
| `minReach` | number |  | Minimum advertiser reach threshold. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `maxReach` | number |  | Maximum advertiser reach threshold. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `reachPeriod` | enum[last24h, last7d, last14d, last30d, last90d, total] |  | Reach/impressions metric window. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. Allowed values: `last24h`, `last7d`, `last14d`, `last30d`, `last90d`, `total`. |
| `minSpendPerPage` | number |  | Minimum estimated spend per page. Converted internally through CPM and reach/impressions fields. |
| `maxSpendPerPage` | number |  | Maximum estimated spend per page. Converted internally through CPM and reach/impressions fields. |
| `spendPerPagePeriod` | enum[last24h, last7d, last14d, last30d, last90d, total] |  | Reach/impressions metric window. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. Allowed values: `last24h`, `last7d`, `last14d`, `last30d`, `last90d`, `total`. |
| `cpm` | number |  | CPM used to convert spend filters into reach/impressions-based ES ranges. |
| `minReachPerPage` | number |  | Minimum reach-per-page filter. Reach corresponds to the public impressions-style metric from Meta Ad Library data. |
| `maxReachPerPage` | number |  | Maximum reach-per-page filter. Reach corresponds to the public impressions-style metric from Meta Ad Library data. |
| `reachPerPagePeriod` | enum[last24h, last7d, last14d, last30d, last90d, total] |  | Reach/impressions metric window. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. Allowed values: `last24h`, `last7d`, `last14d`, `last30d`, `last90d`, `total`. |
| `adLanguage` | array<string> |  |  |
| `technologies` | array<string> |  |  |
| `adCountries` | PublicApiAdvertisersCountryFilterDto |  | Countries where the advertiser is distributing ads. Uses ISO 3166-1 alpha-2 country codes. |
| `mainCountries` | array<string> |  | Primary countries to match. |
| `countryFilterMode` | enum[reach, adCount] |  | Enum value accepted by this request. Allowed values: `reach`, `adCount`. |
| `adsGrowth` | PublicApiAdvertisersAdsGrowthFilterDto |  | Ads growth filter. Uses OR groups (`anyOf`) made of AND-ed rules (`all`), with rule fields `period`, `operator`, and `value`. |
| `pageReachGrowth` | PublicApiAdvertisersPageReachGrowthFilterDto |  | Page reach growth filter. Uses OR groups (`anyOf`) made of AND-ed rules (`all`), with rule fields `period`, `operator`, and `value`. |
| `ageRanges` | array<string> |  |  |
| `pageType` | array<enum[influencer, brand]> |  | Enum value accepted by this request. Allowed values: `influencer`, `brand`. |
| `categoryIds` | array<number> |  | Google category facet ids matched through linked websites' website_overview.google_categories. |
| `pageNiches` | PublicApiAdvertisersPageNichesFilterDto |  | Advanced legacy advertiser page-niche filter using indexed page_niche_* fields. Distinct from categoryIds, which matches linked websites via google_categories; when both are provided they are applied together. |
| `minPartnershipPercentage` | number |  |  |
| `shopifyLinked` | enum[yes, no, all] |  | Filter by indexed linked-site Shopify technology. `no` means no indexed Shopify technology is present for the advertiser. |
| `gender` | enum[male, female, all] |  | Enum value accepted by this request. Allowed values: `male`, `female`, `all`. |

**`PublicApiAdvertisersCountryFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `include` | array<string> |  | ISO 3166-1 alpha-2 country codes to include. |
| `exclude` | array<string> |  | ISO 3166-1 alpha-2 country codes to exclude. |

**`PublicApiAdvertisersAdsGrowthFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `anyOf` | array<PublicApiAdvertisersAdsGrowthGroupDto> | yes | OR groups of ads growth rules. Each group combines its rules with AND. |

**`PublicApiAdvertisersAdsGrowthGroupDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `all` | array<PublicApiAdvertisersAdsGrowthRuleDto> | yes |  |

**`PublicApiAdvertisersPageReachGrowthFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `anyOf` | array<PublicApiAdvertisersPageReachGrowthGroupDto> | yes | OR groups of page reach growth rules. Each group combines its rules with AND. |

**`PublicApiAdvertisersPageReachGrowthGroupDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `all` | array<PublicApiAdvertisersPageReachGrowthRuleDto> | yes |  |

**`PublicApiAdvertisersPageNichesFilterDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `main` | array<number> |  | Advanced legacy page-niche categories that must match the main advertiser page niche. |
| `among` | array<number> |  | Advanced legacy page-niche categories that may appear among advertiser page niches. |
| `exclude` | array<number> |  | Advanced legacy page-niche categories to exclude from advertiser page niches. |

Response: `PublicApiGetAdvertisersResponseDto` — Paginated advertisers query response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiGetAdvertisersResponseDto`)

### `GET /v1/advertisers/{advertiserId}/ads` — List ads for an advertiser

**Billing:** Free / no documented credit charge  
**Description:** Returns a paginated list of ads for the requested page-centric advertiser. In this first MVP iteration, advertiserId resolves directly from the Facebook page id.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `advertiserId` | path | string | yes | Public advertiser identifier. Current MVP uses the Facebook page id directly. |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |
| `status` | query | enum[all, active, inactive] |  | Filter ads by activity status. Allowed values: `all`, `active`, `inactive`. |
| `mediaType` | query | enum[all, image, video] |  | Filter ads by creative media type. Allowed values: `all`, `image`, `video`. |
| `sortBy` | query | enum[newest, createdAt, longestRunning, reach, duplicates] |  | Sort key for advertiser ads. `reach` uses the public reach/impressions metric; no `impressions` alias is accepted on this endpoint. |
| `order` | query | enum[asc, desc] |  | Sort direction. Allowed values: `asc`, `desc`. |
| `cpm` | query | integer |  | Optional CPM override used to compute estimated spend in the ads response. |

Response: `PublicApiGetAdvertiserAdsResponseDto` — Paginated advertiser ads response. The response also includes the X-Request-Id header.

**`PublicApiGetAdvertiserAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiAdSummaryDto> | yes |  |
| `pagination` | PublicApiAdvertiserAdsPaginationDto | yes |  |

**`PublicApiAdvertiserAdsPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `limit` | number | yes |  |
| `offset` | number | yes |  |
| `total` | number | yes |  |

### `GET /v1/advertisers/{advertiserId}` — Get advertiser detail

**Billing:** Free / no documented credit charge  
**Description:** Returns the page-centric advertiser detail. In this first MVP iteration, advertiserId resolves directly from the Facebook page id.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `advertiserId` | path | string | yes | Public advertiser identifier. Current MVP uses the Facebook page id directly. |

Response: `PublicApiGetAdvertiserDetailResponseDto` — Advertiser detail response. The response also includes the X-Request-Id header.

**`PublicApiGetAdvertiserDetailResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiAdvertiserDetailDto | yes |  |

**`PublicApiAdvertiserDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Current MVP uses the Facebook page id directly as the public advertiser id. |
| `platform` | enum[facebook] | yes |  |
| `facebookPageId` | string | yes |  |
| `name` | string | yes |  |
| `logoUrl` | string | yes |  |
| `profile` | PublicApiAdvertiserProfileDto | yes |  |
| `linkedShops` | array<PublicApiAdvertiserLinkedShopDto> | yes |  |
| `advertising` | PublicApiAdvertiserAdvertisingDto | yes |  |
| `lastAds` | array<PublicApiAdSummaryDto> | yes | Most recent advertiser ads using the shared public ad summary contract. |

**`PublicApiAdvertiserLinkedShopDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `shopId` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |
| `isPrimary` | boolean | yes |  |

**`PublicApiAdvertiserAdvertisingDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `activeAds` | number | yes | Active ads count, preferring page-explorer running_ads_count with relational fallback when unavailable. |
| `reach30d` | number | yes | Advertiser reach over the last 30 days, preferring page-explorer eu_reach_30d with fb_page.impressions_last_month fallback when unavailable. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `countryDistribution` | array<PublicApiAdvertiserCountryDistributionDto> | yes |  |


---

## Brandtrackers

### `POST /v1/brandtrackers` — Create a brandtracker

**Billing:** Free / no documented credit charge  
**Description:** Creates or reactivates a workspace brandtracker by exactly one target identifier: facebookPageId, websiteId, shopId (alias of websiteId), or domain. Domains are normalized and must resolve to exactly one known website. State-changing create/reactivate requests consume one brandtracker create/delete quota unit and one active brandtracker slot; already-active no-ops return 200 and cost 0 units.

Request body: `CreatePublicApiBrandtrackerBodyDto`

**`CreatePublicApiBrandtrackerBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `facebookPageId` | string |  | Meta/Facebook page identifier to track. Exactly one of facebookPageId, websiteId, shopId, or domain is required. |
| `websiteId` | string |  | Website/shop identifier to track as a shop-level brandtracker. Exactly one target identifier is accepted. |
| `shopId` | string |  | Alias of websiteId for shop-oriented clients. Exactly one target identifier is accepted. |
| `domain` | string |  | Shop domain to resolve to exactly one known website and track as a shop-level brandtracker. Protocols, paths, and a leading www. are normalized away. |
| `folderId` | number |  | Initial workspace folder membership. Null or omitted attaches the brandtracker at root. |

Response: `PublicApiCreateBrandtrackerResponseDto` — Brandtracker creation response. The response also includes the X-Request-Id header.

**`PublicApiCreateBrandtrackerResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerSummaryDto | yes |  |
| `created` | boolean | yes | True when this call created or reactivated a workspace brandtracker; false when an active link already existed. |

**`PublicApiBrandtrackerSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `name` | string | yes |  |
| `facebookPageId` | string | yes |  |
| `workspaceLinkId` | number |  | Workspace link identifier. Present on mutation responses and useful for follow-up move/delete operations. |
| `targetType` | enum[shop, page] |  | Resolved tracked target type. Present on mutation responses. |
| `websiteId` | string |  | Resolved website/shop identifier when the brandtracker target is shop-level. |
| `domain` | string |  | Resolved canonical domain when the brandtracker target is shop-level. |
| `avatarUrl` | string | yes |  |
| `status` | PublicApiBrandtrackerStatusDto | yes |  |
| `workspaceAddedAt` | string | yes |  |
| `folder` | PublicApiBrandtrackerFolderDto | yes | Primary folder membership, ordered by folder rank, name, then id. Null when the tracked brand has no folder memberships. |
| `advertising` | PublicApiBrandtrackerAdvertisingDto | yes |  |
| `websites` | array<PublicApiBrandtrackerWebsiteDto> | yes |  |
| `totalTraffic` | number | yes |  |

**`PublicApiBrandtrackerStatusDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `isLoaded` | boolean | yes |  |
| `lastCrawledAt` | string | yes |  |

**`PublicApiBrandtrackerFolderDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `name` | string | yes |  |

**`PublicApiBrandtrackerAdvertisingDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `activeAds` | number | yes |  |
| `newAdsLastDay` | number | yes |  |
| `newAdsLast7Days` | number | yes |  |
| `newAdsLast30Days` | number | yes |  |

**`PublicApiBrandtrackerWebsiteDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `siteName` | string | yes |  |
| `trafficNumber` | number | yes |  |
| `trafficChange` | number | yes |  |
| `monthlyTraffic` | object | yes |  |
| `socialNetworks` | PublicApiBrandtrackerWebsiteSocialNetworksDto | yes |  |

### `GET /v1/brandtrackers` — List brandtrackers

**Billing:** Free / no documented credit charge  
**Description:** Returns the workspace-scoped active brandtrackers attached to the authenticated public API workspace. The public identifier is brandtracker.id; legacy spyders.uuid values are accepted when migration metadata exists.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `hasNewAdsSince` | query | string |  | ISO date/time lower bound. Returns brandtrackers with positive new-ad deltas recorded on or after this timestamp. |
| `name` | query | string |  | Case-insensitive contains match against brandtracker name. |
| `sortBy` | query | enum[newAdsLastDay, newAdsLast7Days, newAdsLast30Days, activeAds, totalTraffic, name, createdAt] |  | Sort key. Metric and createdAt sorts are descending; name sorts ascending. Omit to preserve default workspace ordering. |
| `folderIds` | query | array<integer> |  | Folder ids. Repeated query params and comma-separated values are both accepted. |
| `folderNames` | query | array<string> |  | Folder name search terms. Matches are case-insensitive contains checks. Repeated query params and comma-separated values are both accepted. |

Response: `PublicApiGetBrandtrackersResponseDto` — Paginated brandtrackers response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerSummaryDto> | yes |  |
| `pagination` | PublicApiBrandtrackersPaginationDto | yes |  |

**`PublicApiBrandtrackersPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes |  |
| `total` | number | yes |  |
| `totalPages` | number | yes |  |

### `POST /v1/brandtrackers/folders` — Create a brandtracker folder

**Billing:** Free / no documented credit charge  
**Description:** Creates a workspace brandtracker folder and assigns the next rank atomically. Folder mutations are workspace-scoped, metered, and audited.

Request body: `CreatePublicApiBrandtrackerFolderBodyDto`

**`CreatePublicApiBrandtrackerFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | Workspace-scoped folder name. Rank is assigned atomically as the next workspace rank. |

Response: `PublicApiBrandtrackerFolderMutationResponseDto` — Brandtracker folder creation response.

**`PublicApiBrandtrackerFolderMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiWorkspaceFolderDto | yes |  |

**`PublicApiWorkspaceFolderDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `name` | string | yes |  |
| `rank` | number | yes |  |
| `brandtrackerCount` | number | yes | Number of active brandtrackers currently assigned to this folder. |

### `GET /v1/brandtrackers/folders` — List brandtracker folders

**Billing:** Free / no documented credit charge  
**Description:** Returns the active workspace brandtracker folders so clients can resolve folder ids for brandtracker filters. Equivalent folder listing is also available at GET /v1/workspace/folders.

Response: `PublicApiGetWorkspaceFoldersResponseDto` — Brandtracker folders. The response also includes the X-Request-Id header.

**`PublicApiGetWorkspaceFoldersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiWorkspaceFolderDto> | yes |  |

### `PATCH /v1/brandtrackers/folders/{folderId}` — Rename a brandtracker folder

**Billing:** Free / no documented credit charge  
**Description:** Renames a workspace brandtracker folder. The folder id must belong to the authenticated workspace; cross-workspace ids are returned as not found before any state change.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | integer | yes |  |

Request body: `RenamePublicApiBrandtrackerFolderBodyDto`

**`RenamePublicApiBrandtrackerFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | New workspace-scoped folder name. |

Response: `PublicApiBrandtrackerFolderMutationResponseDto` — Brandtracker folder rename response.
(schema documented above under `PublicApiBrandtrackerFolderMutationResponseDto`)

### `DELETE /v1/brandtrackers/folders/{folderId}` — Delete a brandtracker folder

**Billing:** Free / no documented credit charge  
**Description:** Deletes a workspace folder. move-to-default moves active brandtrackers to root; delete-brandtrackers deactivates affected workspace links. confirm must be true. The delete-brandtrackers action consumes one persistent brandtracker create/delete quota operation for the whole folder and decrements active brandtracker usage by the affected active-link count; no partial mutation is committed when quota is exhausted.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | integer | yes |  |

Request body: `DeletePublicApiBrandtrackerFolderBodyDto`

**`DeletePublicApiBrandtrackerFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `action` | enum[move-to-default, delete-brandtrackers] | yes | move-to-default keeps affected trackers active and clears their folder. delete-brandtrackers deactivates affected active workspace links, consumes one persistent create/delete quota unit for the whole folder delete, and decrements active brandtracker usage by affectedCount. |
| `confirm` | boolean | yes | Must be true for destructive folder delete requests. |

Response: `PublicApiDeleteBrandtrackerFolderResponseDto` — Brandtracker folder delete response.

**`PublicApiDeleteBrandtrackerFolderResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiDeleteBrandtrackerFolderDataDto | yes |  |

**`PublicApiDeleteBrandtrackerFolderDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `deleted` | boolean | yes |  |
| `action` | enum[move-to-default, delete-brandtrackers] | yes |  |
| `affectedCount` | number | yes | Number of active workspace links moved to root or deactivated by the folder delete action. |

### `PATCH /v1/brandtrackers/workspace-links` — Replace brandtracker folder memberships

**Billing:** Free / no documented credit charge  
**Description:** Replaces all folder memberships for active workspace brandtracker links addressed by exactly one set: brandtrackerIds or workspaceLinkIds. The destination folder id must belong to the authenticated workspace; null removes all memberships and moves links to root. Move operations are metered and audited but do not consume persistent create/delete quota or change active brandtracker usage.

Request body: `MovePublicApiBrandtrackerWorkspaceLinksBodyDto`

**`MovePublicApiBrandtrackerWorkspaceLinksBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtrackerIds` | array<string> |  | Public brandtracker ids to move. Exactly one of brandtrackerIds or workspaceLinkIds is required. |
| `workspaceLinkIds` | array<number> |  | Workspace link ids to move. Exactly one of brandtrackerIds or workspaceLinkIds is required. |
| `folderId` | number | yes | Sole destination workspace folder id, or null to remove all folder memberships and move to root. |

Response: `PublicApiBrandtrackerWorkspaceLinksMutationResponseDto` — Brandtracker workspace-link move response.

**`PublicApiBrandtrackerWorkspaceLinksMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiBrandtrackerWorkspaceLinksMutationDataDto | yes |  |

**`PublicApiBrandtrackerWorkspaceLinksMutationDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestedCount` | number | yes | Deduplicated number of requested ids in the submitted address set. |
| `affectedCount` | number | yes | Number of active workspace links changed. Cross-workspace, inactive, or unknown ids are excluded and reported as not found where safe. |
| `notFoundBrandtrackerIds` | array<string> |  | Requested public brandtracker ids that did not resolve to active links in this workspace. |
| `notFoundWorkspaceLinkIds` | array<number> |  | Requested workspace link ids that did not resolve to active links in this workspace. |

### `DELETE /v1/brandtrackers/workspace-links` — Bulk delete brandtracker workspace links

**Billing:** Free / no documented credit charge  
**Description:** Deactivates active workspace brandtracker links by exactly one address set: brandtrackerIds or workspaceLinkIds. confirm must be true. Bulk delete consumes one persistent brandtracker create/delete quota operation for the request, reports requested/affected/not-found ids, and decrements active brandtracker usage by the affected active-link count.

Request body: `DeletePublicApiBrandtrackerWorkspaceLinksBodyDto`

**`DeletePublicApiBrandtrackerWorkspaceLinksBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtrackerIds` | array<string> |  | Public brandtracker ids to delete. Exactly one of brandtrackerIds or workspaceLinkIds is required. |
| `workspaceLinkIds` | array<number> |  | Workspace link ids to delete. Exactly one of brandtrackerIds or workspaceLinkIds is required. |
| `confirm` | boolean | yes | Must be true for destructive bulk delete requests. |

Response: `PublicApiBrandtrackerWorkspaceLinksMutationResponseDto` — Brandtracker workspace-link delete response.
(schema documented above under `PublicApiBrandtrackerWorkspaceLinksMutationResponseDto`)

### `DELETE /v1/brandtrackers/{brandtrackerId}` — Delete a brandtracker

**Billing:** Free / no documented credit charge  
**Description:** Marks the workspace brandtracker inactive while preserving the workspace link and workspace-scoped metadata for reconstructability/reactivation. The shared global brandtracker row is preserved.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |

Response: `PublicApiDeleteBrandtrackerResponseDto` — Brandtracker delete response. The response also includes the X-Request-Id header.

**`PublicApiDeleteBrandtrackerResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiDeleteBrandtrackerDataDto | yes |  |

**`PublicApiDeleteBrandtrackerDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `deleted` | boolean | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}` — Get a brandtracker

**Billing:** Free / no documented credit charge  
**Description:** Returns the detail payload for one active workspace brandtracker resolved from brandtracker.id.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |

Response: `PublicApiGetBrandtrackerDetailResponseDto` — Brandtracker detail response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerDetailResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerDetailDto | yes |  |

**`PublicApiBrandtrackerDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `name` | string | yes |  |
| `facebookPageId` | string | yes |  |
| `workspaceLinkId` | number |  | Workspace link identifier. Present on mutation responses and useful for follow-up move/delete operations. |
| `targetType` | enum[shop, page] |  | Resolved tracked target type. Present on mutation responses. |
| `websiteId` | string |  | Resolved website/shop identifier when the brandtracker target is shop-level. |
| `domain` | string |  | Resolved canonical domain when the brandtracker target is shop-level. |
| `avatarUrl` | string | yes |  |
| `status` | PublicApiBrandtrackerStatusDto | yes |  |
| `workspaceAddedAt` | string | yes |  |
| `folder` | PublicApiBrandtrackerFolderDto | yes | Primary folder membership, ordered by folder rank, name, then id. Null when the tracked brand has no folder memberships. |
| `advertising` | PublicApiBrandtrackerAdvertisingDto | yes |  |
| `websites` | array<PublicApiBrandtrackerWebsiteDto> | yes |  |
| `totalTraffic` | number | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `pageProfile` | PublicApiBrandtrackerPageProfileDto | yes |  |
| `statistics` | PublicApiBrandtrackerStatisticsDto | yes |  |

**`PublicApiBrandtrackerPageProfileDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `about` | string | yes |  |
| `category` | string | yes |  |
| `facebookLikes` | number | yes |  |
| `instagramFollowers` | number | yes |  |
| `instagramUsername` | string | yes |  |
| `profileUri` | string | yes |  |
| `runningAds` | number | yes |  |

**`PublicApiBrandtrackerStatisticsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `urlCount` | object | yes |  |
| `ctaCount` | object | yes |  |
| `liveAdCount` | PublicApiBrandtrackerLiveAdCountDto | yes |  |
| `formatCount` | object | yes |  |
| `euData` | object | yes |  |

### `GET /v1/brandtrackers/folders/{folderId}/brandtrackers` — List brandtrackers in a folder

**Billing:** Free / no documented credit charge  
**Description:** Returns the workspace-scoped active brandtrackers assigned to the requested folder. This is equivalent to /v1/brandtrackers?folderIds=:folderId.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | integer | yes | Workspace brandtracker folder id. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `hasNewAdsSince` | query | string |  | ISO date/time lower bound. Returns brandtrackers with positive new-ad deltas recorded on or after this timestamp. |
| `name` | query | string |  | Case-insensitive contains match against brandtracker name. |
| `sortBy` | query | enum[newAdsLastDay, newAdsLast7Days, newAdsLast30Days, activeAds, totalTraffic, name, createdAt] |  | Sort key. Metric and createdAt sorts are descending; name sorts ascending. Omit to preserve default workspace ordering. |

Response: `PublicApiGetBrandtrackersResponseDto` — Paginated folder brandtrackers response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiGetBrandtrackersResponseDto`)

### `GET /v1/brandtrackers/{brandtrackerId}/snapshots` — List brandtracker snapshot dates

**Billing:** Free / no documented credit charge  
**Description:** Returns available ad reach snapshot dates and readiness status for one active workspace brandtracker. latestDate is preserved as a compatibility alias of latestReadyDate; snapshotDate=latest resolves to the latest ready date.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of snapshot dates to return. Defaults to 100. |

Response: `PublicApiGetBrandtrackerSnapshotsResponseDto` — Paginated brandtracker snapshot dates response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerSnapshotsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerSnapshotsDto | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerSnapshotsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `latestDate` | string | yes | Deprecated compatibility alias of latestReadyDate. Latest ready snapshot date for this brandtracker, or null when no ready snapshots exist. |
| `latestReadyDate` | string | yes | Latest snapshot date with usable reach rows for this brandtracker, or null when no ready snapshots exist. |
| `latestScheduledDate` | string | yes | Latest indexed/scheduled snapshot date seen for this brandtracker, even if its usable reach rows are not ready yet. |
| `dates` | array<string> | yes | Available snapshot dates in descending order. Preserved for backwards compatibility; mirrors snapshots[].date. |
| `snapshots` | array<PublicApiSnapshotStatusDto> | yes | Snapshot dates with readiness status and row counts in descending date order. |

**`PublicApiSnapshotStatusDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `date` | string | yes | Snapshot date in YYYY-MM-DD format. |
| `status` | enum[ready, indexing, scheduled] | yes | Readiness status. ready means usable reach rows exist; indexing means raw rows exist but no usable reach rows yet; scheduled is reserved for future scheduler-only dates. |
| `usableRows` | number | yes | Rows with usable reach metrics for this snapshot date and brandtracker/page scope. |
| `indexedRows` | number | yes | Raw indexed reach-history rows for this snapshot date and brandtracker/page scope. |

**`PublicApiBrandtrackerInsightsPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes |  |
| `total` | number | yes |  |
| `totalPages` | number | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/ads` — List brandtracker ads

**Billing:** Free / no documented credit charge  
**Description:** Returns the Meta ads for one active workspace brandtracker resolved from brandtracker.id to fb_page_id. The response reuses the public ad summary shape.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `sortBy` | query | enum[newest, createdAt, longestRunning, reach, duplicates, adOrder, relevance] |  | Sort key. The adOrder value also accepts ad_order and ad-order aliases. |
| `status` | query | enum[all, active, inactive] |  | Status filter for this request. Allowed values: `all`, `active`, `inactive`. |
| `mediaType` | query | enum[all, image, video] |  | Enum value accepted by this request. Allowed values: `all`, `image`, `video`. |
| `keywords` | query | array<string> |  | Keyword search terms. Repeated query params and comma-separated values are both accepted. |
| `keywordMode` | query | enum[any, all] |  | Enum value accepted by this request. Allowed values: `any`, `all`. |
| `createdAfter` | query | string |  |  |
| `createdBefore` | query | string |  |  |
| `minDaysRunning` | query | integer |  |  |
| `maxDaysRunning` | query | integer |  |  |
| `minDuplicates` | query | integer |  |  |
| `maxDuplicates` | query | integer |  |  |
| `landingPages` | query | array<string> |  | Landing page URLs. Repeated query params and comma-separated values are both accepted. |
| `adLanguage` | query | array<string> |  | Ad languages. Repeated query params and comma-separated values are both accepted. |
| `cta` | query | array<string> |  | Call-to-action labels. Repeated query params and comma-separated values are both accepted. |
| `adCopyHashes` | query | array<string> |  | 12-character MD5 prefixes for ad copy descriptions. |
| `adCountries` | query | string |  | Comma-separated country include/exclude filters. |
| `mainCountries` | query | array<string> |  | Main ad countries. Repeated query params and comma-separated values are both accepted. |
| `euOnly` | query | boolean |  | When true, keep only ads flagged as EU ads. |
| `partners` | query | boolean |  | When true, keep only partnership ads. When false, keep only non-partnership ads. |
| `partnerIds` | query | array<string> |  | Partner identifiers. Repeated query params and comma-separated values are both accepted. |
| `minReach` | query | integer |  | Minimum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `maxReach` | query | integer |  | Maximum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `cpm` | query | number |  | CPM used to convert spend filters into reach thresholds. |
| `minSpend` | query | number |  |  |
| `maxSpend` | query | number |  |  |
| `spendPeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `minSpendPerPage` | query | number |  |  |
| `maxSpendPerPage` | query | number |  |  |
| `spendPerPagePeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `hideLowReach` | query | boolean |  | When true, hides ads flagged as low reach. |
| `minAge` | query | integer |  |  |
| `maxAge` | query | integer |  |  |
| `sex` | query | enum[men, women, all] |  | Enum value accepted by this request. Allowed values: `men`, `women`, `all`. |
| `minFacebookLikes` | query | integer |  |  |
| `maxFacebookLikes` | query | integer |  |  |
| `minInstagramFollowers` | query | integer |  |  |
| `maxInstagramFollowers` | query | integer |  |  |
| `minVideoDuration` | query | number |  |  |
| `maxVideoDuration` | query | number |  |  |
| `minDescriptionLength` | query | integer |  |  |
| `maxDescriptionLength` | query | integer |  |  |
| `linkedDomain` | query | string |  | Linked domain filter. URLs are normalized to their hostname before validation. |
| `growthRank` | query | array<enum[rising, falling, stable]> |  | Rank trend filters. Repeated query params and comma-separated values are both accepted. |
| `snapshotDate` | query | string |  | Snapshot date (YYYY-MM-DD or latest). When present, status is interpreted as active at this date. |

Response: `PublicApiGetBrandtrackerAdsResponseDto` — Paginated brandtracker ads response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiAdSummaryDto> | yes |  |
| `pagination` | PublicApiAdsPaginationDto | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/partnership-ads` — List brandtracker partnership ads

**Billing:** Free / no documented credit charge  
**Description:** Returns deduped Meta partnership ad groups for one active workspace brandtracker. This endpoint always filters to ads with a partner badge and reuses the public ad summary shape.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `sortBy` | query | enum[newest, createdAt, longestRunning, reach, duplicates, adOrder, relevance] |  | Sort key. The adOrder value also accepts ad_order and ad-order aliases. |
| `status` | query | enum[all, active, inactive] |  | Status filter for this request. Allowed values: `all`, `active`, `inactive`. |
| `mediaType` | query | enum[all, image, video] |  | Enum value accepted by this request. Allowed values: `all`, `image`, `video`. |
| `keywords` | query | array<string> |  | Keyword search terms. Repeated query params and comma-separated values are both accepted. |
| `keywordMode` | query | enum[any, all] |  | Enum value accepted by this request. Allowed values: `any`, `all`. |
| `createdAfter` | query | string |  |  |
| `createdBefore` | query | string |  |  |
| `minDaysRunning` | query | integer |  |  |
| `maxDaysRunning` | query | integer |  |  |
| `minDuplicates` | query | integer |  |  |
| `maxDuplicates` | query | integer |  |  |
| `landingPages` | query | array<string> |  | Landing page URLs. Repeated query params and comma-separated values are both accepted. |
| `adLanguage` | query | array<string> |  | Ad languages. Repeated query params and comma-separated values are both accepted. |
| `cta` | query | array<string> |  | Call-to-action labels. Repeated query params and comma-separated values are both accepted. |
| `adCopyHashes` | query | array<string> |  | 12-character MD5 prefixes for ad copy descriptions. |
| `adCountries` | query | string |  | Comma-separated country include/exclude filters. |
| `mainCountries` | query | array<string> |  | Main ad countries. Repeated query params and comma-separated values are both accepted. |
| `euOnly` | query | boolean |  | When true, keep only ads flagged as EU ads. |
| `partnerIds` | query | array<string> |  | Partner identifiers. Repeated query params and comma-separated values are both accepted. |
| `minReach` | query | integer |  | Minimum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `maxReach` | query | integer |  | Maximum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `cpm` | query | number |  | CPM used to convert spend filters into reach thresholds. |
| `minSpend` | query | number |  |  |
| `maxSpend` | query | number |  |  |
| `spendPeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `minSpendPerPage` | query | number |  |  |
| `maxSpendPerPage` | query | number |  |  |
| `spendPerPagePeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `hideLowReach` | query | boolean |  | When true, hides ads flagged as low reach. |
| `minAge` | query | integer |  |  |
| `maxAge` | query | integer |  |  |
| `sex` | query | enum[men, women, all] |  | Enum value accepted by this request. Allowed values: `men`, `women`, `all`. |
| `minFacebookLikes` | query | integer |  |  |
| `maxFacebookLikes` | query | integer |  |  |
| `minInstagramFollowers` | query | integer |  |  |
| `maxInstagramFollowers` | query | integer |  |  |
| `minVideoDuration` | query | number |  |  |
| `maxVideoDuration` | query | number |  |  |
| `minDescriptionLength` | query | integer |  |  |
| `maxDescriptionLength` | query | integer |  |  |
| `linkedDomain` | query | string |  | Linked domain filter. URLs are normalized to their hostname before validation. |
| `growthRank` | query | array<enum[rising, falling, stable]> |  | Rank trend filters. Repeated query params and comma-separated values are both accepted. |
| `snapshotDate` | query | string |  | Snapshot date (YYYY-MM-DD or latest). When present, status is interpreted as active at this date. |
| `partnerId` | query | string |  | Single partner identifier alias. It is merged with partnerIds when both are provided. |

Response: `PublicApiGetBrandtrackerAdsResponseDto` — Paginated brandtracker partnership ads response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiGetBrandtrackerAdsResponseDto`)

### `GET /v1/brandtrackers/{brandtrackerId}/partnership-ads/count` — Count brandtracker partnership ads

**Billing:** Free / no documented credit charge  
**Description:** Returns the deduped public ad group count matching the partnership ads list filters. This intentionally matches public list pagination semantics rather than the webapp raw active badge count.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `status` | query | enum[all, active, inactive] |  | Status filter for this request. Allowed values: `all`, `active`, `inactive`. |
| `mediaType` | query | enum[all, image, video] |  | Enum value accepted by this request. Allowed values: `all`, `image`, `video`. |
| `keywords` | query | array<string> |  | Keyword search terms. Repeated query params and comma-separated values are both accepted. |
| `keywordMode` | query | enum[any, all] |  | Enum value accepted by this request. Allowed values: `any`, `all`. |
| `createdAfter` | query | string |  |  |
| `createdBefore` | query | string |  |  |
| `minDaysRunning` | query | integer |  |  |
| `maxDaysRunning` | query | integer |  |  |
| `minDuplicates` | query | integer |  |  |
| `maxDuplicates` | query | integer |  |  |
| `landingPages` | query | array<string> |  | Landing page URLs. Repeated query params and comma-separated values are both accepted. |
| `adLanguage` | query | array<string> |  | Ad languages. Repeated query params and comma-separated values are both accepted. |
| `cta` | query | array<string> |  | Call-to-action labels. Repeated query params and comma-separated values are both accepted. |
| `adCopyHashes` | query | array<string> |  | 12-character MD5 prefixes for ad copy descriptions. |
| `adCountries` | query | string |  | Comma-separated country include/exclude filters. |
| `mainCountries` | query | array<string> |  | Main ad countries. Repeated query params and comma-separated values are both accepted. |
| `euOnly` | query | boolean |  | When true, keep only ads flagged as EU ads. |
| `partnerIds` | query | array<string> |  | Partner identifiers. Repeated query params and comma-separated values are both accepted. |
| `minReach` | query | integer |  | Minimum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `maxReach` | query | integer |  | Maximum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `cpm` | query | number |  | CPM used to convert spend filters into reach thresholds. |
| `minSpend` | query | number |  |  |
| `maxSpend` | query | number |  |  |
| `spendPeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `minSpendPerPage` | query | number |  |  |
| `maxSpendPerPage` | query | number |  |  |
| `spendPerPagePeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `hideLowReach` | query | boolean |  | When true, hides ads flagged as low reach. |
| `minAge` | query | integer |  |  |
| `maxAge` | query | integer |  |  |
| `sex` | query | enum[men, women, all] |  | Enum value accepted by this request. Allowed values: `men`, `women`, `all`. |
| `minFacebookLikes` | query | integer |  |  |
| `maxFacebookLikes` | query | integer |  |  |
| `minInstagramFollowers` | query | integer |  |  |
| `maxInstagramFollowers` | query | integer |  |  |
| `minVideoDuration` | query | number |  |  |
| `maxVideoDuration` | query | number |  |  |
| `minDescriptionLength` | query | integer |  |  |
| `maxDescriptionLength` | query | integer |  |  |
| `linkedDomain` | query | string |  | Linked domain filter. URLs are normalized to their hostname before validation. |
| `growthRank` | query | array<enum[rising, falling, stable]> |  | Rank trend filters. Repeated query params and comma-separated values are both accepted. |
| `snapshotDate` | query | string |  | Snapshot date (YYYY-MM-DD or latest). When present, status is interpreted as active at this date. |
| `partnerId` | query | string |  | Single partner identifier alias. It is merged with partnerIds when both are provided. |

Response: `PublicApiGetBrandtrackerPartnershipAdsCountResponseDto` — Brandtracker partnership ads count response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerPartnershipAdsCountResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerPartnershipAdsCountDto | yes |  |

**`PublicApiBrandtrackerPartnershipAdsCountDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `count` | number | yes | Deduped public ad groups matching the partnership ads list filters. |

### `GET /v1/brandtrackers/{brandtrackerId}/hooks` — Get brandtracker hooks

**Billing:** Free / no documented credit charge  
**Description:** Returns grouped hook analytics for the requested brandtracker using the authenticated workspace as the only access scope.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[usageCount, longestRunning, totalImpressions, firstUsedAt, lastUsedAt] |  | Optional hook sorting. Defaults to usageCount. |

Response: `PublicApiGetBrandtrackerHooksResponseDto` — Paginated brandtracker hooks analytics response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerHooksResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerHookDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerHookDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `hook` | string | yes |  |
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |
| `totalImpressions` | number | yes | Total impressions/reach contributed by ads using this hook. This aligns with Meta Ad Library reach vocabulary used elsewhere in the ads API. |
| `firstUsedAt` | string | yes |  |
| `lastUsedAt` | string | yes |  |
| `sampleAd` | PublicApiBrandtrackerHookSampleAdDto | yes |  |

**`PublicApiBrandtrackerHookSampleAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adId` | string | yes |  |
| `mediaUrl` | string | yes |  |
| `thumbnailUrl` | string | yes |  |
| `fullText` | string | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/transcripts` — Get brandtracker transcripts

**Billing:** Free / no documented credit charge  
**Description:** Returns grouped transcript/script analytics for the requested brandtracker using the authenticated workspace as the only access scope.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[usageCount, longestRunning, totalImpressions, firstUsedAt, lastUsedAt] |  | Optional transcript sorting. Defaults to usageCount. |

Response: `PublicApiGetBrandtrackerTranscriptsResponseDto` — Paginated brandtracker transcripts analytics response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerTranscriptsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerTranscriptDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerTranscriptDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `fullText` | string | yes |  |
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |
| `totalImpressions` | number | yes | Total impressions/reach contributed by ads using this transcript. This aligns with Meta Ad Library reach vocabulary used elsewhere in the ads API. |
| `firstUsedAt` | string | yes |  |
| `lastUsedAt` | string | yes |  |
| `sampleAd` | PublicApiBrandtrackerTranscriptSampleAdDto | yes |  |

**`PublicApiBrandtrackerTranscriptSampleAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adId` | string | yes |  |
| `mediaUrl` | string | yes |  |
| `thumbnailUrl` | string | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/headlines` — Get brandtracker headlines

**Billing:** Free / no documented credit charge  
**Description:** Returns grouped headline analytics for the requested brandtracker.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[usageCount, longestRunning] |  | Optional headline sorting. Defaults to usageCount. |

Response: `PublicApiGetBrandtrackerHeadlinesResponseDto` — Paginated brandtracker headlines analytics response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerHeadlinesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerHeadlineDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerHeadlineDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `headline` | string | yes |  |
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/ad-copies` — Get brandtracker ad copies

**Billing:** Free / no documented credit charge  
**Description:** Returns grouped ad copy analytics for the requested brandtracker.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[usageCount, longestRunning] |  | Optional ad copy sorting. Defaults to usageCount. |

Response: `PublicApiGetBrandtrackerAdCopiesResponseDto` — Paginated brandtracker ad copies analytics response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerAdCopiesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerAdCopyDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerAdCopyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adCopy` | string | yes |  |
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/landing-pages` — Get brandtracker landing pages

**Billing:** Free / no documented credit charge  
**Description:** Returns grouped landing page analytics for the requested brandtracker, including detected technologies when available.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[usageCount, longestRunning, totalImpressions] |  | Optional landing page sorting. Defaults to usageCount. |

Response: `PublicApiGetBrandtrackerLandingPagesResponseDto` — Paginated brandtracker landing pages analytics response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerLandingPagesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerLandingPageDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerLandingPageDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `landingPage` | string | yes |  |
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |
| `totalImpressions` | number | yes | Total impressions/reach contributed by ads pointing to this landing page. This aligns with Meta Ad Library reach vocabulary used elsewhere in the ads API. |
| `technologies` | array<PublicApiBrandtrackerTechnologyDto> | yes |  |
| `screenshots` | PublicApiBrandtrackerLandingPageScreenshotsDto | yes | Best-effort landing page screenshot preview URLs from the screenshots table. |

**`PublicApiBrandtrackerTechnologyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `iconUrl` | string | yes |  |

**`PublicApiBrandtrackerLandingPageScreenshotsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `desktop` | object | yes | Latest desktop/full-page screenshot URL when available. |
| `mobile` | object | yes | Latest mobile screenshot URL when available. |
| `head` | object | yes | Latest above-the-fold/head screenshot URL when available. |

### `GET /v1/brandtrackers/{brandtrackerId}/landing-pages/simple` — Get normalized brandtracker landing pages

**Billing:** Free / no documented credit charge  
**Description:** Returns normalized/grouped landing page analytics for the requested brandtracker. Query strings, fragments, trailing slashes, and leading www. hostnames are ignored for grouping.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[usageCount, activeAdsCount] |  | Optional normalized landing page sorting. Defaults to usageCount. |

Response: `PublicApiGetBrandtrackerLandingPagesSimpleResponseDto` — Paginated normalized brandtracker landing pages analytics response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerLandingPagesSimpleResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerLandingPageSimpleDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerLandingPageSimpleDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `landingPage` | string | yes | Representative landing page URL with query string, fragment, and trailing slash removed. |
| `normalizedLandingPage` | string | yes | Normalized grouping key. Hostname is lowercased and leading www. is removed; query strings and fragments are ignored. |
| `usageCount` | number | yes |  |
| `activeAdsCount` | number | yes | Number of currently active ads in this group for rolling windows. For live and snapshot queries this matches usageCount. |
| `technologies` | array<PublicApiBrandtrackerTechnologyDto> | yes |  |
| `screenshots` | PublicApiBrandtrackerLandingPageScreenshotsDto | yes | Best-effort landing page screenshot preview URLs from the screenshots table. |

### `GET /v1/brandtrackers/{brandtrackerId}/creatives` — Get brandtracker creatives

**Billing:** Free / no documented credit charge  
**Description:** Returns paginated creative analytics for the requested brandtracker.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[firstSeenAt, daysRunning, duplicates] |  | Optional creatives sorting. Defaults to firstSeenAt. |
| `mediaType` | query | enum[all, image, video] |  | Optional media type filter. Defaults to all. |

Response: `PublicApiGetBrandtrackerCreativesResponseDto` — Paginated brandtracker creatives response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerCreativesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerCreativeDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerCreativeDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adId` | string | yes |  |
| `mediaType` | enum[image, video, unknown] | yes |  |
| `mediaUrl` | string | yes |  |
| `thumbnailUrl` | string | yes |  |
| `firstSeenAt` | string | yes |  |
| `daysRunning` | number | yes |  |
| `duplicates` | number | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/partners` — Get brandtracker partners

**Billing:** Free / no documented credit charge  
**Description:** Returns paginated partnership analytics for the requested brandtracker.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Relative insights time window. Use stable windows like last7d or last30d for consistent agent behavior. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `snapshotDate` | query | string |  | Optional snapshot anchor date (YYYY-MM-DD). When provided, the requested window is evaluated against that snapshot date. |
| `sortBy` | query | enum[activeAds, launchDate, reach, estimatedSpend] |  | Optional partners sorting. Defaults to activeAds. |
| `cpm` | query | number |  | Optional CPM used to estimate spend from reach. Defaults to 9. |

Response: `PublicApiGetBrandtrackerPartnersResponseDto` — Paginated brandtracker partners response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerPartnersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerPartnerDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerPartnerDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `facebookPageId` | string | yes |  |
| `name` | string | yes |  |
| `activeAds` | number | yes |  |
| `launchDate` | string | yes |  |
| `reach` | number | yes | Partner ad reach. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `estimatedSpend` | number | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/media-mix` — Get brandtracker media mix

**Billing:** Free / no documented credit charge  
**Description:** Returns the media-format breakdown (image, video, dco, other) for the brandtracker's deduped currently active ads, or a deduped snapshot reconstruction when a snapshotDate is provided. activeAds equals the sum of the media buckets.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `snapshotDate` | query | string |  | Optional snapshot date (YYYY-MM-DD or latest). When provided, the mix is reconstructed for that date; otherwise it uses live active ads. Counts are deduped by ad before media buckets are calculated. |

Response: `PublicApiGetBrandtrackerMediaMixResponseDto` — Brandtracker media mix response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerMediaMixResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerMediaMixDto | yes |  |
| `meta` | PublicApiFreshnessMetaDto | yes |  |

**`PublicApiBrandtrackerMediaMixDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `activeAds` | number | yes | Number of deduped eligible ads in the media mix. Equals image + video + dco + other. |
| `formatCount` | PublicApiBrandtrackerMediaMixFormatCountDto | yes | Media-format buckets counted from the same deduped eligible-ad set as activeAds. Carousel is not exposed as a separate media-mix bucket; carousel creatives are currently folded into image, video, dco, or other based on the indexed media format. |

**`PublicApiBrandtrackerMediaMixFormatCountDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `image` | number | yes |  |
| `video` | number | yes |  |
| `dco` | number | yes |  |
| `other` | number | yes |  |

**`PublicApiFreshnessMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestedSnapshotDate` | string | yes | Snapshot date requested by the client. Null when snapshotDate was omitted. |
| `resolvedSnapshotDate` | string | yes | Snapshot date actually used by the endpoint. Null when no ready snapshot was available or no snapshot resolution was needed. |
| `dataFreshnessLagDays` | number | yes | Difference in whole UTC days between today and the resolved snapshot date. Null when no snapshot was resolved. |
| `periodNote` | string |  | Optional note clarifying period-specific freshness behavior. |

### `GET /v1/brandtrackers/{brandtrackerId}/demography` — Get brandtracker demography

**Billing:** Free / no documented credit charge  
**Description:** Returns the EU country / age / gender reach distributions precomputed for the brandtracker. The underlying dataset is page-level and EU-only, so this endpoint is fundamentally EU-scoped.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `euOnly` | query | boolean |  | EU-only filter. This endpoint is fundamentally EU-scoped (the source data is the EU-only fb_page_reach_by_country table), so this defaults to true and is retained for forward compatibility. |
| `snapshotDate` | query | string |  | Optional snapshot date (YYYY-MM-DD or latest). The underlying demography data is currently a precomputed per-page snapshot (not time-windowed), so this parameter is accepted for forward compatibility but does not filter the result today. |
| `timePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Optional time window. The underlying demography data is currently a precomputed per-page snapshot (not time-windowed), so this parameter is accepted for forward compatibility but does not filter the result today. |

Response: `PublicApiGetBrandtrackerDemographyResponseDto` — Brandtracker demography distributions response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerDemographyResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerDemographyDto | yes |  |

**`PublicApiBrandtrackerDemographyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `hasData` | boolean | yes |  |
| `countryDistribution` | array<PublicApiBrandtrackerCountryDistributionPointDto> | yes |  |
| `ageDistribution` | array<PublicApiBrandtrackerAgeDistributionPointDto> | yes |  |
| `genderDistribution` | array<PublicApiBrandtrackerGenderDistributionPointDto> | yes |  |

**`PublicApiBrandtrackerCountryDistributionPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `countryCode` | string | yes |  |
| `reach` | number | yes | Reach attributed to this country. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |

**`PublicApiBrandtrackerAgeDistributionPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `ageRange` | string | yes |  |
| `reach` | number | yes | Reach attributed to this age range. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |

**`PublicApiBrandtrackerGenderDistributionPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `gender` | enum[female, male, unknown] | yes |  |
| `reach` | number | yes | Reach attributed to this gender bucket. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |

### `GET /v1/brandtrackers/{brandtrackerId}/top-ads` — Get current ranked top ads

**Billing:** Free / no documented credit charge  
**Description:** Canonical current-ranking endpoint for a brandtracker. Use sortBy=currentRank for the current Facebook page rank, sortBy=reach/reachDelta1d/reachDelta7d/reachDelta30d for reach rankings, and sortBy=rankDelta7d/rankDelta14d/rankDelta30d for rank movers. period and snapshotDate are deprecated compatibility parameters and are ignored on this current-ranking path.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `facebookPageId` | query | string |  | Optional Facebook page id belonging to this brandtracker. When omitted, the primary Facebook page is used. |
| `allFacebookPages` | query | boolean |  | When true, aggregate all selected Facebook pages. Current ranks are page-local, so ties across pages are expected. Cannot be combined with facebookPageId. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `sortBy` | query | enum[currentRank, rankDelta, rankDelta7d, rankDelta14d, rankDelta30d, reach, reachDelta1d, reachDelta7d, reachDelta30d, daysRunning, duplicates] |  | Sort key for canonical current rankings. Use currentRank for the selected Facebook page rank (returned as rank/currentRank); rankDelta7d, rankDelta14d, or rankDelta30d for movers; reach, reachDelta1d, reachDelta7d, or reachDelta30d for reach rankings. |
| `status` | query | enum[active, inactive, all] |  | Preferred activity filter. active returns active ads, inactive returns inactive ads, all returns both. When supplied, it takes precedence over includeInactive. |
| `includeInactive` | query | boolean |  | Deprecated. When status is omitted, includeInactive=true maps to status=all; ignored when status is supplied. |
| `period` | query | enum[today, yesterday, last1d, last7d, last14d, last30d, total] |  | Optional rolling top-ads period. Allowed values: today, yesterday, last1d, last7d, last14d, last30d, total. |
| `snapshotDate` | query | string | enum[latest] |  | Deprecated compatibility parameter accepted but ignored by canonical top-ads current ranking. Use freshness/system endpoints for snapshot availability checks. |

Response: `PublicApiGetBrandtrackerTopAdsResponseDto` — Paginated brandtracker top ads response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerTopAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerTopAdDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |
| `meta` | PublicApiTopAdsMetaDto |  | Optional empty-result diagnostics. Omitted on normal top-ads responses. |

**`PublicApiBrandtrackerTopAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `ad` | PublicApiAdSummaryDto | yes |  |
| `metrics` | PublicApiBrandtrackerTopAdMetricsDto | yes |  |

**`PublicApiBrandtrackerTopAdMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `totalReach` | number | yes | Total reach for the ranked ad. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric; EU impressions/reach are used where available. |
| `duplicateCount` | number | yes |  |
| `daysRunning` | number | yes |  |
| `currentRank` | number | yes |  |

**`PublicApiTopAdsMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `reason` | enum[no_snapshot_for_period, no_reach_history_for_period, no_matching_ads] |  | Present on empty result sets to distinguish filters with no matching ads. |

### `GET /v1/brandtrackers/{brandtrackerId}/ad-rank` — Get brandtracker ad rank compatibility data

**Billing:** Free / no documented credit charge  
**Description:** Compatibility endpoint for clients that still call /ad-rank. Prefer /v1/brandtrackers/{brandtrackerId}/top-ads?sortBy=rankDelta7d, rankDelta14d, or rankDelta30d for canonical rank movers and sortBy=currentRank for current ranking. Endpoint key, billing, and response envelope remain stable; snapshotDate is deprecated and ignored on the ES-backed path, and trajectory may be empty.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `timeWindow` | query | enum[last7d, last14d, last30d, 7d, 14d, 30d] |  | Scaling comparison window. Prefer stable windows (last7d or last14d) for agent workflows. |
| `sortBy` | query | enum[rankDelta, currentRank, rank_delta, current_rank] |  | Optional scaling ads sort key. Defaults to rankDelta. Also accepts legacy aliases rank_delta and current_rank. |
| `snapshotDate` | query | string |  | Deprecated compatibility parameter accepted but ignored on the ES-backed compatibility path. Use top-ads sortBy=rankDelta7d/14d/30d for canonical rank movers. |
| `maxCurrentRank` | query | integer |  | Optional maximum current rank filter. Only ads at or above this current rank are returned. |
| `minRankDelta` | query | integer |  | Minimum positive rank improvement required for an ad to be returned. Defaults to 1. |

Response: `PublicApiGetBrandtrackerScalingAdsResponseDto` — Paginated brandtracker ad rank response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerScalingAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerScalingAdDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |
| `meta` | PublicApiFreshnessMetaDto | yes |  |

**`PublicApiBrandtrackerScalingAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `ad` | PublicApiAdSummaryDto | yes |  |
| `metrics` | PublicApiBrandtrackerScalingAdMetricsDto | yes |  |
| `trajectory` | array<PublicApiBrandtrackerAdRankTrajectoryPointDto> | yes | Daily rank trajectory for this ad over the selected comparison window. |

**`PublicApiBrandtrackerScalingAdMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `currentRank` | number | yes |  |
| `previousRank` | number | yes |  |
| `rankDelta` | number | yes | Positive rank improvement over the selected comparison window. |
| `improvementPct` | object | yes | Percentage improvement from previousRank to currentRank over the selected comparison window. |

**`PublicApiBrandtrackerAdRankTrajectoryPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `date` | string | yes | Trajectory point date in YYYY-MM-DD format. |
| `rank` | number | yes |  |
| `totalAds` | object | yes | Estimated total ranked ads for this snapshot when available. |

### `GET /v1/brandtrackers/{brandtrackerId}/scaling-ads` — Get brandtracker scaling ads compatibility data

**Billing:** Free / no documented credit charge  
**Description:** Legacy compatibility endpoint for clients that still call /scaling-ads. Prefer /v1/brandtrackers/{brandtrackerId}/top-ads?sortBy=rankDelta7d, rankDelta14d, or rankDelta30d for canonical rank movers and sortBy=currentRank for current ranking. Endpoint key, billing, and response envelope remain stable; snapshotDate is deprecated and ignored on the ES-backed path, and trajectory may be empty.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of items to return. Defaults to 20. |
| `timeWindow` | query | enum[last7d, last14d, last30d, 7d, 14d, 30d] |  | Scaling comparison window. Prefer stable windows (last7d or last14d) for agent workflows. |
| `sortBy` | query | enum[rankDelta, currentRank, rank_delta, current_rank] |  | Optional scaling ads sort key. Defaults to rankDelta. Also accepts legacy aliases rank_delta and current_rank. |
| `snapshotDate` | query | string |  | Deprecated compatibility parameter accepted but ignored on the ES-backed compatibility path. Use top-ads sortBy=rankDelta7d/14d/30d for canonical rank movers. |
| `maxCurrentRank` | query | integer |  | Optional maximum current rank filter. Only ads at or above this current rank are returned. |
| `minRankDelta` | query | integer |  | Minimum positive rank improvement required for an ad to be returned. Defaults to 1. |

Response: `PublicApiGetBrandtrackerScalingAdsResponseDto` — Paginated brandtracker scaling ads response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiGetBrandtrackerScalingAdsResponseDto`)

### `GET /v1/brandtrackers/{brandtrackerId}/ad-copy-evolution` — Get brandtracker ad copy evolution

**Billing:** Free / no documented credit charge  
**Description:** Returns graph-ready ad copy evolution series for one active workspace brandtracker resolved from brandtracker.id. Provide adCopy for exact single-text mode, or omit it to page through bounded global series ranked by active ads.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Pagination page number for global mode. Exact mode always returns at most one series. |
| `limit` | query | integer |  | Number of series to return in global mode. Exact mode costs and returns one series. |
| `startDate` | query | string |  | Inclusive start date. Defaults to 365 days before the effective end date. |
| `endDate` | query | string |  | Inclusive end date. Defaults to today unless snapshotDate is provided. |
| `snapshotDate` | query | string |  | Optional snapshot date. When provided, it is used as the effective end date. |
| `adCopy` | query | string |  | Exact ad copy text to return as a single evolution series. Omit for global mode. |

Response: `PublicApiGetBrandtrackerAdCopyEvolutionResponseDto` — Paginated ad copy evolution response. Pagination is by distinct ad copy series and the response includes the X-Request-Id header.

**`PublicApiGetBrandtrackerAdCopyEvolutionResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `dateRange` | PublicApiBrandtrackerEvolutionDateRangeDto | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |
| `meta` | PublicApiFreshnessMetaDto | yes |  |
| `data` | array<PublicApiBrandtrackerAdCopyEvolutionSeriesDto> | yes |  |

**`PublicApiBrandtrackerEvolutionDateRangeDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `startDate` | string | yes |  |
| `endDate` | string | yes |  |

**`PublicApiBrandtrackerAdCopyEvolutionSeriesDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `adCopy` | string | yes |  |
| `points` | array<PublicApiBrandtrackerEvolutionPointDto> | yes |  |

**`PublicApiBrandtrackerEvolutionPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `date` | string | yes |  |
| `recordedAt` | string | yes | Timestamp of the history snapshot used for this point. |
| `activeAds` | number | yes |  |
| `totalAds` | number | yes |  |
| `euAds` | number | yes |  |
| `euActiveAds` | number | yes |  |
| `totalReach` | number | yes | Total reach at this history point. In Meta Ad Library vocabulary, reach is the public-facing impressions-style metric where available. |
| `percentNewAds` | number | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/headline-evolution` — Get brandtracker headline evolution

**Billing:** Free / no documented credit charge  
**Description:** Returns graph-ready headline evolution series for one active workspace brandtracker resolved from brandtracker.id. Provide headline for exact single-text mode, or omit it to page through bounded global series ranked by active ads.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Pagination page number for global mode. Exact mode always returns at most one series. |
| `limit` | query | integer |  | Number of series to return in global mode. Exact mode costs and returns one series. |
| `startDate` | query | string |  | Inclusive start date. Defaults to 365 days before the effective end date. |
| `endDate` | query | string |  | Inclusive end date. Defaults to today unless snapshotDate is provided. |
| `snapshotDate` | query | string |  | Optional snapshot date. When provided, it is used as the effective end date. |
| `headline` | query | string |  | Exact headline text to return as a single evolution series. Omit for global mode. |

Response: `PublicApiGetBrandtrackerHeadlineEvolutionResponseDto` — Paginated headline evolution response. Pagination is by distinct headline series and the response includes the X-Request-Id header.

**`PublicApiGetBrandtrackerHeadlineEvolutionResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `dateRange` | PublicApiBrandtrackerEvolutionDateRangeDto | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |
| `meta` | PublicApiFreshnessMetaDto | yes |  |
| `data` | array<PublicApiBrandtrackerHeadlineEvolutionSeriesDto> | yes |  |

**`PublicApiBrandtrackerHeadlineEvolutionSeriesDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `headline` | string | yes |  |
| `points` | array<PublicApiBrandtrackerEvolutionPointDto> | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/landing-page-evolution` — Get brandtracker landing page evolution

**Billing:** Free / no documented credit charge  
**Description:** Returns graph-ready landing page evolution series for one active workspace brandtracker resolved from brandtracker.id. Provide landingPage for exact single-page mode, or omit it to page through bounded global series ranked by active ads.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Pagination page number for global mode. Exact mode always returns at most one series. |
| `limit` | query | integer |  | Number of series to return in global mode. Exact mode costs and returns one series. |
| `startDate` | query | string |  | Inclusive start date. Defaults to 365 days before the effective end date. |
| `endDate` | query | string |  | Inclusive end date. Defaults to today unless snapshotDate is provided. |
| `snapshotDate` | query | string |  | Optional snapshot date. When provided, it is used as the effective end date. |
| `landingPage` | query | string |  | Exact landing page URL to return as a single evolution series. Omit for global mode. |

Response: `PublicApiGetBrandtrackerLandingPageEvolutionResponseDto` — Paginated landing page evolution response. Pagination is by distinct landing page series and the response includes the X-Request-Id header.

**`PublicApiGetBrandtrackerLandingPageEvolutionResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `dateRange` | PublicApiBrandtrackerEvolutionDateRangeDto | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |
| `meta` | PublicApiFreshnessMetaDto | yes |  |
| `data` | array<PublicApiBrandtrackerLandingPageEvolutionSeriesDto> | yes |  |

**`PublicApiBrandtrackerLandingPageEvolutionSeriesDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `landingPage` | string | yes |  |
| `points` | array<PublicApiBrandtrackerEvolutionPointDto> | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/time-series` — Get brandtracker time-series

**Billing:** Free / no documented credit charge  
**Description:** Returns graph-ready Brandtracker time-series for ads launched, live ads history, and EU impression/spend deltas. Use period for rolling windows, or startDate/endDate for explicit ranges; do not combine period with date params.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `granularity` | query | enum[daily, weekly, monthly] |  | Bucket size for the returned graph data. Defaults to daily. |
| `startDate` | query | string |  | Inclusive start date. Defaults to 365 days before the effective end date. Cannot be combined with period. |
| `endDate` | query | string |  | Inclusive end date. Defaults to today unless snapshotDate is provided. Cannot be combined with period. |
| `snapshotDate` | query | string |  | Optional snapshot date. When provided with period, it anchors the rolling window; otherwise it is used as the effective end date. |
| `period` | query | enum[today, yesterday, 1d, 7d, 14d, 30d, 90d, 365d] |  | Optional rolling window for the time-series. Supports today, yesterday, 1d, 7d, 14d, 30d, 90d, and 365d. Cannot be combined with startDate or endDate; snapshotDate may anchor the window. |
| `euOnly` | query | boolean |  | When true, only EU-classified ads are counted for adsLaunched. |
| `cpm` | query | number |  | CPM used to estimate spend from EU impression deltas. |

Response: `PublicApiGetBrandtrackerTimeSeriesResponseDto` — Brandtracker time-series response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerTimeSeriesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerTimeSeriesDto | yes |  |
| `meta` | PublicApiFreshnessMetaDto | yes |  |

**`PublicApiBrandtrackerTimeSeriesDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `granularity` | enum[daily, weekly, monthly] | yes |  |
| `dateRange` | PublicApiBrandtrackerTimeSeriesDateRangeDto | yes |  |
| `adsLaunched` | array<PublicApiBrandtrackerCountTimeSeriesPointDto> | yes |  |
| `liveAds` | array<PublicApiBrandtrackerCountTimeSeriesPointDto> | yes |  |
| `euImpressionsSpend` | array<PublicApiBrandtrackerEuImpressionsSpendTimeSeriesPointDto> | yes | EU impressions/reach spend time series. For Meta Ad Library data, reach is the public-facing impressions-style vocabulary used by related ad DTOs. |
| `cpm` | number | yes |  |

**`PublicApiBrandtrackerTimeSeriesDateRangeDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `startDate` | string | yes |  |
| `endDate` | string | yes |  |

**`PublicApiBrandtrackerCountTimeSeriesPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `date` | string | yes |  |
| `count` | number | yes |  |

**`PublicApiBrandtrackerEuImpressionsSpendTimeSeriesPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `date` | string | yes |  |
| `impressions` | number | yes | Impression delta within this bucket. |
| `cumulativeImpressions` | number | yes | Latest cumulative EU impressions value observed in this bucket. |
| `estimatedSpend` | number | yes | Estimated spend for this bucket, computed from impressions and cpm. |

### `GET /v1/brandtrackers/{brandtrackerId}/timeline` — List brandtracker timeline ads

**Billing:** Free / no documented credit charge  
**Description:** Returns timeline-ready Meta ads for one active workspace brandtracker resolved from brandtracker.id. Timeline membership includes non-deleted Facebook ads with media available in the bucket and a non-null start date.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `sortBy` | query | enum[newest, createdAt, longestRunning, reach, duplicates, adOrder, relevance] |  | Sort key for this request. Allowed values: `newest`, `createdAt`, `longestRunning`, `reach`, `duplicates`, `adOrder`, `relevance`. |
| `status` | query | enum[all, active, inactive] |  | Status filter for this request. Allowed values: `all`, `active`, `inactive`. |
| `mediaType` | query | enum[all, image, video] |  | Enum value accepted by this request. Allowed values: `all`, `image`, `video`. |
| `keywords` | query | array<string> |  | Keyword search terms. Repeated query params and comma-separated values are both accepted. |
| `keywordMode` | query | enum[any, all] |  | Enum value accepted by this request. Allowed values: `any`, `all`. |
| `createdAfter` | query | string |  |  |
| `createdBefore` | query | string |  |  |
| `minDaysRunning` | query | integer |  |  |
| `maxDaysRunning` | query | integer |  |  |
| `minDuplicates` | query | integer |  |  |
| `maxDuplicates` | query | integer |  |  |
| `landingPages` | query | array<string> |  | Landing page URLs. Repeated query params and comma-separated values are both accepted. |
| `adLanguage` | query | array<string> |  | Ad languages. Repeated query params and comma-separated values are both accepted. |
| `cta` | query | array<string> |  | Call-to-action labels. Repeated query params and comma-separated values are both accepted. |
| `adCopyHashes` | query | array<string> |  | 12-character MD5 prefixes of ad copy descriptions. Repeated query params and comma-separated values are both accepted. |
| `adCountries` | query | string |  | Ad country include/exclude filter. Use comma-separated ISO codes with include/exclude modes. |
| `mainCountries` | query | array<string> |  | Main ad countries. Repeated query params and comma-separated values are both accepted. |
| `euOnly` | query | boolean |  | When true, keep only ads flagged as EU ads. |
| `partners` | query | boolean |  | When true, keep only partnership ads. When false, keep only non-partnership ads. |
| `partnerIds` | query | array<string> |  | Partner identifiers. Repeated query params and comma-separated values are both accepted. |
| `minReach` | query | integer |  | Minimum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `maxReach` | query | integer |  | Maximum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `cpm` | query | number |  | CPM used to convert spend filters into reach thresholds. |
| `minSpend` | query | number |  |  |
| `maxSpend` | query | number |  |  |
| `spendPeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `minSpendPerPage` | query | number |  |  |
| `maxSpendPerPage` | query | number |  |  |
| `spendPerPagePeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `hideLowReach` | query | boolean |  | When true, hides ads flagged as low reach. |
| `minAge` | query | integer |  |  |
| `maxAge` | query | integer |  |  |
| `sex` | query | enum[men, women, all] |  | Enum value accepted by this request. Allowed values: `men`, `women`, `all`. |
| `minFacebookLikes` | query | integer |  |  |
| `maxFacebookLikes` | query | integer |  |  |
| `minInstagramFollowers` | query | integer |  |  |
| `maxInstagramFollowers` | query | integer |  |  |
| `minVideoDuration` | query | number |  |  |
| `maxVideoDuration` | query | number |  |  |
| `minDescriptionLength` | query | integer |  |  |
| `maxDescriptionLength` | query | integer |  |  |
| `linkedDomain` | query | string |  | Linked domain filter. URLs are normalized to their hostname before validation. |
| `growthRank` | query | array<enum[rising, falling, stable]> |  | Rank trend filters. Repeated query params and comma-separated values are both accepted. |
| `snapshotDate` | query | string |  | Snapshot date (YYYY-MM-DD or latest). When present, status is interpreted as active at this date. |
| `startedAfter` | query | string |  | Inclusive ad start-date lower bound. |
| `startedBefore` | query | string |  | Inclusive ad start-date upper bound. |
| `lastSeenAfter` | query | string |  | Inclusive effective timeline end-date lower bound. Active ads use today, or snapshotDate when provided. |
| `lastSeenBefore` | query | string |  | Inclusive effective timeline end-date upper bound. Active ads use today, or snapshotDate when provided. |

Response: `PublicApiGetBrandtrackerTimelineResponseDto` — Paginated brandtracker timeline response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerTimelineResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiAdSummaryDto> | yes |  |
| `pagination` | PublicApiAdsPaginationDto | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/timeline/metadata` — Get brandtracker timeline metadata

**Billing:** Free / no documented credit charge  
**Description:** Returns total count and date bounds for the same filter membership used by the brandtracker timeline endpoint.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `status` | query | enum[all, active, inactive] |  | Status filter for this request. Allowed values: `all`, `active`, `inactive`. |
| `mediaType` | query | enum[all, image, video] |  | Enum value accepted by this request. Allowed values: `all`, `image`, `video`. |
| `keywords` | query | array<string> |  | Keyword search terms. Repeated query params and comma-separated values are both accepted. |
| `keywordMode` | query | enum[any, all] |  | Enum value accepted by this request. Allowed values: `any`, `all`. |
| `createdAfter` | query | string |  |  |
| `createdBefore` | query | string |  |  |
| `minDaysRunning` | query | integer |  |  |
| `maxDaysRunning` | query | integer |  |  |
| `minDuplicates` | query | integer |  |  |
| `maxDuplicates` | query | integer |  |  |
| `landingPages` | query | array<string> |  | Landing page URLs. Repeated query params and comma-separated values are both accepted. |
| `adLanguage` | query | array<string> |  | Ad languages. Repeated query params and comma-separated values are both accepted. |
| `cta` | query | array<string> |  | Call-to-action labels. Repeated query params and comma-separated values are both accepted. |
| `adCopyHashes` | query | array<string> |  | 12-character MD5 prefixes of ad copy descriptions. Repeated query params and comma-separated values are both accepted. |
| `adCountries` | query | string |  | Ad country include/exclude filter. Use comma-separated ISO codes with include/exclude modes. |
| `mainCountries` | query | array<string> |  | Main ad countries. Repeated query params and comma-separated values are both accepted. |
| `euOnly` | query | boolean |  | When true, keep only ads flagged as EU ads. |
| `partners` | query | boolean |  | When true, keep only partnership ads. When false, keep only non-partnership ads. |
| `partnerIds` | query | array<string> |  | Partner identifiers. Repeated query params and comma-separated values are both accepted. |
| `minReach` | query | integer |  | Minimum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `maxReach` | query | integer |  | Maximum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `cpm` | query | number |  | CPM used to convert spend filters into reach thresholds. |
| `minSpend` | query | number |  |  |
| `maxSpend` | query | number |  |  |
| `spendPeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `minSpendPerPage` | query | number |  |  |
| `maxSpendPerPage` | query | number |  |  |
| `spendPerPagePeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `hideLowReach` | query | boolean |  | When true, hides ads flagged as low reach. |
| `minAge` | query | integer |  |  |
| `maxAge` | query | integer |  |  |
| `sex` | query | enum[men, women, all] |  | Enum value accepted by this request. Allowed values: `men`, `women`, `all`. |
| `minFacebookLikes` | query | integer |  |  |
| `maxFacebookLikes` | query | integer |  |  |
| `minInstagramFollowers` | query | integer |  |  |
| `maxInstagramFollowers` | query | integer |  |  |
| `minVideoDuration` | query | number |  |  |
| `maxVideoDuration` | query | number |  |  |
| `minDescriptionLength` | query | integer |  |  |
| `maxDescriptionLength` | query | integer |  |  |
| `linkedDomain` | query | string |  | Linked domain filter. URLs are normalized to their hostname before validation. |
| `growthRank` | query | array<enum[rising, falling, stable]> |  | Rank trend filters. Repeated query params and comma-separated values are both accepted. |
| `snapshotDate` | query | string |  | Snapshot date (YYYY-MM-DD or latest). When present, status is interpreted as active at this date. |
| `startedAfter` | query | string |  | Inclusive ad start-date lower bound. |
| `startedBefore` | query | string |  | Inclusive ad start-date upper bound. |
| `lastSeenAfter` | query | string |  | Inclusive effective timeline end-date lower bound. Active ads use today, or snapshotDate when provided. |
| `lastSeenBefore` | query | string |  | Inclusive effective timeline end-date upper bound. Active ads use today, or snapshotDate when provided. |

Response: `PublicApiGetBrandtrackerTimelineMetadataResponseDto` — Brandtracker timeline metadata response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerTimelineMetadataResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerTimelineMetadataDto | yes |  |

**`PublicApiBrandtrackerTimelineMetadataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `totalCount` | number | yes |  |
| `earliestDate` | string | yes |  |
| `latestDate` | string | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/testing` — List brandtracker creative testing batches

**Billing:** Free / no documented credit charge  
**Description:** Returns creative-testing batches grouped by ad start date for one active workspace brandtracker resolved from brandtracker.id. Testing membership includes non-deleted Facebook ads with media available in the bucket and a non-null start date. To keep response size and metering bounded, each batch returns at most 20 ads and exposes truncation metadata.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `page` | query | integer |  | Batch page number. Pagination is by distinct ad start-date batches. |
| `limit` | query | integer |  | Number of distinct start-date batches to return. Each batch returns at most 20 ads. |
| `status` | query | enum[all, active, inactive] |  | Status filter for this request. Allowed values: `all`, `active`, `inactive`. |
| `mediaType` | query | enum[all, image, video] |  | Enum value accepted by this request. Allowed values: `all`, `image`, `video`. |
| `keywords` | query | array<string> |  | Keyword search terms. Repeated query params and comma-separated values are both accepted. |
| `keywordMode` | query | enum[any, all] |  | Enum value accepted by this request. Allowed values: `any`, `all`. |
| `createdAfter` | query | string |  |  |
| `createdBefore` | query | string |  |  |
| `minDaysRunning` | query | number |  |  |
| `maxDaysRunning` | query | number |  |  |
| `minDuplicates` | query | number |  |  |
| `maxDuplicates` | query | number |  |  |
| `landingPages` | query | array<string> |  | Landing page URLs. Repeated query params and comma-separated values are both accepted. |
| `adLanguage` | query | array<string> |  | Ad languages. Repeated query params and comma-separated values are both accepted. |
| `cta` | query | array<string> |  | Call-to-action labels. Repeated query params and comma-separated values are both accepted. |
| `adCopyHashes` | query | array<string> |  | 12-character MD5 prefixes of ad copy descriptions. Repeated query params and comma-separated values are both accepted. |
| `adCountries` | query | string |  | Ad country include/exclude filter. Use comma-separated ISO codes with include/exclude modes. |
| `mainCountries` | query | array<string> |  | Main ad countries. Repeated query params and comma-separated values are both accepted. |
| `euOnly` | query | boolean |  | When true, keep only ads flagged as EU ads. |
| `partners` | query | boolean |  | When true, keep only partnership ads. When false, keep only non-partnership ads. |
| `partnerIds` | query | array<string> |  | Partner identifiers. Repeated query params and comma-separated values are both accepted. |
| `minReach` | query | number |  | Minimum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `maxReach` | query | number |  | Maximum ad reach threshold. Backed by the internal reach/impressions analytics field. |
| `cpm` | query | number |  | CPM used to convert spend filters into reach thresholds. |
| `minSpend` | query | number |  |  |
| `maxSpend` | query | number |  |  |
| `spendPeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `minSpendPerPage` | query | number |  |  |
| `maxSpendPerPage` | query | number |  |  |
| `spendPerPagePeriod` | query | enum[total, last24h, last7d, last30d] |  | Enum value accepted by this request. Allowed values: `total`, `last24h`, `last7d`, `last30d`. |
| `hideLowReach` | query | boolean |  | When true, hides ads flagged as low reach. |
| `minAge` | query | number |  |  |
| `maxAge` | query | number |  |  |
| `sex` | query | enum[men, women, all] |  | Enum value accepted by this request. Allowed values: `men`, `women`, `all`. |
| `minFacebookLikes` | query | number |  |  |
| `maxFacebookLikes` | query | number |  |  |
| `minInstagramFollowers` | query | number |  |  |
| `maxInstagramFollowers` | query | number |  |  |
| `minVideoDuration` | query | number |  |  |
| `maxVideoDuration` | query | number |  |  |
| `minDescriptionLength` | query | number |  |  |
| `maxDescriptionLength` | query | number |  |  |
| `linkedDomain` | query | string |  | Linked domain filter. URLs are normalized to their hostname before validation. |
| `growthRank` | query | array<enum[rising, falling, stable]> |  | Rank trend filters. Repeated query params and comma-separated values are both accepted. |
| `snapshotDate` | query | string |  | Snapshot date (YYYY-MM-DD or latest). When present, status is interpreted as active at this date. |
| `startedAfter` | query | string |  | Inclusive ad start-date lower bound. |
| `startedBefore` | query | string |  | Inclusive ad start-date upper bound. |
| `lastSeenAfter` | query | string |  | Inclusive effective timeline end-date lower bound. Active ads use today, or snapshotDate when provided. |
| `lastSeenBefore` | query | string |  | Inclusive effective timeline end-date upper bound. Active ads use today, or snapshotDate when provided. |

Response: `PublicApiGetBrandtrackerTestingResponseDto` — Paginated brandtracker testing response. Pagination is by start-date batches and the response includes the X-Request-Id header.

**`PublicApiGetBrandtrackerTestingResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiBrandtrackerTestingBatchDto> | yes |  |
| `pagination` | PublicApiBrandtrackerTestingPaginationDto | yes |  |

**`PublicApiBrandtrackerTestingBatchDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `startDate` | string | yes |  |
| `ads` | array<PublicApiAdSummaryDto> | yes |  |
| `adsReturned` | number | yes | Number of ads returned in this batch after the per-batch cap. |
| `maxAdsPerBatch` | number | yes | Maximum ads returned per start-date batch. |
| `adsTruncated` | boolean | yes | True when more matching ads exist for this start-date batch than were returned. |
| `runningCount` | number | yes |  |
| `isWinner` | boolean | yes | True when the batch matches the creative-testing winner heuristics. |
| `stats` | PublicApiBrandtrackerTestingStatsDto | yes |  |

**`PublicApiBrandtrackerTestingStatsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `reach` | PublicApiBrandtrackerTestingReachStatsDto | yes |  |
| `daysRunning` | PublicApiBrandtrackerTestingDaysRunningStatsDto | yes |  |
| `activeCount` | number | yes |  |
| `totalCount` | number | yes |  |
| `bestPerformerId` | string | yes |  |

**`PublicApiBrandtrackerTestingPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes | Number of start-date batches requested per page. |
| `total` | number | yes | Total matching start-date batches. |
| `totalPages` | number | yes |  |

### `GET /v1/brandtrackers/{brandtrackerId}/overview` — Get brandtracker overview

**Billing:** Free / no documented credit charge  
**Description:** Returns a dashboard-style Brandtracker overview combining graph, media mix, top landing pages, top ads, and ads preview sections. The graph accepts timeSeriesPeriod for rolling windows or timeSeriesStartDate/timeSeriesEndDate for explicit ranges; do not combine them.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `brandtrackerId` | path | string | yes | Public brandtracker identifier. This endpoint resolves brandtracker.id inside the authenticated workspace; legacy spyders.uuid values are accepted when migration metadata exists. |
| `euOnly` | query | boolean |  | Optional EU-only filter forwarded to graph, media mix, landing pages, and top ads sections where supported. |
| `snapshotDate` | query | string | enum[latest] |  | Snapshot date for dashboard time travel. Use YYYY-MM-DD or latest. |
| `cpm` | query | number |  | CPM used to estimate spend in the graph section. |
| `timeSeriesGranularity` | query | enum[daily, weekly, monthly] |  | Bucket size for the graph section. Defaults to daily. |
| `timeSeriesStartDate` | query | string |  | Inclusive graph start date. Cannot be combined with timeSeriesPeriod. |
| `timeSeriesEndDate` | query | string |  | Inclusive graph end date. Cannot be combined with timeSeriesPeriod. |
| `timeSeriesPeriod` | query | enum[today, yesterday, 1d, 7d, 14d, 30d, 90d, 365d] |  | Optional rolling window for the graph section. Supports today, yesterday, 1d, 7d, 14d, 30d, 90d, and 365d. Cannot be combined with timeSeriesStartDate or timeSeriesEndDate; snapshotDate may anchor the window. |
| `landingPagesTimePeriod` | query | enum[live, last24h, last3d, last7d, last30d, last3m, last6m, last1y] |  | Time window for top landing pages. Defaults to live for dashboard-style current overview. |
| `landingPagesLimit` | query | integer |  | Maximum number of top landing pages to return. Defaults to 5. |
| `topAdsLimit` | query | integer |  | Maximum number of top ads to return. Defaults to 5. |
| `adsPreviewLimit` | query | integer |  | Maximum number of ads preview items to return. Defaults to 10. |
| `topAdsSortBy` | query | enum[currentRank, rankDelta, rankDelta7d, rankDelta14d, rankDelta30d, reach, reachDelta1d, reachDelta7d, reachDelta30d, daysRunning, duplicates] |  | Optional top ads sorting. Defaults to reach when euOnly=true, otherwise daysRunning. |
| `topAdsPeriod` | query | enum[today, yesterday, last1d, last7d, last14d, last30d, total] |  | Optional top ads period. Supports `today`, `yesterday`, `last1d`, `last7d`, `last14d`, `last30d`, and `total`. Defaults to `total`. |

Response: `PublicApiGetBrandtrackerOverviewResponseDto` — Brandtracker overview response. The response also includes the X-Request-Id header.

**`PublicApiGetBrandtrackerOverviewResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiBrandtrackerOverviewDto | yes |  |
| `meta` | object | yes | Reserved response metadata. Snapshot freshness is intentionally omitted from overview to match top-ads. |

**`PublicApiBrandtrackerOverviewDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `graph` | PublicApiBrandtrackerTimeSeriesDto | yes |  |
| `mediaMix` | PublicApiBrandtrackerMediaMixDto | yes |  |
| `topLandingPages` | PublicApiBrandtrackerOverviewLandingPagesSectionDto | yes |  |
| `topAds` | PublicApiBrandtrackerOverviewTopAdsSectionDto | yes |  |
| `adsPreview` | PublicApiBrandtrackerOverviewAdsPreviewSectionDto | yes |  |

**`PublicApiBrandtrackerOverviewLandingPagesSectionDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `data` | array<PublicApiBrandtrackerLandingPageDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerOverviewTopAdsSectionDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `data` | array<PublicApiBrandtrackerTopAdDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiBrandtrackerOverviewAdsPreviewSectionDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `data` | array<PublicApiAdSummaryDto> | yes |  |
| `pagination` | PublicApiAdsPaginationDto | yes |  |


---

## Discovery

### `GET /v1/lookup` — Resolve a brand, advertiser, or shop

**Billing:** Free / no documented credit charge  
**Description:** Zero-credit lookup for brand names, shop domains, Facebook page ids, and Instagram handles. Exact matches are returned before fuzzy name matches.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `q` | query | string | yes | Brand name, shop domain, Facebook page id, or Instagram handle. |
| `type` | query | enum[auto, brandtracker, advertiser, shop] |  | Limit lookup to one resource type, or search brandtrackers, advertisers, and shops with auto. |
| `limit` | query | integer |  |  |

Response: `PublicApiLookupResponseDto` — Lookup results linking known brandtracker, advertiser, and shop public identifiers. The response also includes the X-Request-Id header.

**`PublicApiLookupResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiLookupResultDto> | yes |  |
| `meta` | PublicApiLookupMetaDto | yes |  |

**`PublicApiLookupResultDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `type` | enum[brandtracker, advertiser, shop] | yes |  |
| `matchType` | enum[exact, fuzzy] | yes |  |
| `matchField` | enum[name, domain, facebookPageId, instagramHandle] | yes |  |
| `score` | number | yes | Lookup confidence score. Exact identifier/domain/name matches return 1; fuzzy candidates return lower scores. |
| `brandtracker` | PublicApiLookupBrandtrackerDto | yes |  |
| `advertiser` | PublicApiLookupAdvertiserDto | yes |  |
| `shop` | PublicApiLookupShopDto | yes |  |
| `signals` | PublicApiLookupSignalsDto | yes | Additive disambiguation signals derived from existing lookup candidate ranking/resource metadata. |

**`PublicApiLookupBrandtrackerDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `facebookPageId` | string | yes |  |

**`PublicApiLookupAdvertiserDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `facebookPageId` | string | yes |  |

**`PublicApiLookupShopDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |

**`PublicApiLookupSignalsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `activeAds` | number | yes | Active ads signal when available from lookup candidate ranking metadata. |
| `liveAdsCount` | number | yes | Live ads signal alias when available (same source as activeAds when only one is present). |
| `reach30d` | number | yes | 30-day reach signal when available from lookup ranking metadata. |
| `totalReach` | number | yes | Total/current reach signal when available from lookup ranking metadata. |
| `monthlyVisits` | number | yes | Monthly visits signal when available from lookup candidate ranking metadata. |
| `workspaceAddedAt` | string | yes | Workspace-added timestamp signal when available from lookup candidate ranking metadata. |
| `hasBrandtracker` | boolean | yes |  |
| `hasAdvertiser` | boolean | yes |  |
| `hasShop` | boolean | yes |  |

**`PublicApiLookupMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `q` | string | yes |  |
| `type` | enum[auto, brandtracker, advertiser, shop] | yes |  |
| `limit` | number | yes |  |
| `returned` | number | yes |  |
| `partial` | boolean |  | Present when type=auto returned successful resource matches while one or more lookup branches timed out. |
| `warnings` | array<array<any>> |  |  |

### `GET /v1/lookup/facebook-shop` — Resolve Facebook page and shop relationships

**Billing:** Free / no documented credit charge  
**Description:** Zero-credit resolver for deterministic Facebook page ↔ shop/site relationships. Provide exactly one Facebook page alias or one shop/site alias.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `facebook_id` | query | string |  | Facebook page id alias. Provide one Facebook page alias or one shop/site alias. |
| `facebookPageId` | query | string |  | Facebook page id alias. Provide one Facebook page alias or one shop/site alias. |
| `fb_page_id` | query | string |  | Facebook page id alias. Provide one Facebook page alias or one shop/site alias. |
| `shopId` | query | string |  | Shop/site id alias. Provide one shop/site alias or one Facebook page alias. |
| `website_id` | query | string |  | Shop/site id alias. Provide one shop/site alias or one Facebook page alias. |
| `limit` | query | integer |  |  |

Response: `PublicApiFacebookShopResolveResponseDto` — Ordered linked shops or Facebook pages, with a primary relationship convenience field. The response also includes the X-Request-Id header.

**`PublicApiFacebookShopResolveResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiFacebookShopResolveDataDto | yes |  |
| `meta` | PublicApiFacebookShopResolveMetaDto | yes |  |

**`PublicApiFacebookShopResolveDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `input` | PublicApiFacebookShopResolveInputDto | yes |  |
| `primaryShop` | PublicApiFacebookShopResolveShopDto | yes |  |
| `shops` | array<PublicApiFacebookShopResolveShopDto> | yes |  |
| `primaryFacebookPage` | PublicApiFacebookShopResolveFacebookPageDto | yes |  |
| `facebookPages` | array<PublicApiFacebookShopResolveFacebookPageDto> | yes |  |

**`PublicApiFacebookShopResolveInputDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `type` | enum[facebookPage, shop] | yes |  |
| `id` | string | yes |  |

**`PublicApiFacebookShopResolveShopDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |
| `rank` | string | yes |  |
| `isMainRelation` | boolean | yes |  |
| `isPrimary` | boolean | yes |  |
| `trafficNumber` | number | yes |  |
| `profilePhotoUrl` | string | yes |  |

**`PublicApiFacebookShopResolveFacebookPageDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `facebookPageId` | string | yes |  |
| `name` | string | yes |  |
| `rank` | string | yes |  |
| `isMainRelation` | boolean | yes |  |
| `isPrimary` | boolean | yes |  |
| `runningAds` | number | yes |  |

**`PublicApiFacebookShopResolveMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `limit` | number | yes |  |
| `returnedShops` | number | yes |  |
| `returnedFacebookPages` | number | yes |  |


---

## Emails

### `POST /v1/emails/query` — Query emails

**Billing:** Free / no documented credit charge  
**Description:** Returns the advanced public emails discovery surface. This endpoint is the canonical public route for richer email filters while keeping the response aligned with the stable public EmailSummary contract. The API does not expose opens, clicks, conversions, or revenue metrics; sorting is discovery-oriented metadata ordering, not best-performance scoring.

Request body: `QueryPublicApiEmailsRequestDto`

**`QueryPublicApiEmailsRequestDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `search` | array<string> |  |  |
| `searchType` | enum[domain, email, shopKeywords] |  | Search mode for this request. Allowed values: `domain`, `email`, `shopKeywords`. |
| `keywordMode` | enum[any, all] |  | How multiple search keywords are combined. Allowed values: `any`, `all`. |
| `sortBy` | enum[newest, oldest, relevance, monthlyVisits, bodyLength, shopEmailFrequency, event, promotionType] |  | Sort key for this request. Allowed values: `newest`, `oldest`, `relevance`, `monthlyVisits`, `bodyLength`, `shopEmailFrequency`, `event`, `promotionType`. These are discovery/indexing sorts, not opens/clicks/conversions performance rankings. |
| `order` | enum[asc, desc] |  | Sort direction for this request. Allowed values: `asc`, `desc`. |
| `page` | number |  |  |
| `limit` | number |  |  |
| `sentAfter` | string |  |  |
| `sentBefore` | string |  |  |
| `campaignTypes` | array<string> |  |  |
| `languages` | array<string> |  |  |
| `promotionTypes` | array<string> |  |  |
| `promotionTypeIds` | array<number> |  |  |
| `categories` | array<string> |  |  |
| `emailCategoryIds` | array<number> |  |  |
| `eventNames` | array<string> |  |  |
| `eventIds` | array<number> |  |  |
| `eventCategories` | array<string> |  |  |
| `minBodyLength` | number |  |  |
| `maxBodyLength` | number |  |  |
| `shopIds` | array<string> |  | Stable public shop identifiers. |
| `minMonthlyVisits` | number |  |  |
| `maxMonthlyVisits` | number |  |  |
| `trafficGrowth` | string |  | Traffic growth filter DSL using public rolling windows. Valid periods: `last30d`, `last90d`, `last180d`. |
| `minProductsCount` | number |  |  |
| `maxProductsCount` | number |  |  |
| `creationCountries` | array<string> |  |  |
| `excludeCreationCountries` | array<string> |  |  |
| `currencies` | array<string> |  |  |
| `shopDefaultLanguages` | array<string> |  |  |
| `mainMarketCountries` | array<string> |  |  |
| `amongMarketCountries` | array<string> |  |  |
| `excludeMarketCountries` | array<string> |  |  |
| `visitorCountries` | array<string> |  |  |
| `shopCreatedAfter` | string |  |  |
| `shopCreatedBefore` | string |  |  |
| `technologies` | array<string> |  |  |
| `shopifyPlan` | enum[all, plus, nonPlus] |  | Enum value accepted by this request. Allowed values: `all`, `plus`, `nonPlus`. |
| `categoryIds` | array<number> |  |  |
| `minShopEmails90d` | number |  |  |
| `maxShopEmails90d` | number |  |  |
| `minAvgEmailsPerWeek` | number |  |  |
| `maxAvgEmailsPerWeek` | number |  |  |
| `minActiveAds` | number |  |  |
| `maxActiveAds` | number |  |  |
| `adsGrowth` | string |  | Ads growth filter DSL using public rolling windows. Valid periods: `last7d`, `last30d`, `last90d`. |
| `minTrustpilotRating` | number |  |  |
| `maxTrustpilotRating` | number |  |  |
| `minTrustpilotReviewCount` | number |  |  |
| `maxTrustpilotReviewCount` | number |  |  |

Response: `PublicApiGetEmailsResponseDto` — Paginated advanced emails query response. The response also includes the X-Request-Id header.

**`PublicApiGetEmailsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiEmailSummaryDto> | yes |  |
| `pagination` | PublicApiEmailsPaginationDto | yes |  |

**`PublicApiEmailSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `sentAt` | string | yes |  |
| `campaignType` | string | yes |  |
| `classification` | PublicApiEmailClassificationDto | yes |  |
| `content` | PublicApiEmailContentSummaryDto | yes |  |
| `shop` | PublicApiEmailShopIdentityDto | yes |  |

**`PublicApiEmailClassificationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `promotionType` | string | yes |  |
| `promotionTypeId` | number | yes |  |
| `category` | string | yes |  |
| `categoryId` | number | yes |  |
| `event` | PublicApiEmailClassificationEventDto | yes |  |

**`PublicApiEmailContentSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `subject` | string | yes |  |
| `preheader` | string | yes |  |
| `bodyPreview` | string | yes |  |
| `bodyLength` | number | yes |  |
| `screenshotUrl` | string | yes |  |

**`PublicApiEmailShopIdentityDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |

**`PublicApiEmailsPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes |  |
| `total` | number | yes |  |
| `totalPages` | number | yes |  |

### `GET /v1/emails/{emailId}` — Get an email by id

**Billing:** Free / no documented credit charge  
**Description:** Returns one public email detail object by stable email identifier, including the clean public shop context nested under the email.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `emailId` | path | string | yes | Stable public email identifier. |

Response: `PublicApiGetEmailResponseDto` — Public email detail response. The response also includes the X-Request-Id header.

**`PublicApiGetEmailResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiEmailDetailDto | yes |  |

**`PublicApiEmailDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `sentAt` | string | yes |  |
| `campaignType` | string | yes |  |
| `classification` | PublicApiEmailClassificationDto | yes |  |
| `content` | PublicApiEmailContentDetailDto | yes |  |
| `shop` | PublicApiEmailDetailShopDto | yes |  |
| `language` | string | yes |  |

**`PublicApiEmailContentDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `subject` | string | yes |  |
| `preheader` | string | yes |  |
| `bodyPreview` | string | yes |  |
| `bodyLength` | number | yes |  |
| `screenshotUrl` | string | yes |  |
| `body` | string | yes |  |

**`PublicApiEmailDetailShopDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |
| `createdAt` | string | yes |  |
| `profile` | PublicApiEmailShopProfileDto | yes |  |
| `traffic` | PublicApiEmailShopTrafficDto | yes |  |
| `catalog` | PublicApiEmailShopCatalogDto | yes |  |
| `marketing` | PublicApiEmailShopMarketingDto | yes |  |
| `technology` | PublicApiEmailShopTechnologyDto | yes |  |
| `trustpilot` | PublicApiEmailShopTrustpilotDto | yes |  |
| `analytics` | PublicApiEmailShopAnalyticsDto | yes |  |

### `GET /v1/emails/{emailId}/html` — Get raw email HTML by id

**Billing:** Free / no documented credit charge  
**Description:** Returns the raw captured HTML for one public email identifier. Existing emails may have html=null when raw HTML is unavailable.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `emailId` | path | string | yes | Stable public email identifier. |

Response: `PublicApiGetEmailHtmlResponseDto` — Raw email HTML response. The response also includes the X-Request-Id header.

**`PublicApiGetEmailHtmlResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiEmailHtmlDto | yes |  |

**`PublicApiEmailHtmlDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `emailId` | number | yes | Stable public email identifier. |
| `html` | object | yes | Raw captured HTML for the email, when available. |
| `htmlLength` | number | yes | Length of the raw HTML string in characters. Zero when HTML is unavailable. |

### `GET /v1/shops/{shopId}/emails` — List emails for a shop

**Billing:** Free / no documented credit charge  
**Description:** Returns the paginated public emails linked to one shop identifier, with stable recency-oriented filters and the same public EmailSummary response contract as the global emails surface.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `shopId` | path | string | yes | Stable public shop identifier. |
| `search` | query | array<string> |  | Optional email search keywords. Repeated query params and comma-separated values are both accepted. |
| `sortBy` | query | enum[newest, oldest, relevance, event, promotionType] |  | Sort key for this request. Allowed values: `newest`, `oldest`, `relevance`, `event`, `promotionType`. These are discovery/indexing sorts, not opens/clicks/conversions performance rankings. |
| `sentAfter` | query | string |  |  |
| `sentBefore` | query | string |  |  |
| `campaignTypes` | query | array<string> |  |  |
| `languages` | query | array<string> |  |  |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |

Response: `PublicApiGetEmailsResponseDto` — Paginated shop emails response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiGetEmailsResponseDto`)

### `GET /v1/shops/{shopId}/emails/stats` — Get shop email stats

**Billing:** Free / no documented credit charge  
**Description:** Returns shop-scoped 90-day email frequency stats and sparse UTC calendar counts for one requested month.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `shopId` | path | string | yes | Stable public shop identifier. |
| `month` | query | string | yes | Calendar month to aggregate, formatted as YYYY-MM. |

Response: `PublicApiGetShopEmailStatsResponseDto` — Shop email stats response. The response also includes the X-Request-Id header.

**`PublicApiGetShopEmailStatsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiShopEmailStatsDto | yes |  |

**`PublicApiShopEmailStatsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `last90Days` | PublicApiShopEmailLast90DaysStatsDto | yes |  |
| `calendar` | PublicApiShopEmailCalendarStatsDto | yes |  |

**`PublicApiShopEmailLast90DaysStatsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `totalEmails` | number | yes | Total emails sent by this shop in the trailing 90 days. |
| `avgEmailsPerWeek` | number | yes | Average emails sent per week over the trailing 90 days. |
| `emailsByDayOfWeek` | object | yes | Emails sent by day of week using 0=Sunday ... 6=Saturday. |

**`PublicApiShopEmailCalendarStatsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `month` | string | yes | Calendar month represented by this aggregate. |
| `totalEmails` | number | yes | Total emails sent in the requested calendar month. |
| `emailsByDate` | object | yes | Sparse UTC calendar counts keyed by YYYY-MM-DD. Dates with zero emails are omitted. |


---

## Facets

### `GET /v1/facets/categories` — List public category facets

**Billing:** Free / no documented credit charge  
**Description:** Returns Google taxonomy category IDs currently available for public API category filters across shops, ads, emails, and advertisers.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  | Case-insensitive substring search over the facet label fields. |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Response: `PublicApiCategoryFacetsResponseDto` — Category facet values with pagination and filter usage metadata. The response also includes the X-Request-Id header.

**`PublicApiCategoryFacetsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `pagination` | PublicApiFacetPaginationDto | yes |  |
| `meta` | PublicApiFacetMetaDto | yes |  |
| `data` | array<PublicApiCategoryFacetDto> | yes |  |

**`PublicApiFacetPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `limit` | number | yes |  |
| `offset` | number | yes |  |
| `total` | number | yes |  |

**`PublicApiFacetMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `valueType` | enum[number, uuid, slug] | yes |  |
| `filterUsage` | array<PublicApiFacetFilterUsageDto> | yes |  |

**`PublicApiFacetFilterUsageDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `resource` | enum[shops, ads, emails, advertisers] | yes |  |
| `fields` | array<string> | yes |  |
| `valueField` | enum[id, slug] | yes |  |

**`PublicApiCategoryFacetDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `name` | string | yes |  |
| `path` | string | yes |  |
| `parentId` | number | yes |  |
| `usageCount` | number | yes |  |

### `GET /v1/facets/shopify-apps` — List public Shopify app facets

**Billing:** Free / no documented credit charge  
**Description:** Returns grouped Shopify app IDs currently available for public API Shopify app filters on shops and ads.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  | Case-insensitive substring search over the facet label fields. |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Response: `PublicApiShopifyAppFacetsResponseDto` — Shopify app facet values with pagination and filter usage metadata. The response also includes the X-Request-Id header.

**`PublicApiShopifyAppFacetsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `pagination` | PublicApiFacetPaginationDto | yes |  |
| `meta` | PublicApiFacetMetaDto | yes |  |
| `data` | array<PublicApiShopifyAppFacetDto> | yes |  |

**`PublicApiShopifyAppFacetDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `label` | string | yes |  |
| `iconUrl` | string | yes |  |
| `shopifyUrl` | string | yes |  |
| `usageCount` | number | yes |  |

### `GET /v1/facets/technologies` — List public technology facets

**Billing:** Free / no documented credit charge  
**Description:** Returns supported technology slugs accepted by public API technology filters, enriched with metadata when available.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  | Case-insensitive substring search over the facet label fields. |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Response: `PublicApiTechnologyFacetsResponseDto` — Technology facet values with pagination and filter usage metadata. The response also includes the X-Request-Id header.

**`PublicApiTechnologyFacetsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `pagination` | PublicApiFacetPaginationDto | yes |  |
| `meta` | PublicApiFacetMetaDto | yes |  |
| `data` | array<PublicApiTechnologyFacetDto> | yes |  |

**`PublicApiTechnologyFacetDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `slug` | string | yes |  |
| `id` | string | yes |  |
| `name` | string | yes |  |
| `iconUrl` | string | yes |  |
| `categories` | array<string> | yes |  |
| `usageCount` | number | yes |  |

### `GET /v1/facets/pixels` — List public pixel facets

**Billing:** Free / no documented credit charge  
**Description:** Returns pixel technology UUIDs currently available for public API pixel filters on shops and ads.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  | Case-insensitive substring search over the facet label fields. |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Response: `PublicApiPixelFacetsResponseDto` — Pixel facet values with pagination and filter usage metadata. The response also includes the X-Request-Id header.

**`PublicApiPixelFacetsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `pagination` | PublicApiFacetPaginationDto | yes |  |
| `meta` | PublicApiFacetMetaDto | yes |  |
| `data` | array<PublicApiPixelFacetDto> | yes |  |

**`PublicApiPixelFacetDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `slug` | string | yes |  |
| `name` | string | yes |  |
| `iconUrl` | string | yes |  |
| `categories` | array<string> | yes |  |
| `usageCount` | number | yes |  |

### `GET /v1/facets/themes` — List public Shopify theme facets

**Billing:** Free / no documented credit charge  
**Description:** Returns Shopify theme UUIDs currently available for public API theme filters on shops.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  | Case-insensitive substring search over the facet label fields. |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |

Response: `PublicApiThemeFacetsResponseDto` — Theme facet values with pagination and filter usage metadata. The response also includes the X-Request-Id header.

**`PublicApiThemeFacetsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `pagination` | PublicApiFacetPaginationDto | yes |  |
| `meta` | PublicApiFacetMetaDto | yes |  |
| `data` | array<PublicApiThemeFacetDto> | yes |  |

**`PublicApiThemeFacetDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `usageCount` | number | yes |  |


---

## Favorites

### `POST /v1/favorites/ads` — Add a favorite ad

**Billing:** Free / no documented credit charge  
**Description:** Saves an ad to the requested workspace or delegated-user favorites scope. Existing favorites are returned idempotently without creating an audit mutation event.

Request body: `AddPublicApiFavoriteAdBodyDto`

**`AddPublicApiFavoriteAdBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `scope` | enum[workspace, personal] | yes |  |
| `adId` | string | yes | Composite public ad identifier, for example facebook_123 or tiktok_123. |
| `folderId` | object |  | Public favorite ads folder UUID. Null or omitted saves the ad at root. |

Response: `PublicApiFavoriteAdMutationResponseDto` — Favorite ad mutation response. The response also includes the X-Request-Id header.

**`PublicApiFavoriteAdMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteAdItemDto | yes |  |
| `created` | boolean | yes | True when this call created a favorite; false when the favorite already existed. |

**`PublicApiFavoriteAdItemDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `savedAt` | string | yes |  |
| `folder` | PublicApiFavoriteAdsFolderDto | yes |  |
| `ad` | PublicApiAdSummaryDto | yes | Embedded public ad summary when the backing favorite can be resolved to a public-supported ad platform. |

**`PublicApiFavoriteAdsFolderDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public ads folder identifier. Numeric ads folder IDs are internal. |
| `name` | string | yes |  |
| `parentId` | string | yes | Parent ads folder identifier when the folder is nested. Null for root folders. |

### `GET /v1/favorites/ads` — List favorite ads

**Billing:** Free / no documented credit charge  
**Description:** Returns the authenticated workspace or delegated-user favorite ads. The response embeds the canonical public ad summary when the backing favorite resolves to a public-supported ad.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `folderId` | query | string |  | Public ads folder identifier. This value matches the ads folder UUID; numeric folder IDs are internal. |

Response: `PublicApiGetFavoriteAdsResponseDto` — Paginated favorite ads response. The response also includes the X-Request-Id header.

**`PublicApiGetFavoriteAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiFavoriteAdItemDto> | yes |  |
| `pagination` | PublicApiFavoritesPaginationDto | yes |  |

**`PublicApiFavoritesPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes |  |
| `total` | number | yes |  |
| `totalPages` | number | yes |  |

### `PATCH /v1/favorites/ads/saved/{favoriteId}/folder` — Move a saved favorite ad

**Billing:** Free / no documented credit charge  
**Description:** Moves one saved favorite ad row by its current saved favorite id. Ads currently expose favorite_ads.id as the saved-row identifier in v1 reads; it is numeric and not a new opaque UUID.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `favoriteId` | path | integer | yes | Saved favorite ad row identifier from the favorite ads list response. Numeric favorite_ads IDs are the current v1 identifier for ads saved rows. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `MoveSavedPublicApiFavoriteAdBodyDto`

**`MoveSavedPublicApiFavoriteAdBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `folderId` | object |  | Public favorite ads folder UUID. Null moves the saved ad to root. |

Response: `PublicApiMoveSavedFavoriteAdResponseDto` — Saved favorite ad move response. The response also includes the X-Request-Id header.

**`PublicApiMoveSavedFavoriteAdResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteAdItemDto | yes |  |

### `DELETE /v1/favorites/ads/saved/{favoriteId}` — Delete a saved favorite ad

**Billing:** Free / no documented credit charge  
**Description:** Deletes one saved favorite ad row by its current saved favorite id. Ads currently expose favorite_ads.id as the saved-row identifier in v1 reads; it is numeric and not a new opaque UUID.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `favoriteId` | path | integer | yes | Saved favorite ad row identifier from the favorite ads list response. Numeric favorite_ads IDs are the current v1 identifier for ads saved rows. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Response: `PublicApiRemoveFavoriteAdResponseDto` — Saved favorite ad removal response. The response also includes the X-Request-Id header.

**`PublicApiRemoveFavoriteAdResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiRemoveFavoriteAdDataDto | yes |  |

**`PublicApiRemoveFavoriteAdDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `removed` | boolean | yes |  |
| `adId` | string | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `folderId` | string | yes |  |

### `DELETE /v1/favorites/ads/{adId}` — Remove a favorite ad

**Billing:** Free / no documented credit charge  
**Description:** Removes an ad from the requested workspace or delegated-user favorites scope and writes a before/null audit mutation event.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `adId` | path | string | yes | Composite public ad identifier, for example facebook_123 or tiktok_123. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `folderId` | query | string |  | Public ads folder identifier. This value matches the ads folder UUID; numeric folder IDs are internal. |

Response: `PublicApiRemoveFavoriteAdResponseDto` — Favorite ad removal response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiRemoveFavoriteAdResponseDto`)

### `POST /v1/favorites/ads/folders` — Create a favorite ad folder

**Billing:** Free / no documented credit charge  
**Description:** Creates a root folder or subfolder in the requested workspace or delegated-user favorite ads scope and writes a null/after audit mutation event.

Request body: `CreatePublicApiFavoriteAdsFolderBodyDto`

**`CreatePublicApiFavoriteAdsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `scope` | enum[workspace, personal] | yes |  |
| `name` | string | yes |  |
| `parentId` | object |  | Public parent folder UUID. Null or omitted creates a root folder. |

Response: `PublicApiFavoriteAdsFolderMutationResponseDto` — Favorite ad folder mutation response. The response also includes the X-Request-Id header.

**`PublicApiFavoriteAdsFolderMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteAdsFolderDto | yes |  |

### `GET /v1/favorites/ads/folders` — List favorite ad folders

**Billing:** Free / no documented credit charge  
**Description:** Returns the ads folders available in the requested favorites scope. Ads folders stay separate from shops folders in v1.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `parentId` | query | string |  | Public parent folder UUID. Returns only direct children of this folder. Cannot be combined with rootOnly=true. |
| `rootOnly` | query | boolean |  | When true, returns only root folders. Cannot be combined with parentId. |

Response: `PublicApiGetFavoriteAdsFoldersResponseDto` — Paginated favorite ad folders response. The response also includes the X-Request-Id header.

**`PublicApiGetFavoriteAdsFoldersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiFavoriteAdsFolderDto> | yes |  |
| `pagination` | PublicApiFavoritesPaginationDto | yes |  |

### `PATCH /v1/favorites/ads/folders/reorder` — Reorder favorite ad folders

**Billing:** Free / no documented credit charge  
**Description:** Updates sibling ordering values for favorite ad folders in the requested scope. Static route is declared before :folderId routes to avoid route shadowing.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `ReorderPublicApiFavoriteAdsFoldersBodyDto`

**`ReorderPublicApiFavoriteAdsFoldersBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `folders` | array<PublicApiFavoriteAdsFolderOrderItemDto> | yes | Folder UUID/order pairs to update in the requested scope. |

**`PublicApiFavoriteAdsFolderOrderItemDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public favorite ads folder UUID. |
| `order` | number | yes |  |

Response: `PublicApiReorderFavoriteAdsFoldersResponseDto` — Favorite ad folders reorder response. The response also includes the X-Request-Id header.

**`PublicApiReorderFavoriteAdsFoldersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiReorderFavoriteAdsFoldersDataDto | yes |  |

**`PublicApiReorderFavoriteAdsFoldersDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `reordered` | boolean | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `folders` | array<PublicApiFavoriteAdsFolderDto> | yes |  |

### `POST /v1/favorites/ads/folders/{folderId}/share` — Create or return a favorite ad folder share URL

**Billing:** Free / no documented credit charge  
**Description:** Creates or returns the existing TrendTrack public webapp share URL for a favorite ad folder. Workspace-scoped folders require workspace writer authorization; personal folders require delegated owner access.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite ads folder UUID in the current scope. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Response: `PublicApiCreateFavoriteAdsFolderShareResponseDto` — Public favorite ad folder share URL response. The response also includes the X-Request-Id header.

**`PublicApiCreateFavoriteAdsFolderShareResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteAdsFolderShareDto | yes |  |

**`PublicApiFavoriteAdsFolderShareDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `folderId` | string | yes | Public favorite ads folder UUID that was shared. |
| `folder` | PublicApiFavoriteAdsFolderDto | yes |  |
| `id` | string | yes | Identifier of the share_ads row used by the webapp share page. |
| `slug` | string | yes |  |
| `shareUrl` | string | yes |  |
| `sharePath` | string | yes |  |
| `createdAt` | string | yes |  |

### `PATCH /v1/favorites/ads/folders/{folderId}/visibility` — Set favorite ad folder visibility

**Billing:** Free / no documented credit charge  
**Description:** Switches a root favorite ad folder tree between private delegated-user scope and organization workspace scope. Workspace-scoped writes require a workspace writer; private conversion requires delegated ownership of every contained folder and saved ad.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite ads folder UUID in the current scope. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `SetPublicApiFavoriteAdsFolderVisibilityBodyDto`

**`SetPublicApiFavoriteAdsFolderVisibilityBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `visibility` | enum[private, organization] | yes | organization publishes a root folder tree to the API credential workspace. private converts a root folder tree to delegated-user personal scope when the delegated user owns all contained folders and saved ads. |

Response: `PublicApiFavoriteAdsFolderMutationResponseDto` — Favorite ad folder visibility response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiFavoriteAdsFolderMutationResponseDto`)

### `PATCH /v1/favorites/ads/folders/{folderId}` — Rename or move a favorite ad folder

**Billing:** Free / no documented credit charge  
**Description:** Renames and/or moves a favorite ad folder. parentId null moves the folder to root; parentId omitted keeps the current parent.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite ads folder UUID. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `UpdatePublicApiFavoriteAdsFolderBodyDto`

**`UpdatePublicApiFavoriteAdsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string |  |  |
| `parentId` | object |  | Public parent folder UUID. Use null to move the folder to root; omit to keep the current parent. |

Response: `PublicApiFavoriteAdsFolderMutationResponseDto` — Favorite ad folder mutation response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiFavoriteAdsFolderMutationResponseDto`)

### `DELETE /v1/favorites/ads/folders/{folderId}` — Delete a favorite ad folder

**Billing:** Free / no documented credit charge  
**Description:** Deletes a favorite ad folder tree with explicit contained-ad handling: delete_items, move_items_to_root, or move_items_to_folder. Cross-scope target folders are rejected by scoped lookup.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite ads folder UUID. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `DeletePublicApiFavoriteAdsFolderBodyDto`

**`DeletePublicApiFavoriteAdsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `mode` | enum[delete_items, move_items_to_root, move_items_to_folder] | yes | Explicit handling for saved ads contained in the deleted folder tree. |
| `targetFolderId` | object |  | Required when mode is move_items_to_folder. Must be a folder in the same requested scope and outside the deleted folder tree. |

Response: `PublicApiDeleteFavoriteAdsFolderResponseDto` — Favorite ad folder delete response. The response also includes the X-Request-Id header.

**`PublicApiDeleteFavoriteAdsFolderResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiDeleteFavoriteAdsFolderDataDto | yes |  |

**`PublicApiDeleteFavoriteAdsFolderDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `deleted` | boolean | yes |  |
| `folderId` | string | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `mode` | enum[delete_items, move_items_to_root, move_items_to_folder] | yes |  |
| `targetFolderId` | string | yes |  |
| `deletedFolderIds` | array<string> | yes |  |
| `affectedFavoriteIds` | array<number> | yes |  |

### `POST /v1/favorites/shops` — Add a favorite shop

**Billing:** Free / no documented credit charge  
**Description:** Saves a website/shop to the requested workspace or delegated-user favorites scope. The server resolves trusted domain and shop metadata from websiteId; clients cannot supply authoritative domain state.

Request body: `AddPublicApiFavoriteShopBodyDto`

**`AddPublicApiFavoriteShopBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `scope` | enum[workspace, personal] | yes |  |
| `websiteId` | string | yes | Public website/shop identifier. The server resolves trusted domain and shop metadata from this id; clients cannot supply authoritative domain state. |
| `folderId` | object |  | Public favorite shops folder UUID. Null or omitted saves the shop at root. |

Response: `PublicApiFavoriteShopMutationResponseDto` — Favorite shop mutation response. The response also includes the X-Request-Id header.

**`PublicApiFavoriteShopMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteShopItemDto | yes |  |
| `created` | boolean | yes | True when this call created a favorite; false when the favorite already existed. |

**`PublicApiFavoriteShopItemDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `savedAt` | string | yes |  |
| `folder` | PublicApiFavoriteShopsFolderDto | yes |  |
| `shop` | PublicApiShopSummaryDto | yes |  |

**`PublicApiFavoriteShopsFolderDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |

**`PublicApiShopSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |
| `screenshotUrl` | string | yes |  |
| `createdAt` | string | yes |  |
| `profile` | PublicApiShopProfileDto | yes |  |
| `catalog` | PublicApiShopCatalogDto | yes |  |
| `traffic` | PublicApiShopTrafficDto | yes |  |
| `advertising` | PublicApiShopAdvertisingDto | yes |  |
| `tiktok` | PublicApiShopTikTokSummaryDto | yes |  |
| `googleAds` | PublicApiShopGoogleAdsSummaryDto |  | Compact best-effort Google Ads summary hydrated for returned shop-search pages. When aggregation fails, status is unavailable and metric values are null. Present on shop-search rows; omitted by older summary producers that do not run Google Ads hydration. |
| `latestAds` | array<PublicApiShopLatestAdDto> | yes | Up to 3 most recent Meta ads published by the shop. |

### `GET /v1/favorites/shops` — List favorite shops

**Billing:** Free / no documented credit charge  
**Description:** Returns the authenticated workspace or delegated-user favorite shops. Each item embeds the canonical public shop summary shape.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `folderId` | query | string |  | Optional shops folder identifier. When provided, only favorites saved in that folder are returned. |

Response: `PublicApiGetFavoriteShopsResponseDto` — Paginated favorite shops response. The response also includes the X-Request-Id header.

**`PublicApiGetFavoriteShopsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiFavoriteShopItemDto> | yes |  |
| `pagination` | PublicApiFavoritesPaginationDto | yes |  |

### `PATCH /v1/favorites/shops/saved/{favoriteId}/folder` — Move a saved favorite shop

**Billing:** Free / no documented credit charge  
**Description:** Moves one saved favorite shop row by favorite_websites.id. Shop folders are flat; folderId null moves the saved shop to root and cross-scope moves are rejected by scoped lookup.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `favoriteId` | path | string | yes | Saved favorite shop row identifier from favorite_websites.id. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `MoveSavedPublicApiFavoriteShopBodyDto`

**`MoveSavedPublicApiFavoriteShopBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `folderId` | object |  | Public favorite shops folder UUID. Null moves the saved shop to root. |

Response: `PublicApiMoveSavedFavoriteShopResponseDto` — Saved favorite shop move response. The response also includes the X-Request-Id header.

**`PublicApiMoveSavedFavoriteShopResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteShopItemDto | yes |  |

### `DELETE /v1/favorites/shops/saved/{favoriteId}` — Delete a saved favorite shop

**Billing:** Free / no documented credit charge  
**Description:** Deletes one saved favorite shop row by favorite_websites.id in the requested scope.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `favoriteId` | path | string | yes | Saved favorite shop row identifier from favorite_websites.id. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Response: `PublicApiRemoveFavoriteShopResponseDto` — Saved favorite shop removal response. The response also includes the X-Request-Id header.

**`PublicApiRemoveFavoriteShopResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiRemoveFavoriteShopDataDto | yes |  |

**`PublicApiRemoveFavoriteShopDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `removed` | boolean | yes |  |
| `websiteId` | string | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `folderId` | string | yes |  |
| `savedFavoriteId` | string | yes |  |

### `DELETE /v1/favorites/shops/{websiteId}` — Remove a favorite shop by website id

**Billing:** Free / no documented credit charge  
**Description:** Removes a website/shop favorite from the requested scope and optional flat folder. To remove a specific saved row, prefer DELETE /v1/favorites/shops/saved/:favoriteId.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `websiteId` | path | string | yes | Public website/shop identifier. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `folderId` | query | string |  | Public favorite shops folder UUID. Omit to remove from root. |

Response: `PublicApiRemoveFavoriteShopResponseDto` — Favorite shop removal response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiRemoveFavoriteShopResponseDto`)

### `POST /v1/favorites/shops/folders` — Create a favorite shop folder

**Billing:** Free / no documented credit charge  
**Description:** Creates a flat favorite shops folder in the requested workspace or delegated-user scope. Hierarchy is not supported for shop folders in this API version.

Request body: `CreatePublicApiFavoriteShopsFolderBodyDto`

**`CreatePublicApiFavoriteShopsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `scope` | enum[workspace, personal] | yes |  |
| `name` | string | yes |  |

Response: `PublicApiFavoriteShopsFolderMutationResponseDto` — Favorite shop folder mutation response. The response also includes the X-Request-Id header.

**`PublicApiFavoriteShopsFolderMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteShopsFolderDto | yes |  |

### `GET /v1/favorites/shops/folders` — List favorite shop folders

**Billing:** Free / no documented credit charge  
**Description:** Returns the shops folders available in the requested favorites scope. Shops folders stay separate from ads folders in v1.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |

Response: `PublicApiGetFavoriteShopsFoldersResponseDto` — Paginated favorite shop folders response. The response also includes the X-Request-Id header.

**`PublicApiGetFavoriteShopsFoldersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiFavoriteShopsFolderDto> | yes |  |
| `pagination` | PublicApiFavoritesPaginationDto | yes |  |

### `PATCH /v1/favorites/shops/folders/{folderId}/visibility` — Set favorite shop folder visibility

**Billing:** Free / no documented credit charge  
**Description:** Switches a flat favorite shop folder between private delegated-user scope and organization workspace scope. Private conversion is denied when the folder contains other users’ saved shops.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite shops folder UUID in the current scope. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `SetPublicApiFavoriteShopsFolderVisibilityBodyDto`

**`SetPublicApiFavoriteShopsFolderVisibilityBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `visibility` | enum[private, organization] | yes | organization publishes a flat shop folder to the API credential workspace. private converts it to delegated-user personal scope when the delegated user owns the folder and every contained saved shop. |

Response: `PublicApiFavoriteShopsFolderMutationResponseDto` — Favorite shop folder visibility response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiFavoriteShopsFolderMutationResponseDto`)

### `PATCH /v1/favorites/shops/folders/{folderId}` — Rename a favorite shop folder

**Billing:** Free / no documented credit charge  
**Description:** Renames a flat favorite shops folder. Parent moves and hierarchy are not supported for shop folders in this API version.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite shops folder UUID. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `UpdatePublicApiFavoriteShopsFolderBodyDto`

**`UpdatePublicApiFavoriteShopsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string |  |  |

Response: `PublicApiFavoriteShopsFolderMutationResponseDto` — Favorite shop folder mutation response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiFavoriteShopsFolderMutationResponseDto`)

### `DELETE /v1/favorites/shops/folders/{folderId}` — Delete a favorite shop folder

**Billing:** Free / no documented credit charge  
**Description:** Deletes a flat favorite shops folder with explicit contained-shop handling: delete_items, move_items_to_root, or move_items_to_folder. Hierarchy and reorder are not supported for shop folders.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite shops folder UUID. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `DeletePublicApiFavoriteShopsFolderBodyDto`

**`DeletePublicApiFavoriteShopsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `mode` | enum[delete_items, move_items_to_root, move_items_to_folder] | yes | Explicit handling for saved shops contained in the deleted flat folder. |
| `targetFolderId` | object |  | Required when mode is move_items_to_folder. Must be a flat shops folder in the same requested scope. |

Response: `PublicApiDeleteFavoriteShopsFolderResponseDto` — Favorite shop folder delete response. The response also includes the X-Request-Id header.

**`PublicApiDeleteFavoriteShopsFolderResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiDeleteFavoriteShopsFolderDataDto | yes |  |

**`PublicApiDeleteFavoriteShopsFolderDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `deleted` | boolean | yes |  |
| `folderId` | string | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `mode` | enum[delete_items, move_items_to_root, move_items_to_folder] | yes |  |
| `targetFolderId` | string | yes |  |
| `affectedFavoriteIds` | array<string> | yes |  |

### `POST /v1/favorites/emails` — Add or update a favorite email

**Billing:** Free / no documented credit charge  
**Description:** Adds or upserts a saved email favorite in the requested scope. Existing saved rows are updated only within the same scope.

Request body: `AddPublicApiFavoriteEmailBodyDto`

**`AddPublicApiFavoriteEmailBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `scope` | enum[workspace, personal] | yes |  |
| `emailId` | number | yes | Public email identifier used by search/get_email_html. |
| `folderId` | object |  | Public favorite email folder UUID. Null or omitted saves the email at root. |

Response: `PublicApiFavoriteEmailMutationResponseDto` — Favorite email mutation response.

**`PublicApiFavoriteEmailMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteEmailItemDto | yes |  |
| `created` | boolean | yes |  |

**`PublicApiFavoriteEmailItemDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public saved favorite email ID from favorite_emails.uuid. |
| `scope` | enum[workspace, personal] | yes |  |
| `savedAt` | string | yes |  |
| `folder` | PublicApiFavoriteEmailsFolderDto | yes |  |
| `email` | PublicApiEmailSummaryDto | yes | Embedded public email summary. Null when the saved row exists but the backing email content is no longer available. |

**`PublicApiFavoriteEmailsFolderDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public email folder identifier. Numeric email folder IDs are internal. |
| `name` | string | yes |  |
| `parentId` | string | yes | Parent email folder UUID. Null for root folders. |

### `GET /v1/favorites/emails` — List favorite emails

**Billing:** Free / no documented credit charge  
**Description:** Returns saved email favorites. The email payload is null when backing email content is unavailable, but the saved row is retained.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |
| `folderId` | query | string |  | Public email folder UUID. Numeric folder IDs are internal and never accepted by the Public API. |

Response: `PublicApiGetFavoriteEmailsResponseDto` — Paginated favorite emails response.

**`PublicApiGetFavoriteEmailsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiFavoriteEmailItemDto> | yes |  |
| `pagination` | PublicApiFavoritesPaginationDto | yes |  |

### `PATCH /v1/favorites/emails/saved/{favoriteId}/folder` — Move a saved favorite email

**Billing:** Free / no documented credit charge  
**Description:** Moves one saved favorite email by favorite_emails.uuid. Numeric saved-row IDs are internal.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `favoriteId` | path | string | yes | Public saved favorite email UUID from favorite_emails.uuid. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `MoveSavedPublicApiFavoriteEmailBodyDto`

**`MoveSavedPublicApiFavoriteEmailBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `folderId` | object |  | Public favorite email folder UUID. Null moves the saved email to root. |

Response: `PublicApiMoveSavedFavoriteEmailResponseDto` — Saved favorite email move response.

**`PublicApiMoveSavedFavoriteEmailResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteEmailItemDto | yes |  |

### `DELETE /v1/favorites/emails/saved/{favoriteId}` — Delete a saved favorite email

**Billing:** Free / no documented credit charge  
**Description:** Deletes one saved favorite email row by favorite_emails.uuid.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `favoriteId` | path | string | yes | Public saved favorite email UUID from favorite_emails.uuid. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Response: `PublicApiRemoveFavoriteEmailResponseDto` — Saved favorite email removal response.

**`PublicApiRemoveFavoriteEmailResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiRemoveFavoriteEmailDataDto | yes |  |

**`PublicApiRemoveFavoriteEmailDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `removed` | boolean | yes |  |
| `emailId` | number | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `folderId` | string | yes |  |
| `savedFavoriteId` | string | yes |  |

### `POST /v1/favorites/emails/folders` — Create a favorite email folder

**Billing:** Free / no documented credit charge  
**Description:** Creates a root or nested favorite email folder using public UUID folder identifiers.

Request body: `CreatePublicApiFavoriteEmailsFolderBodyDto`

**`CreatePublicApiFavoriteEmailsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `scope` | enum[workspace, personal] | yes |  |
| `name` | string | yes |  |
| `parentId` | object |  | Public parent email folder UUID. Null or omitted creates a root folder. |

Response: `PublicApiFavoriteEmailsFolderMutationResponseDto` — Favorite email folder mutation response.

**`PublicApiFavoriteEmailsFolderMutationResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiFavoriteEmailsFolderDto | yes |  |

### `GET /v1/favorites/emails/folders` — List favorite email folders

**Billing:** Free / no documented credit charge  
**Description:** Returns favorite email folders in the requested scope. Folder IDs are public UUIDs.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `page` | query | integer |  |  |
| `limit` | query | integer |  |  |

Response: `PublicApiGetFavoriteEmailsFoldersResponseDto` — Paginated favorite email folders response.

**`PublicApiGetFavoriteEmailsFoldersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiFavoriteEmailsFolderDto> | yes |  |
| `pagination` | PublicApiFavoritesPaginationDto | yes |  |

### `PATCH /v1/favorites/emails/folders/reorder` — Reorder favorite email folders

**Billing:** Free / no documented credit charge  
**Description:** Updates sibling order values for favorite email folders in the requested scope. Static route is declared before :folderId routes to avoid route shadowing.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `ReorderPublicApiFavoriteEmailsFoldersBodyDto`

**`ReorderPublicApiFavoriteEmailsFoldersBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `folders` | array<PublicApiFavoriteEmailsFolderOrderItemDto> | yes |  |

**`PublicApiFavoriteEmailsFolderOrderItemDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public favorite emails folder UUID. |
| `order` | number | yes |  |

Response: `PublicApiReorderFavoriteEmailsFoldersResponseDto` — Favorite email folders reorder response.

**`PublicApiReorderFavoriteEmailsFoldersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiReorderFavoriteEmailsFoldersDataDto | yes |  |

**`PublicApiReorderFavoriteEmailsFoldersDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `reordered` | boolean | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `folders` | array<PublicApiFavoriteEmailsFolderDto> | yes |  |

### `PATCH /v1/favorites/emails/folders/{folderId}/visibility` — Set favorite email folder visibility

**Billing:** Free / no documented credit charge  
**Description:** Switches a root favorite email folder tree between delegated-user private scope and workspace organization scope. Workspace-scoped writes require a workspace writer; private conversion requires delegated ownership of every contained folder and saved email.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite emails folder UUID in the current scope. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `SetPublicApiFavoriteEmailsFolderVisibilityBodyDto`

**`SetPublicApiFavoriteEmailsFolderVisibilityBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `visibility` | enum[private, organization] | yes | organization publishes a root email folder tree to the API credential workspace. private converts it to delegated-user personal scope when the delegated user owns every contained folder and saved email. |

Response: `PublicApiFavoriteEmailsFolderMutationResponseDto` — Favorite email folder visibility response.
(schema documented above under `PublicApiFavoriteEmailsFolderMutationResponseDto`)

### `PATCH /v1/favorites/emails/folders/{folderId}` — Rename or move a favorite email folder

**Billing:** Free / no documented credit charge  
**Description:** Renames and/or moves a favorite email folder. parentId null moves the folder to root.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite emails folder UUID. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `UpdatePublicApiFavoriteEmailsFolderBodyDto`

**`UpdatePublicApiFavoriteEmailsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string |  |  |
| `parentId` | object |  | Public parent email folder UUID. Use null to move to root; omit to keep the current parent. |

Response: `PublicApiFavoriteEmailsFolderMutationResponseDto` — Favorite email folder mutation response.
(schema documented above under `PublicApiFavoriteEmailsFolderMutationResponseDto`)

### `DELETE /v1/favorites/emails/folders/{folderId}` — Delete a favorite email folder

**Billing:** Free / no documented credit charge  
**Description:** Deletes a favorite email folder tree with explicit contained-email handling: delete_items, move_items_to_root, or move_items_to_folder. Cross-scope target folders are rejected by scoped lookup.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `folderId` | path | string | yes | Public favorite emails folder UUID. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |

Request body: `DeletePublicApiFavoriteEmailsFolderBodyDto`

**`DeletePublicApiFavoriteEmailsFolderBodyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `mode` | enum[delete_items, move_items_to_root, move_items_to_folder] | yes |  |
| `targetFolderId` | object |  |  |

Response: `PublicApiDeleteFavoriteEmailsFolderResponseDto` — Favorite email folder delete response.

**`PublicApiDeleteFavoriteEmailsFolderResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiDeleteFavoriteEmailsFolderDataDto | yes |  |

**`PublicApiDeleteFavoriteEmailsFolderDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `deleted` | boolean | yes |  |
| `folderId` | string | yes |  |
| `scope` | enum[workspace, personal] | yes |  |
| `mode` | enum[delete_items, move_items_to_root, move_items_to_folder] | yes |  |
| `targetFolderId` | string | yes |  |
| `deletedFolderIds` | array<string> | yes |  |
| `affectedFavoriteIds` | array<string> | yes |  |

### `DELETE /v1/favorites/emails/{emailId}` — Remove a favorite email by email id

**Billing:** Free / no documented credit charge  
**Description:** Removes a saved favorite email from the requested scope and optional folder. To remove a specific saved row, prefer DELETE /v1/favorites/emails/saved/:favoriteId.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `emailId` | path | integer | yes | Public email identifier. To delete a saved favorite row by favorite_emails.uuid, use DELETE /v1/favorites/emails/saved/:favoriteId. |
| `scope` | query | enum[workspace, personal] | yes | Favorites scope. Use personal only with a delegated_user credential. full_access credentials receive 403 for personal scope. |
| `folderId` | query | string |  | Public email folder UUID. Numeric folder IDs are internal and never accepted by the Public API. |

Response: `PublicApiRemoveFavoriteEmailResponseDto` — Favorite email removal response.
(schema documented above under `PublicApiRemoveFavoriteEmailResponseDto`)


---

## Google Ads

### `POST /v1/google-ads/query` — Query Google Ads

**Billing:** Metered (credits)  
**Description:** Queries the dedicated Google Ads library. Networks, audience countries, and Google category ids map to verified google-ads-search fields.

Request body: `QueryPublicApiGoogleAdsRequestDto`

**`QueryPublicApiGoogleAdsRequestDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `search` | array<string> |  | Optional Google advertiser/domain search terms. |
| `status` | enum[active, inactive, all] |  |  |
| `networks` | array<enum[search, shopping, maps, youtube, other]> |  | Google delivery networks. Values are normalized to the casing used by the Google Ads search index. |
| `categoryIds` | array<number> |  | Google category ids returned by GET /v1/google-ads/facets/categories. These correspond to the app legacy niches parameter. |
| `audienceCountries` | PublicApiGoogleAdsAudienceCountriesDto |  | Audience-country filter. This is intentionally distinct from advertiser/shop creation country. |
| `publishedAfter` | string |  |  |
| `publishedBefore` | string |  |  |
| `minDaysRunning` | number |  |  |
| `maxDaysRunning` | number |  |  |
| `minReach` | number |  |  |
| `maxReach` | number |  |  |
| `sortBy` | enum[newest, reach, longestRunning] |  |  |
| `order` | enum[asc, desc] |  |  |
| `page` | object |  |  |
| `limit` | object |  |  |

**`PublicApiGoogleAdsAudienceCountriesDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `include` | array<string> |  | ISO 3166-1 alpha-2 audience countries to include. Google Ads matches targeting.main_country. |
| `exclude` | array<string> |  | ISO 3166-1 alpha-2 audience countries to exclude. Google Ads matches targeting.main_country. |

Response: `PublicApiGoogleAdsQueryResponseDto` — Paginated Google Ads response. One returned ad is one billable ads credit.

**`PublicApiGoogleAdsQueryResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiGoogleAdDto> | yes |  |
| `pagination` | PublicApiGoogleAdsPaginationDto | yes |  |

**`PublicApiGoogleAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `googleAdId` | string | yes |  |
| `status` | enum[active, inactive] | yes |  |
| `network` | enum[search, shopping, maps, youtube, other] | yes |  |
| `firstSeenAt` | string | yes |  |
| `lastSeenAt` | string | yes |  |
| `daysRunning` | number | yes |  |
| `media` | PublicApiGoogleAdMediaDto | yes |  |
| `advertiser` | PublicApiGoogleAdAdvertiserDto | yes |  |
| `reach` | PublicApiGoogleAdReachDto | yes |  |
| `audience` | PublicApiGoogleAdAudienceDto | yes |  |

**`PublicApiGoogleAdMediaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `type` | enum[image, video] | yes |  |
| `url` | string | yes |  |
| `format` | string | yes |  |

**`PublicApiGoogleAdAdvertiserDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `shopName` | string | yes |  |
| `domain` | string | yes |  |
| `websiteId` | string | yes |  |
| `logoUrl` | string | yes |  |
| `liveAds` | PublicApiGoogleAdAdvertiserLiveAdsDto | yes |  |

**`PublicApiGoogleAdReachDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `value` | number | yes |  |
| `lowerBound` | number | yes |  |
| `upperBound` | number | yes |  |

**`PublicApiGoogleAdAudienceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `mainCountry` | string | yes |  |
| `countries` | array<PublicApiGoogleAdCountryDto> | yes |  |
| `remarketing` | boolean | yes |  |
| `interest` | boolean | yes |  |

**`PublicApiGoogleAdsPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes |  |
| `total` | number | yes |  |
| `totalPages` | number | yes |  |

### `GET /v1/google-ads/facets/networks` — List Google Ads network facets

**Billing:** Free / no documented credit charge  
**Description:** Returns the normalized Google delivery networks accepted by POST /v1/google-ads/query.

Response: `PublicApiGoogleAdsFacetResponseDto` — Google delivery networks with live ad counts.

**`PublicApiGoogleAdsFacetResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiGoogleAdsFacetValueDto> | yes |  |

**`PublicApiGoogleAdsFacetValueDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `value` | string | yes |  |
| `label` | string | yes |  |
| `adsCount` | number | yes |  |

### `GET /v1/google-ads/facets/countries` — List Google Ads audience-country facets

**Billing:** Free / no documented credit charge  
**Description:** Returns audience country codes observed in the Google Ads search index.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  |  |
| `limit` | query | Object |  |  |
| `offset` | query | Object |  |  |

Response: `PublicApiGoogleAdsFacetResponseDto` — Google audience countries with live ad counts.
(schema documented above under `PublicApiGoogleAdsFacetResponseDto`)

### `GET /v1/google-ads/facets/categories` — List Google Ads category facets

**Billing:** Free / no documented credit charge  
**Description:** Returns the Google category ids accepted by categoryIds on POST /v1/google-ads/query.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  |  |
| `limit` | query | Object |  |  |
| `offset` | query | Object |  |  |

Response: `PublicApiGoogleAdsCategoryFacetsResponseDto` — Paginated Google categories with advertiser usage counts.

**`PublicApiGoogleAdsCategoryFacetsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiGoogleAdsCategoryFacetDto> | yes |  |
| `pagination` | PublicApiGoogleAdsCategoryFacetPaginationDto | yes |  |

**`PublicApiGoogleAdsCategoryFacetDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | number | yes |  |
| `name` | string | yes |  |
| `path` | string | yes |  |
| `parentId` | number | yes |  |
| `advertiserUsageCount` | number | yes |  |

**`PublicApiGoogleAdsCategoryFacetPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `limit` | number | yes |  |
| `offset` | number | yes |  |
| `total` | number | yes |  |


---

## Identity

### `GET /v1/me` — Resolve the current API credential

**Billing:** Free / no documented credit charge  
**Description:** Returns the workspace, credential, and delegated user context resolved from the provided public API key.

Response: `PublicApiMeResponseDto` — Resolved public API identity payload. The response also includes the X-Request-Id header.

**`PublicApiMeResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `credential` | PublicApiCredentialDto | yes |  |
| `workspace` | PublicApiWorkspaceDto | yes |  |
| `delegatedUser` | PublicApiDelegatedUserDto | yes | Delegated user context when the credential access level is delegated_user. |

**`PublicApiCredentialDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `description` | string | yes | Optional credential description. |
| `accessLevel` | enum[full_access, delegated_user] | yes |  |
| `expiresAt` | string | yes | Credential expiration timestamp when configured. |
| `createdAt` | string | yes |  |
| `lastUsedAt` | string | yes |  |

**`PublicApiWorkspaceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `slug` | string | yes |  |
| `name` | string | yes |  |
| `createdAt` | string | yes |  |

**`PublicApiDelegatedUserDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `fullName` | string | yes |  |
| `avatarUrl` | string | yes |  |
| `workspaceRole` | enum[owner, admin, member, readonly] | yes |  |


---

## Shops

### `GET /v1/shops` — List shops

**Billing:** Free / no documented credit charge  
**Description:** Returns the lightweight public shops browse surface. This endpoint stays intentionally simple and covers the default discovery path through search, pagination, sorting, and a small stable subset of filters. For the full advanced filtering contract, use POST /v1/shops/query.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  | Optional broad shop identity search term matched against domain, related domains, and shop name. This GET browse search remains broad; use POST /v1/shops/query with searchType="domain" for exact domain matching. |
| `sortBy` | query | enum[monthlyVisits, activeAds, growth30d, productsCount, createdAt, tiktokFollowers, tiktokActiveAds, tiktokTotalPosts, tiktokAvgActiveAds7d, tiktokAvgActiveAds30d] |  | Optional sort key for the shops list. Defaults to monthlyVisits. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `offset` | query | integer |  | Pagination offset. Defaults to 0. |
| `limit` | query | integer |  | Maximum number of shops to return. Defaults to 32. |
| `minMonthlyVisits` | query | integer |  | Optional minimum monthly visits filter. |
| `maxMonthlyVisits` | query | integer |  | Optional maximum monthly visits filter. |
| `minActiveAds` | query | number |  | Optional minimum active ads filter. The metric follows adsTimePeriod. |
| `maxActiveAds` | query | number |  | Optional maximum active ads filter. The metric follows adsTimePeriod. |
| `adsTimePeriod` | query | enum[last24h, last7d, last30d] |  | Optional time period used by active ads filters and sorting. Defaults to last24h. |
| `hasTikTok` | query | boolean |  | Optional TikTok presence filter backed by the legacy flat shop index. true requires an indexed TikTok page or handle; false excludes shops with one. |
| `minTikTokFollowers` | query | number |  |  |
| `maxTikTokFollowers` | query | number |  |  |
| `minTikTokActiveAds` | query | number |  |  |
| `maxTikTokActiveAds` | query | number |  |  |
| `minTikTokTotalPosts` | query | number |  |  |
| `maxTikTokTotalPosts` | query | number |  |  |
| `minProductsCount` | query | integer |  | Optional minimum products count filter. |
| `maxProductsCount` | query | integer |  | Optional maximum products count filter. |
| `createdAfter` | query | string |  | Optional inclusive lower bound for shop creation date. |
| `createdBefore` | query | string |  | Optional inclusive upper bound for shop creation date. |
| `isShopifyPlus` | query | boolean |  | Optional Shopify Plus filter. |
| `categoryIds` | query | array<integer> |  | Optional category ids. Uses the same index field as POST /v1/shops/query categoryIds. |
| `pixelIds` | query | array<string> |  | Optional stable pixel/technology ids. Uses the same index field as POST /v1/shops/query pixelIds. |
| `excludePixelIds` | query | array<string> |  | Optional stable pixel/technology ids to exclude. Uses the same index field as POST /v1/shops/query excludePixelIds. |
| `shopifyAppIds` | query | array<integer> |  | Optional Shopify app identifiers. Uses the same index field as POST /v1/shops/query shopifyAppIds. |
| `excludeShopifyAppIds` | query | array<integer> |  | Optional Shopify app identifiers to exclude. Uses the same index field as POST /v1/shops/query excludeShopifyAppIds. |
| `languages` | query | array<string> |  | Optional default language filters. Accepts repeated query params or a comma-separated list. |
| `currencies` | query | array<string> |  | Optional default currency filters. Accepts repeated query params or a comma-separated list. |
| `minTrustpilotRating` | query | number |  | Optional minimum Trustpilot rating filter. |
| `maxTrustpilotRating` | query | number |  | Optional maximum Trustpilot rating filter. |
| `minTrustpilotReviewCount` | query | integer |  | Optional minimum Trustpilot reviews filter. |
| `maxTrustpilotReviewCount` | query | integer |  | Optional maximum Trustpilot reviews filter. |

Response: `PublicApiGetShopsResponseDto` — Paginated shops response. The response also includes the X-Request-Id header.

**`PublicApiGetShopsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiShopSummaryDto> | yes |  |
| `pagination` | PublicApiPaginationDto | yes |  |

**`PublicApiPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `limit` | number | yes |  |
| `offset` | number | yes |  |
| `total` | number | yes |  |

### `POST /v1/shops/query` — Query shops

**Billing:** Free / no documented credit charge  
**Description:** Returns the advanced public shops discovery surface. This endpoint is the canonical public route for complex filtering and sorting, while keeping the response aligned with the standard public ShopSummary contract. searchType=domain performs exact domain/related-domain matching from a domain or URL and does not fall back to broad wildcard/text matching.

Request body: `QueryPublicApiShopsRequestDto`

**`QueryPublicApiShopsRequestDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `search` | string |  | Optional search string. For searchType="domain", send a domain or URL for exact domain/related-domain matching. For broad website text search, use shopContains. For product text, use productName. Do not send unsupported legacy keys name, domain, or domains. |
| `searchType` | enum[domain, productName, shopContains] |  | Search mode. domain performs exact domain/related-domain matching from a domain or URL, productName searches indexed product text, and shopContains uses the broad website text-search index. |
| `sortBy` | enum[relevance, monthlyVisits, activeAds, growth30d, productsCount, createdAt, tiktokFollowers, tiktokActiveAds, tiktokTotalPosts, tiktokAvgActiveAds7d, tiktokAvgActiveAds30d] |  | Sort key for the advanced shops query surface. relevance falls back to monthlyVisits when the request does not produce a scored text query. |
| `order` | enum[asc, desc] |  | Enum value accepted by this request. Allowed values: `asc`, `desc`. |
| `offset` | number |  |  |
| `limit` | number |  |  |
| `categoryIds` | array<number> |  | Optional category ids used by the current shop discovery index. |
| `minEstimatedRevenue` | number |  | Optional minimum estimated revenue filter. This currently follows the same approximate indexed revenue model as the app. |
| `maxEstimatedRevenue` | number |  | Optional maximum estimated revenue filter. This currently follows the same approximate indexed revenue model as the app. |
| `minMonthlyVisits` | number |  |  |
| `maxMonthlyVisits` | number |  |  |
| `minProductsCount` | number |  |  |
| `maxProductsCount` | number |  |  |
| `createdAfter` | string |  |  |
| `createdBefore` | string |  |  |
| `mainMarketCountries` | array<string> |  | Optional main audience-market filter using uppercase ISO 3166-1 alpha-2 country codes matched against the indexed main_market field. |
| `marketCountries` | array<string> |  | Optional audience-market filter for shops where these countries appear among the indexed traffic markets. |
| `excludeMarketCountries` | array<string> |  |  |
| `minBestSellerPrice` | number |  |  |
| `maxBestSellerPrice` | number |  |  |
| `minActiveAds` | number |  | Optional minimum active ads filter. The metric follows adsTimePeriod. |
| `maxActiveAds` | number |  | Optional maximum active ads filter. The metric follows adsTimePeriod. |
| `adsTimePeriod` | enum[last24h, last7d, last30d] |  | Time window accepted by this request. Allowed values: `last24h`, `last7d`, `last30d`. |
| `hasTikTok` | boolean |  | Optional TikTok presence filter backed by the legacy flat shop index. true requires an indexed TikTok page or handle; false excludes shops with one. |
| `minTikTokFollowers` | number |  |  |
| `maxTikTokFollowers` | number |  |  |
| `minTikTokActiveAds` | number |  |  |
| `maxTikTokActiveAds` | number |  |  |
| `minTikTokTotalPosts` | number |  |  |
| `maxTikTokTotalPosts` | number |  |  |
| `isShopifyPlus` | boolean |  |  |
| `trafficGrowth` | array<PublicApiTrafficGrowthConditionDto> |  | Traffic growth filters. Each condition uses `period`, `comparison`, and `value`; optional `operator` links the condition to the next one. |
| `adsGrowth` | array<PublicApiAdsGrowthConditionDto> |  | Ads growth filters. Each condition uses `period`, `comparison`, and `value`; optional `operator` links the condition to the next one. |
| `pageReachGrowth` | array<PublicApiReachGrowthConditionDto> |  | Page reach growth filters. Each condition uses `period`, `comparison`, and `value`; optional `operator` links the condition to the next one. |
| `adReachGrowth` | array<PublicApiReachGrowthConditionDto> |  | Ad reach growth filters. Each condition uses `period`, `comparison`, and `value`; optional `operator` links the condition to the next one. |
| `creationCountries` | array<string> |  |  |
| `excludeCreationCountries` | array<string> |  |  |
| `displayInTrending` | boolean |  | When true, restricts results to shops visible in the TrendTrack trending shops feed. |
| `themeIds` | array<string> |  | Optional indexed Shopify theme identifier strings backed by the current website discovery index. These are ids, not display names. |
| `pixelIds` | array<string> |  | Optional stable pixel/technology ids backed by the current website discovery index. These are ids, not display names such as "Meta". |
| `excludePixelIds` | array<string> |  | Optional stable pixel/technology ids to exclude. These are ids, not display names. |
| `shopifyAppIds` | array<number> |  | Optional Shopify app identifiers backed by the current website discovery index. |
| `excludeShopifyAppIds` | array<number> |  |  |
| `minTrustpilotRating` | number |  |  |
| `maxTrustpilotRating` | number |  |  |
| `minTrustpilotReviewCount` | number |  |  |
| `maxTrustpilotReviewCount` | number |  |  |
| `languages` | array<string> |  |  |
| `currencies` | array<string> |  |  |
| `dtcRegion` | enum[all, us, eu] |  | Optional DTC preset. all means any indexed DTC shop, while us and eu also apply the corresponding creation-country subset used by the app. |

**`PublicApiTrafficGrowthConditionDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `period` | enum[last30d, last90d, last180d] | yes | Indexed traffic growth window. |
| `value` | number |  | Minimum or maximum growth threshold, expressed as a percentage. |
| `comparison` | enum[greater, lower] | yes | Comparison applied to the growth threshold. Use `greater` for gte and `lower` for lte semantics. |
| `operator` | enum[and, or] |  | Logical operator linking this condition to the next one in the array. |

**`PublicApiAdsGrowthConditionDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `period` | enum[last7d, last30d, last90d] | yes | Indexed ads growth window. |
| `value` | number |  | Minimum or maximum growth threshold, expressed as a percentage. |
| `comparison` | enum[greater, lower] | yes | Comparison applied to the growth threshold. Use `greater` for gte and `lower` for lte semantics. |
| `operator` | enum[and, or] |  | Comparison operator for this rule. Allowed values: `and`, `or`. |

**`PublicApiReachGrowthConditionDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `period` | enum[last7d, last14d, last30d, last60d, last90d] | yes | Indexed reach growth window. |
| `value` | number |  | Minimum or maximum growth threshold, expressed as a percentage. |
| `comparison` | enum[greater, lower] | yes | Comparison applied to the growth threshold. Use `greater` for gte and `lower` for lte semantics. |
| `operator` | enum[and, or] |  | Comparison operator for this rule. Allowed values: `and`, `or`. |

Response: `PublicApiGetShopsResponseDto` — Paginated advanced shops query response. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiGetShopsResponseDto`)

### `GET /v1/shops/{identifier}/similar` — List shops similar to a domain or shop id

**Billing:** Free / no documented credit charge  
**Description:** Returns a paginated list of similar shops using the public hybrid shops contract. The identifier can be a canonical domain or a public shop id / website UUID. When the resolved shop is not present in the similar shops engine, the endpoint still returns 200 with an empty data array and meta.shopExists=false.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `identifier` | path | string | yes | Canonical shop domain or stable public shop id / website UUID used to resolve similar shops. |
| `sortBy` | query | enum[relevance, monthlyVisits, activeAds, growth30d, productsCount, createdAt] |  | Sort key for similar shops. createdAt uses request-time normalization while the backing creation_date field remains keyword-mapped; native date sorting requires an Elasticsearch mapping/reindex update. |
| `order` | query | enum[asc, desc] |  | Optional sort order. Defaults to desc. |
| `offset` | query | integer |  | Pagination offset. Defaults to 0. |
| `limit` | query | integer |  | Maximum number of similar shops to return. Defaults to 32. |

Response: `PublicApiGetSimilarShopsResponseDto` — Paginated similar shops response for the requested identifier. The response also includes the X-Request-Id header.

**`PublicApiGetSimilarShopsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiSimilarShopItemDto> | yes |  |
| `pagination` | PublicApiPaginationDto | yes |  |
| `meta` | PublicApiGetSimilarShopsMetaDto | yes |  |

**`PublicApiSimilarShopItemDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `shop` | PublicApiShopSummaryDto | yes |  |
| `similarityScore` | number | yes |  |

**`PublicApiGetSimilarShopsMetaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `shopExists` | boolean | yes | False when the resolved shop/domain does not exist in the similar shops engine. |

### `GET /v1/shops/{shopId}` — Get a shop by id

**Billing:** Free / no documented credit charge  
**Description:** Returns the public hybrid shop detail read model for a single shop identifier.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `shopId` | path | string | yes | Stable public shop identifier. |

Response: `PublicApiGetShopResponseDto` — Detailed public shop response. The response also includes the X-Request-Id header.

**`PublicApiGetShopResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | PublicApiShopDetailDto | yes |  |

**`PublicApiShopDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |
| `screenshotUrl` | string | yes |  |
| `createdAt` | string | yes |  |
| `profile` | PublicApiShopDetailProfileDto | yes |  |
| `trustpilot` | PublicApiShopTrustpilotDto | yes |  |
| `socials` | PublicApiShopSocialsDto | yes |  |
| `catalog` | PublicApiShopDetailCatalogDto | yes |  |
| `traffic` | PublicApiShopDetailTrafficDto | yes |  |
| `advertising` | PublicApiShopDetailAdvertisingDto | yes |  |
| `technology` | PublicApiShopTechnologyDto | yes |  |
| `tiktok` | PublicApiShopTikTokDetailDto | yes |  |
| `latestAds` | array<PublicApiShopLatestAdDto> | yes | Up to 3 most recent Meta ads published by the shop. |
| `similarShops` | array<PublicApiSimilarShopItemDto> | yes | Preview of up to 6 shops ranked by similarity (relevance desc). For the full paginated list, call GET /v1/shops/{identifier}/similar using either the domain or public shop id. |

**`PublicApiShopDetailProfileDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `countryCode` | string | yes |  |
| `currency` | string | yes |  |
| `isShopifyPlus` | boolean | yes |  |
| `defaultLanguage` | string | yes |  |

**`PublicApiShopTrustpilotDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `rating` | number | yes |  |
| `reviewCount` | number | yes |  |
| `brandName` | string | yes |  |
| `brandLogo` | string | yes |  |
| `url` | string | yes |  |

**`PublicApiShopSocialsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `facebook` | PublicApiShopSocialNetworkDto | yes |  |
| `instagram` | PublicApiShopSocialNetworkDto | yes |  |
| `tiktok` | PublicApiShopSocialNetworkDto | yes |  |
| `youtube` | PublicApiShopSocialNetworkDto | yes |  |
| `pinterest` | PublicApiShopSocialNetworkDto | yes |  |
| `linkedin` | PublicApiShopSocialNetworkDto | yes |  |
| `twitter` | PublicApiShopSocialNetworkDto | yes |  |

**`PublicApiShopDetailCatalogDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `productsCount` | number | yes |  |
| `mainCategory` | string | yes |  |
| `bestSellers` | array<PublicApiShopBestSellerDto> | yes | Top best-selling products for this shop. Capped at 3 items. Sourced from `shopify_best_selling` when available, with fallback to `best_sellers_object` then `best_sellers` image URLs. |
| `categories` | array<string> | yes |  |
| `myShopifyDomain` | string | yes |  |

**`PublicApiShopDetailTrafficDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `monthlyVisits` | number | yes |  |
| `growth30d` | number | yes |  |
| `history` | array<PublicApiTimeSeriesPointDto> | yes | Monthly visits time-series, sorted ascending by period. Capped at the 6 most recent months. |
| `topCountries` | array<PublicApiCountryShareDto> | yes | Top markets by traffic share (country code + share in [0, 1]). Derived from SimilarWeb geography breakdown when available, otherwise from the `countries` list with null shares. |
| `growth90d` | number | yes |  |
| `growth180d` | number | yes |  |
| `mainMarkets` | array<PublicApiCountryShareDto> | yes | Alias of `topCountries` kept for backwards compatibility with the detail endpoint. |

**`PublicApiShopDetailAdvertisingDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `activeAds` | number | yes |  |
| `linkedAdvertisersCount` | number | yes |  |
| `history` | array<PublicApiTimeSeriesPointDto> | yes | Weekly active-ads time-series, sorted ascending by period. Capped at the 26 most recent weekly points (~6 months). |
| `topCountries` | array<PublicApiCountryShareDto> | yes | Top countries by Meta ads volume (share in [0, 1]). Derived from the shop-level `ads_country_stats` aggregate across all linked advertisers. |
| `linkedAdvertisers` | array<PublicApiLinkedAdvertiserSummaryDto> | yes |  |
| `summary` | PublicApiShopAdvertisingSummaryDto | yes |  |
| `adsCountryStats` | array<PublicApiCountryShareDto> | yes | Shop-level Meta ads country distribution from `ads_country_stats`. Distinct from `summary.countryDistribution`, which is derived from linked Facebook page reach. |

**`PublicApiShopTechnologyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `theme` | string | yes |  |
| `apps` | array<PublicApiShopAppDto> | yes | Shopify apps detected on the shop, with vendor icons. |
| `pixels` | array<PublicApiShopPixelDto> | yes | Pixels detected on the shop, resolved to human-readable names and icons via the public technologies vocabulary. |

**`PublicApiShopTikTokDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `hasTikTok` | boolean | yes | True when the shop has an indexed TikTok page/handle or TikTok rollup activity. This is independent from Meta advertising fields. |
| `pageId` | string | yes |  |
| `handle` | string | yes |  |
| `profileMetrics` | PublicApiShopTikTokProfileMetricsDto | yes |  |
| `activity` | PublicApiShopTikTokActivityDto | yes |  |
| `lastUpdatedAt` | string | yes |  |

**`PublicApiShopLatestAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `mediaType` | enum[image, video] | yes |  |
| `mediaUrl` | string | yes |  |
| `thumbnailUrl` | string | yes |  |

### `GET /v1/shops/{shopId}/advertisers` — List advertisers linked to a shop

**Billing:** Free / no documented credit charge  
**Description:** Returns the linked advertiser summaries for a single shop identifier.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `shopId` | path | string | yes | Stable public shop identifier. |
| `limit` | query | integer |  |  |

Response: `PublicApiGetShopAdvertisersResponseDto` — Linked advertisers response. The response also includes the X-Request-Id header.

**`PublicApiGetShopAdvertisersResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiLinkedAdvertiserSummaryDto> | yes |  |

**`PublicApiLinkedAdvertiserSummaryDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `platform` | enum[facebook] | yes |  |
| `facebookPageId` | string | yes |  |
| `name` | string | yes |  |
| `isPrimary` | boolean | yes |  |
| `activeAds` | number | yes |  |

### `GET /v1/shops/{shopId}/socials/history` — Get shop social follower history

**Billing:** Free / no documented credit charge  
**Description:** Returns follower time-series for Facebook and Instagram for the linked advertiser page of the shop. Other networks are handle-only today and not exposed here.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `shopId` | path | string | yes | Stable public shop identifier. |
| `period` | query | enum[day, week, month] |  | Aggregation bucket for the follower time series. Week and month pick the last raw snapshot of each bucket. |
| `days` | query | integer |  | Rolling lookback window, in days, ending at the latest snapshot. |

Response: `PublicApiGetShopSocialsHistoryResponseDto` — Follower time-series response. The response also includes the X-Request-Id header.

**`PublicApiGetShopSocialsHistoryResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiShopSocialsHistoryDataDto | yes |  |

**`PublicApiShopSocialsHistoryDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `facebook` | array<PublicApiTimeSeriesPointDto> | yes | Facebook follower snapshots ordered ascending by period. Empty when no Facebook page is linked to the shop. |
| `instagram` | array<PublicApiTimeSeriesPointDto> | yes | Instagram follower snapshots ordered ascending by period. Empty when the linked Facebook page has no connected Instagram account. |

**`PublicApiTimeSeriesPointDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `period` | string | yes | ISO date string representing the period start. Month-first (YYYY-MM-DD) for monthly series, week-first for weekly series. |
| `value` | number | yes |  |

### `GET /v1/shops/{shopId}/products` — List shop products

**Billing:** Free / no documented credit charge  
**Description:** Returns the paginated list of Shopify best-selling products for a single shop. Products come from the shop’s Shopify best-seller feed and can be sorted by rank, price, or creation date.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `shopId` | path | string | yes | Stable public shop identifier. |
| `limit` | query | integer |  | Maximum number of products to return per page. |
| `offset` | query | integer |  | Offset into the products list. |
| `sortBy` | query | enum[popularity, price, createdAt] |  | Sort key. `popularity` orders by Shopify best-seller rank; `price` by product price; `createdAt` by Shopify product creation date. |
| `order` | query | enum[asc, desc] |  | Sort direction. Defaults to `asc` for `popularity` and `desc` otherwise. |

Response: `PublicApiGetShopProductsResponseDto` — Paginated shop products response. The response also includes the X-Request-Id header.

**`PublicApiGetShopProductsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiShopProductDto> | yes |  |
| `pagination` | PublicApiPaginationDto | yes |  |

**`PublicApiShopProductDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Upstream Shopify numeric product id (as a string). |
| `title` | string | yes |  |
| `handle` | string | yes | Shopify product handle (URL slug). |
| `imageUrl` | string | yes |  |
| `productUrl` | string | yes |  |
| `price` | number | yes |  |
| `currency` | string | yes |  |
| `rank` | number | yes | Position of the product in the shop’s best-seller list, with 1 being the best seller. |
| `createdAt` | string | yes | Shopify product creation date. |
| `publishedAt` | string | yes | Shopify product publication date. |


---

## System

### `GET /v1` — Get public API metadata

**Billing:** Free / no documented credit charge  
**Description:** Returns a minimal bootstrap payload describing the current Trendtrack Public API version and status.

Response: `PublicApiInfoResponseDto` — Public API metadata. The response also includes the X-Request-Id header.

**`PublicApiInfoResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `name` | string | yes | Public API product name. |
| `version` | string | yes | Current public API version. |
| `status` | string | yes | Bootstrap health indicator. |

### `GET /v1/health` — Check public API health

**Billing:** Free / no documented credit charge  
**Description:** Returns a lightweight health payload for the public bootstrap mounted under /v1.

Response: `PublicApiHealthResponseDto` — Public bootstrap health snapshot. The response also includes the X-Request-Id header.

**`PublicApiHealthResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `status` | string | yes | Health status for the public bootstrap. |
| `timestamp` | string | yes | ISO timestamp captured when the health check was served. |
| `uptime` | number | yes | Process uptime in seconds. |

### `GET /v1/system/freshness` — Read public API data freshness

**Billing:** Free / no documented credit charge  
**Description:** Returns the latest ready and latest indexed/scheduled global snapshot dates for public API reach-history data.

Response: `PublicApiSystemFreshnessResponseDto` — Global public API data freshness payload. The response also includes the X-Request-Id header.

**`PublicApiSystemFreshnessResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `status` | string | yes | System freshness endpoint status. |
| `data` | PublicApiSystemFreshnessDataDto | yes |  |

**`PublicApiSystemFreshnessDataDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `latestReadyDate` | string | yes | Latest global snapshot date with usable reach rows, or null when none exists. |
| `latestScheduledDate` | string | yes | Latest global indexed/scheduled snapshot date observed in reach history, even if not ready yet. |
| `dataFreshnessLagDays` | number | yes | Difference in whole UTC days between today and latestReadyDate. Null when no ready snapshot exists. |
| `generatedAt` | string | yes | ISO timestamp captured when this freshness payload was generated. |


---

## TikTok

### `GET /v1/tiktok/library` — List TikTok library items

**Billing:** Metered (credits)  
**Description:** Returns TikTok ads and organic videos from the Public API TikTok library. This namespace is separate from the Meta-only /v1/ads endpoints and is backed by the tiktoks-search Elasticsearch alias.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `search` | query | string |  |  |
| `searchArea` | query | enum[all, caption, profile, hashtag, music] |  |  |
| `type` | query | enum[all, ad, organic] |  |  |
| `status` | query | enum[all, active, inactive] |  |  |
| `mediaTypes` | query | array<enum[image, video, carousel]> |  |  |
| `languages` | query | array<string> |  |  |
| `countries` | query | array<string> |  |  |
| `hashtags` | query | array<string> |  |  |
| `tiktokPageId` | query | string |  |  |
| `domain` | query | string |  |  |
| `handle` | query | string |  |  |
| `publishedAfter` | query | string |  |  |
| `publishedBefore` | query | string |  |  |
| `minViews` | query | integer |  |  |
| `maxViews` | query | integer |  |  |
| `minEngagementRate` | query | number |  |  |
| `maxEngagementRate` | query | number |  |  |
| `sortBy` | query | enum[relevance, newest, updatedAt, views, likes, comments, shares, saves, engagementRate, daysRunning, followers] |  |  |
| `order` | query | enum[asc, desc] |  |  |
| `page` | query | Object |  |  |
| `limit` | query | Object |  |  |

Response: `PublicApiTikTokLibraryResponseDto` — Paginated TikTok library response. One returned TikTok item is one billable ads credit.

**`PublicApiTikTokLibraryResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiTikTokLibraryItemDto> | yes |  |
| `pagination` | PublicApiTikTokLibraryPaginationDto | yes |  |

**`PublicApiTikTokLibraryItemDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `tiktokId` | string | yes |  |
| `type` | enum[ad, organic] | yes |  |
| `status` | enum[active, inactive, unknown] | yes |  |
| `isPinned` | boolean | yes |  |
| `publishedAt` | string | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `daysRunning` | number | yes |  |
| `media` | PublicApiTikTokMediaDto | yes |  |
| `content` | PublicApiTikTokContentDto | yes |  |
| `metrics` | PublicApiTikTokMetricsDto | yes |  |
| `profile` | PublicApiTikTokProfileDto | yes |  |
| `shop` | PublicApiTikTokShopDto | yes |  |
| `pin` | PublicApiTikTokPinDto | yes |  |
| `pageSnapshot` | PublicApiTikTokPageSnapshotDto | yes |  |
| `indexedAt` | string | yes |  |

**`PublicApiTikTokMediaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `type` | enum[image, video, carousel, unknown] | yes |  |
| `thumbnailUrl` | string | yes |  |
| `mediaUrl` | string | yes |  |
| `videoUrl` | string | yes |  |
| `imageUrls` | array<string> | yes |  |
| `medias` | array<PublicApiTikTokMediaItemDto> | yes |  |
| `durationSec` | number | yes |  |
| `mediaCount` | number | yes |  |
| `imageCount` | number | yes |  |

**`PublicApiTikTokContentDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `description` | string | yes |  |
| `language` | string | yes |  |
| `category` | string | yes |  |
| `hashtags` | array<string> | yes |  |
| `music` | PublicApiTikTokMusicDto | yes |  |

**`PublicApiTikTokMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `views` | number | yes |  |
| `likes` | number | yes |  |
| `comments` | number | yes |  |
| `saves` | number | yes |  |
| `shares` | number | yes |  |
| `reposts` | number | yes |  |
| `engagementRate` | number | yes | Percentage, not fraction. |
| `rank` | number | yes |  |
| `rankPercent` | number | yes |  |
| `relevanceScore` | number | yes |  |
| `deltaRank3d` | number | yes |  |
| `deltaRank7d` | number | yes |  |
| `deltaRank14d` | number | yes |  |
| `deltaRank30d` | number | yes |  |

**`PublicApiTikTokProfileDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `handle` | string | yes |  |
| `name` | string | yes |  |
| `avatarUrl` | string | yes |  |
| `bio` | string | yes |  |
| `bioUrl` | string | yes |  |
| `accountType` | string | yes |  |
| `secUid` | string | yes |  |
| `followers` | number | yes |  |
| `following` | number | yes |  |
| `totalTikToks` | number | yes |  |
| `newTikToks` | number | yes |  |
| `percentAds` | number | yes |  |
| `views` | number | yes |  |
| `likes` | number | yes |  |
| `pageCreation` | string | yes |  |

**`PublicApiTikTokShopDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `domain` | string | yes |  |
| `name` | string | yes |  |
| `logoUrl` | string | yes |  |
| `faviconUrl` | string | yes |  |
| `countryCode` | string | yes |  |
| `monthlyVisits` | number | yes |  |
| `trafficGrowth30d` | number | yes |  |
| `productsCount` | number | yes |  |
| `googleCategoryIds` | array<number> | yes |  |

**`PublicApiTikTokPinDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `isCurrent` | boolean | yes |  |
| `firstPinnedAt` | string | yes |  |
| `lastPinnedAt` | string | yes |  |
| `lastUnpinnedAt` | string | yes |  |

**`PublicApiTikTokPageSnapshotDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `recordedAt` | string | yes |  |
| `adsCount` | number | yes |  |
| `organicCount` | number | yes |  |
| `totalTikToks` | number | yes |  |
| `dailyViews` | number | yes |  |
| `dailyLikes` | number | yes |  |
| `dailyFollowers` | number | yes |  |

**`PublicApiTikTokLibraryPaginationDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `page` | number | yes |  |
| `limit` | number | yes |  |
| `total` | number | yes |  |
| `totalPages` | number | yes |  |

### `POST /v1/tiktok/library/query` — Query TikTok library items

**Billing:** Metered (credits)  
**Description:** Advanced TikTok library query over ES-backed fields only. It intentionally does not use the internal Next /api/tiktok-ads route or per-request Postgres hydration.

Request body: `QueryPublicApiTikTokLibraryRequestDto`

**`QueryPublicApiTikTokLibraryRequestDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `search` | array<string> |  |  |
| `keywordMode` | enum[any, all] |  |  |
| `searchArea` | enum[all, caption, profile, hashtag, music] |  |  |
| `type` | enum[all, ad, organic] |  |  |
| `status` | enum[all, active, inactive] |  |  |
| `mediaTypes` | array<enum[image, video, carousel]> |  |  |
| `languages` | array<string> |  |  |
| `countries` | array<string> |  |  |
| `categories` | array<string> |  |  |
| `hashtags` | array<string> |  |  |
| `tiktokPageIds` | array<string> |  |  |
| `tiktokPageId` | string |  |  |
| `websiteId` | string |  |  |
| `domain` | string |  |  |
| `handle` | string |  |  |
| `hasShopLinked` | enum[yes, no] |  |  |
| `publishedAfter` | string |  |  |
| `publishedBefore` | string |  |  |
| `updatedAfter` | string |  |  |
| `updatedBefore` | string |  |  |
| `minDaysRunning` | number |  |  |
| `maxDaysRunning` | number |  |  |
| `minViews` | number |  |  |
| `maxViews` | number |  |  |
| `minLikes` | number |  |  |
| `minShares` | number |  |  |
| `minEngagementRate` | number |  |  |
| `maxEngagementRate` | number |  |  |
| `minFollowers` | number |  |  |
| `minProfileViews` | number |  |  |
| `isPinned` | boolean |  |  |
| `sortBy` | enum[relevance, newest, updatedAt, views, likes, comments, shares, saves, engagementRate, daysRunning, followers] |  |  |
| `order` | enum[asc, desc] |  |  |
| `page` | object |  |  |
| `limit` | object |  |  |

Response: `PublicApiTikTokLibraryResponseDto` — Paginated TikTok library query response. One returned TikTok item is one billable ads credit.
(schema documented above under `PublicApiTikTokLibraryResponseDto`)

### `GET /v1/tiktok/library/{itemId}` — Get a TikTok library item

**Billing:** Metered (credits)  
**Description:** Returns one TikTok library item detail by composite_ad_id, with tiktok_id fallback because tiktok_id is part of the tiktoks-search public ES contract.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `itemId` | path | string | yes |  |

Response: `PublicApiTikTokLibraryDetailResponseDto` — TikTok library detail response. One found TikTok item is one billable ads credit.

**`PublicApiTikTokLibraryDetailResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | PublicApiTikTokLibraryItemDetailDto | yes |  |

**`PublicApiTikTokLibraryItemDetailDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `tiktokId` | string | yes |  |
| `type` | enum[ad, organic] | yes |  |
| `status` | enum[active, inactive, unknown] | yes |  |
| `isPinned` | boolean | yes |  |
| `publishedAt` | string | yes |  |
| `createdAt` | string | yes |  |
| `updatedAt` | string | yes |  |
| `daysRunning` | number | yes |  |
| `media` | PublicApiTikTokMediaDto | yes |  |
| `content` | PublicApiTikTokContentDto | yes |  |
| `metrics` | PublicApiTikTokMetricsDto | yes |  |
| `profile` | PublicApiTikTokProfileDto | yes |  |
| `shop` | PublicApiTikTokShopDto | yes |  |
| `pin` | PublicApiTikTokPinDto | yes |  |
| `pageSnapshot` | PublicApiTikTokPageSnapshotDto | yes |  |
| `indexedAt` | string | yes |  |
| `links` | PublicApiTikTokLinksDto | yes |  |
| `source` | PublicApiTikTokSourceDto | yes |  |

**`PublicApiTikTokLinksDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `tiktokUrl` | string | yes |  |
| `profileUrl` | string | yes |  |

**`PublicApiTikTokSourceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `network` | string | yes |  |
| `sourceType` | string | yes |  |
| `tiktokPageId` | string | yes |  |
| `websiteId` | string | yes |  |
| `domain` | string | yes |  |

### `GET /v1/shops/{shopId}/tiktok/library` — List TikTok library items for a shop

**Billing:** Metered (credits)  
**Description:** Returns TikTok library items linked to one public shop id using exact ES shop identifiers. This route has a TikTok endpoint key and ads entitlement even though it is nested under /v1/shops.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `shopId` | path | string | yes | Stable public shop identifier. |
| `search` | query | string |  |  |
| `searchArea` | query | enum[all, caption, profile, hashtag, music] |  |  |
| `type` | query | enum[all, ad, organic] |  |  |
| `status` | query | enum[all, active, inactive] |  |  |
| `mediaTypes` | query | array<enum[image, video, carousel]> |  |  |
| `languages` | query | array<string> |  |  |
| `countries` | query | array<string> |  |  |
| `hashtags` | query | array<string> |  |  |
| `tiktokPageId` | query | string |  |  |
| `domain` | query | string |  |  |
| `handle` | query | string |  |  |
| `publishedAfter` | query | string |  |  |
| `publishedBefore` | query | string |  |  |
| `minViews` | query | number |  |  |
| `maxViews` | query | number |  |  |
| `minEngagementRate` | query | number |  |  |
| `maxEngagementRate` | query | number |  |  |
| `sortBy` | query | enum[relevance, newest, updatedAt, views, likes, comments, shares, saves, engagementRate, daysRunning, followers] |  |  |
| `order` | query | enum[asc, desc] |  |  |
| `page` | query | Object |  |  |
| `limit` | query | Object |  |  |

Response: `PublicApiTikTokLibraryResponseDto` — Paginated shop-scoped TikTok library response. One returned TikTok item is one billable ads credit.
(schema documented above under `PublicApiTikTokLibraryResponseDto`)


---

## Usage

### `GET /v1/usage` — Read the current workspace usage snapshot

**Billing:** Metered (credits)  
**Description:** Returns the current public API billing, included quota, and credit balance snapshot for the authenticated workspace.

Response: `PublicApiUsageResponseDto` — Current usage snapshot for the authenticated workspace. The response also includes the X-Request-Id, X-Usage-Cost, X-Credits-Used, and X-Credits-Remaining headers.

**`PublicApiUsageResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `workspace` | PublicApiUsageWorkspaceDto | yes |  |
| `credential` | PublicApiUsageCredentialDto | yes |  |
| `billing` | PublicApiUsageBillingDto | yes |  |
| `includedQuota` | PublicApiUsageIncludedQuotaDto | yes | Deprecated compatibility block. Use credits.recurring and credits.totalRemaining instead. |
| `credits` | PublicApiUsageCreditsDto | yes |  |

**`PublicApiUsageWorkspaceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `slug` | string | yes |  |
| `name` | string | yes |  |

**`PublicApiUsageCredentialDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `accessLevel` | enum[full_access, delegated_user] | yes |  |
| `lastUsedAt` | string | yes |  |

**`PublicApiUsageBillingDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `configured` | boolean | yes | Whether the workspace currently has billing configuration for the public API. |
| `planCode` | string | yes | Current billing plan code when configured. |
| `currentPeriodStart` | string | yes |  |
| `currentPeriodEnd` | string | yes |  |
| `updatedAt` | string | yes |  |

**`PublicApiUsageIncludedQuotaDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `limit` | number | yes |  |
| `used` | number | yes |  |
| `remaining` | number | yes |  |

**`PublicApiUsageCreditsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `balance` | number | yes | Deprecated compatibility alias of credits.topup.balance. |
| `recurring` | PublicApiUsageIncludedQuotaDto | yes |  |
| `topup` | PublicApiUsageTopupDto | yes |  |
| `totalRemaining` | number | yes | Total remaining recurring + top-up credits. |

**`PublicApiUsageTopupDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `balance` | number | yes |  |


---

## Workspace

### `GET /v1/workspace/folders` — List workspace brandtracker folders

**Billing:** Free / no documented credit charge  
**Description:** Returns the active workspace brandtracker folders so clients can resolve folderIds for workspace and brandtracker filters. Folder names are returned as metadata; prefer folderIds for exact filtering. Equivalent folder listing is also available at GET /v1/brandtrackers/folders.

Response: `PublicApiGetWorkspaceFoldersResponseDto` — Workspace brandtracker folders. The response also includes the X-Request-Id header.
(schema documented above under `PublicApiGetWorkspaceFoldersResponseDto`)

### `GET /v1/workspace` — Inspect the authenticated workspace

**Billing:** Free / no documented credit charge  
**Description:** Returns the workspace bound to the provided public API key along with the effective authentication context.

Response: `PublicApiWorkspaceResponseDto` — Workspace snapshot for the authenticated public API credential. The response also includes the X-Request-Id header.

**`PublicApiWorkspaceResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `workspace` | PublicApiWorkspaceDto | yes |  |
| `authenticatedAs` | PublicApiWorkspaceAuthenticatedAsDto | yes |  |
| `credential` | PublicApiWorkspaceCredentialDto | yes |  |

**`PublicApiWorkspaceAuthenticatedAsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `accessLevel` | enum[full_access, delegated_user] | yes |  |
| `delegatedUserId` | string | yes | Delegated user identifier when authenticated with a delegated credential. |
| `delegatedUserRole` | enum[owner, admin, member, readonly] | yes | Workspace role of the delegated user when present. |

**`PublicApiWorkspaceCredentialDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes |  |
| `name` | string | yes |  |
| `description` | string | yes |  |
| `expiresAt` | string | yes |  |
| `createdAt` | string | yes |  |
| `lastUsedAt` | string | yes |  |

### `GET /v1/workspace/top-ads` — Get current ranked workspace top ads

**Billing:** Free / no documented credit charge  
**Description:** Canonical current-ranking endpoint across active workspace brandtrackers in a single metered request. Each returned row is explicitly nested as { brandtracker, ad, metrics }. Billing remains proportional to requested/returned row count (limit/result length), not brandtracker count. Use sortBy=currentRank for current Facebook page rank, sortBy=reach/reachDelta1d/reachDelta7d/reachDelta30d for reach rankings, and sortBy=rankDelta7d/rankDelta14d/rankDelta30d for rank movers. period and snapshotDate are deprecated compatibility parameters and are ignored on this current-ranking path.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `page` | query | integer |  | Pagination page number. Defaults to 1. |
| `limit` | query | integer |  | Maximum number of workspace top ads to return. Must be <= 100. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `sortBy` | query | enum[currentRank, rankDelta, rankDelta7d, rankDelta14d, rankDelta30d, reach, reachDelta1d, reachDelta7d, reachDelta30d, daysRunning, duplicates] |  | Sort key for canonical current rankings. Use currentRank for current Facebook page rank (returned as rank/currentRank); rankDelta7d, rankDelta14d, or rankDelta30d for movers; reach, reachDelta1d, reachDelta7d, or reachDelta30d for reach rankings. |
| `includeInactive` | query | boolean |  | When true, include inactive ads where supported. Defaults to false. |
| `period` | query | enum[today, yesterday, last1d, last7d, last14d, last30d, total] |  | Optional rolling workspace top-ads period. Allowed values: today, yesterday, last1d, last7d, last14d, last30d, total. |
| `snapshotDate` | query | string | enum[latest] |  | Deprecated compatibility parameter accepted but ignored by canonical workspace top-ads current ranking. Use freshness/system endpoints for snapshot availability checks. |

Response: `PublicApiGetWorkspaceTopAdsResponseDto` — Paginated workspace top ads response where each data row is { brandtracker, ad, metrics }. The response also includes the X-Request-Id header.

**`PublicApiGetWorkspaceTopAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes | Request identifier mirrored in the X-Request-Id response header. |
| `data` | array<PublicApiWorkspaceTopAdDto> | yes | Workspace top-ads rows. Every element uses the nested shape { brandtracker, ad, metrics }. |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |
| `meta` | PublicApiTopAdsMetaDto |  |  |

**`PublicApiWorkspaceTopAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtracker` | PublicApiWorkspaceTopAdsBrandtrackerDto | yes | Brandtracker context for this workspace top-ads row. Each row is nested as { brandtracker, ad, metrics }. |
| `ad` | PublicApiAdSummaryDto | yes | Ad summary payload for this workspace top-ads row. Each row is nested as { brandtracker, ad, metrics }. |
| `metrics` | PublicApiBrandtrackerTopAdMetricsDto | yes | Ranking/reach metrics for this workspace top-ads row. Each row is nested as { brandtracker, ad, metrics }. |

**`PublicApiWorkspaceTopAdsBrandtrackerDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | yes | Public brandtracker identifier backed by brandtracker.id. Legacy spyders.uuid values are accepted when migration metadata exists. |
| `name` | string | yes |  |
| `facebookPageId` | string | yes | Facebook page id associated with this workspace brandtracker. |

### `GET /v1/workspace/hooks` — Get workspace hooks

**Billing:** Metered (credits)  
**Description:** Returns hook analytics aggregated across active workspace brandtrackers in one metered request. One credit is charged per returned row.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `limit` | query | integer |  | Maximum number of workspace aggregate rows to return. Must be <= 100. |
| `brandtrackerIds` | query | array<string> |  | Optional comma-separated or repeated public brandtracker ids. |
| `folderIds` | query | array<integer> |  | Optional comma-separated or repeated workspace brandtracker folder ids. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  |  |
| `sortBy` | query | enum[usageCount, longestRunning, totalImpressions, firstUsedAt, lastUsedAt] |  |  |

Response: `PublicApiGetWorkspaceHooksResponseDto` — Paginated workspace hooks response. The response also includes the X-Request-Id header.

**`PublicApiGetWorkspaceHooksResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiWorkspaceHookDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiWorkspaceHookDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtracker` | PublicApiWorkspaceTopAdsBrandtrackerDto | yes |  |
| `hook` | PublicApiWorkspaceHookResourceDto | yes |  |
| `metrics` | PublicApiWorkspaceHookMetricsDto | yes |  |

**`PublicApiWorkspaceHookResourceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `text` | string | yes |  |
| `sampleAd` | PublicApiBrandtrackerHookSampleAdDto | yes |  |

**`PublicApiWorkspaceHookMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |
| `totalImpressions` | number | yes |  |
| `firstUsedAt` | string | yes |  |
| `lastUsedAt` | string | yes |  |

### `GET /v1/workspace/ad-copies` — Get workspace ad copies

**Billing:** Metered (credits)  
**Description:** Returns ad copy analytics aggregated across active workspace brandtrackers in one metered request. One credit is charged per returned row.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `limit` | query | integer |  | Maximum number of workspace aggregate rows to return. Must be <= 100. |
| `brandtrackerIds` | query | array<string> |  | Optional comma-separated or repeated public brandtracker ids. |
| `folderIds` | query | array<integer> |  | Optional comma-separated or repeated workspace brandtracker folder ids. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  |  |
| `sortBy` | query | enum[usageCount, longestRunning] |  |  |

Response: `PublicApiGetWorkspaceAdCopiesResponseDto` — Paginated workspace ad copies response. The response also includes the X-Request-Id header.

**`PublicApiGetWorkspaceAdCopiesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiWorkspaceAdCopyDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiWorkspaceAdCopyDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtracker` | PublicApiWorkspaceTopAdsBrandtrackerDto | yes |  |
| `adCopy` | PublicApiWorkspaceAdCopyResourceDto | yes |  |
| `metrics` | PublicApiWorkspaceAdCopyMetricsDto | yes |  |

**`PublicApiWorkspaceAdCopyResourceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `text` | string | yes |  |

**`PublicApiWorkspaceAdCopyMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |

### `GET /v1/workspace/landing-pages` — Get workspace landing pages

**Billing:** Metered (credits)  
**Description:** Returns landing page analytics aggregated across active workspace brandtrackers in one metered request. One credit is charged per returned row.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `limit` | query | integer |  | Maximum number of workspace aggregate rows to return. Must be <= 100. |
| `brandtrackerIds` | query | array<string> |  | Optional comma-separated or repeated public brandtracker ids. |
| `folderIds` | query | array<integer> |  | Optional comma-separated or repeated workspace brandtracker folder ids. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `order` | query | enum[asc, desc] |  |  |
| `sortBy` | query | enum[usageCount, longestRunning, totalImpressions] |  |  |

Response: `PublicApiGetWorkspaceLandingPagesResponseDto` — Paginated workspace landing pages response. The response also includes the X-Request-Id header.

**`PublicApiGetWorkspaceLandingPagesResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiWorkspaceLandingPageDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiWorkspaceLandingPageDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtracker` | PublicApiWorkspaceTopAdsBrandtrackerDto | yes |  |
| `landingPage` | PublicApiWorkspaceLandingPageResourceDto | yes |  |
| `metrics` | PublicApiWorkspaceLandingPageMetricsDto | yes |  |

**`PublicApiWorkspaceLandingPageResourceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `url` | string | yes |  |
| `technologies` | array<PublicApiBrandtrackerTechnologyDto> | yes |  |
| `screenshots` | PublicApiBrandtrackerLandingPageScreenshotsDto | yes |  |

**`PublicApiWorkspaceLandingPageMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `usageCount` | number | yes |  |
| `longestRunning` | number | yes |  |
| `totalImpressions` | number | yes |  |

### `GET /v1/workspace/scaling-ads` — Get workspace scaling ads compatibility data

**Billing:** Metered (credits)  
**Description:** Legacy compatibility endpoint for clients that still call /workspace/scaling-ads. Prefer /v1/workspace/top-ads?sortBy=rankDelta7d, rankDelta14d, or rankDelta30d for canonical rank movers and sortBy=currentRank for current ranking. Endpoint key, billing, and response envelope remain stable; period and snapshotDate are deprecated and ignored on the ES-backed path, and trajectory may be empty. One credit is charged per returned row.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `limit` | query | integer |  | Maximum number of workspace aggregate rows to return. Must be <= 100. |
| `brandtrackerIds` | query | array<string> |  | Optional comma-separated or repeated public brandtracker ids. |
| `folderIds` | query | array<integer> |  | Optional comma-separated or repeated workspace brandtracker folder ids. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `period` | query | enum[today, yesterday, last1d, last7d, last14d, last30d, total] |  | Optional rolling period for workspace scaling ads. Allowed values: today, yesterday, last1d, last7d, last14d, last30d, total. |
| `snapshotDate` | query | string | enum[latest] |  | Deprecated compatibility parameter accepted but ignored on the ES-backed workspace scaling compatibility path. Use freshness/system endpoints for snapshot availability checks. |
| `sortBy` | query | enum[rankDelta, currentRank, rank_delta, current_rank] |  |  |
| `maxCurrentRank` | query | integer |  |  |
| `minRankDelta` | query | integer |  |  |

Response: `PublicApiGetWorkspaceScalingAdsResponseDto` — Paginated workspace scaling ads response. The response also includes the X-Request-Id header.

**`PublicApiGetWorkspaceScalingAdsResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiWorkspaceScalingAdDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiWorkspaceScalingAdDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtracker` | PublicApiWorkspaceTopAdsBrandtrackerDto | yes |  |
| `ad` | PublicApiAdSummaryDto | yes |  |
| `metrics` | PublicApiBrandtrackerScalingAdMetricsDto | yes |  |
| `trajectory` | array<PublicApiBrandtrackerAdRankTrajectoryPointDto> | yes |  |

### `GET /v1/workspace/media-mix` — Get workspace media mix

**Billing:** Metered (credits)  
**Description:** Returns media mix rows across active workspace brandtrackers in one metered request. One credit is charged per returned row.

Request parameters:

| Name | In | Type | Req | Meaning |
|---|---|---|---|---|
| `page` | query | integer |  |  |
| `limit` | query | integer |  | Maximum number of workspace aggregate rows to return. Must be <= 100. |
| `brandtrackerIds` | query | array<string> |  | Optional comma-separated or repeated public brandtracker ids. |
| `folderIds` | query | array<integer> |  | Optional comma-separated or repeated workspace brandtracker folder ids. |
| `euOnly` | query | boolean |  | Optional EU-only filter. When true, only EU-classified Facebook ads are included. |
| `sortBy` | query | enum[activeAds, image, video, dco, other] |  |  |

Response: `PublicApiGetWorkspaceMediaMixResponseDto` — Paginated workspace media mix response. The response also includes the X-Request-Id header.

**`PublicApiGetWorkspaceMediaMixResponseDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `requestId` | string | yes |  |
| `data` | array<PublicApiWorkspaceMediaMixDto> | yes |  |
| `pagination` | PublicApiBrandtrackerInsightsPaginationDto | yes |  |

**`PublicApiWorkspaceMediaMixDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `brandtracker` | PublicApiWorkspaceTopAdsBrandtrackerDto | yes |  |
| `mediaMix` | PublicApiWorkspaceMediaMixResourceDto | yes |  |
| `metrics` | PublicApiWorkspaceMediaMixMetricsDto | yes |  |

**`PublicApiWorkspaceMediaMixResourceDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `formatCount` | PublicApiBrandtrackerMediaMixFormatCountDto | yes | Workspace media mix exposes image, video, dco, and other only. Carousel is not available as a separate bucket. |

**`PublicApiWorkspaceMediaMixMetricsDto`**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `activeAds` | number | yes |  |
