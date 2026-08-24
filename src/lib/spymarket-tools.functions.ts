/**
 * Admin-only server functions for the SpyMarket research tool (Trendtrack).
 * Thin wrappers: every handler verifies the admin role, then delegates to
 * spymarket-tools.server.ts — the only module that talks to Trendtrack.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getSpyMarketToolsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.getToolsStatus(context.userId);
  });

/** Free: resolve a brand / domain / handle into internal ids. */
export const spymarketLookup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ q: z.string().trim().min(2).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "lookup",
      path: "/lookup",
      query: { q: data.q, type: "auto", limit: 10 },
      summary: { q: data.q },
      estimatedCost: 0,
      metered: false,
      cacheable: true,
      // Their fuzzy lookup either answers fast or hangs — nothing useful ever
      // arrives after ~12s, so fail fast and let the UI offer a fallback.
      timeoutMs: 12_000,
    });
  });

/** Free: category facets for the explorer filter. */
export const spymarketCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ search: z.string().trim().max(100).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "facets/categories",
      path: "/facets/categories",
      query: { limit: 100, search: data.search || undefined },
      summary: { search: data.search ?? null },
      estimatedCost: 0,
      metered: false,
      cacheable: true,
    });
  });

/** Metered: 1 credit per returned shop row. */
export const spymarketQueryShops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().trim().max(200).optional(),
        searchType: z.enum(["domain", "productName", "shopContains"]).optional(),
        minMonthlyVisits: z.number().int().min(0).optional(),
        maxMonthlyVisits: z.number().int().min(0).optional(),
        minActiveAds: z.number().int().min(0).optional(),
        maxActiveAds: z.number().int().min(0).optional(),
        adsTimePeriod: z.enum(["last24h", "last7d", "last30d"]).optional(),
        minProductsCount: z.number().int().min(0).optional(),
        maxProductsCount: z.number().int().min(0).optional(),
        isShopifyPlus: z.boolean().optional(),
        dtcOnly: z.boolean().optional(),
        categoryId: z.number().int().optional(),
        country: z.string().length(2).optional(),
        countries: z.array(z.string().length(2)).max(20).optional(),
        language: z.string().max(10).optional(),
        minTrustpilotRating: z.number().min(0).max(5).optional(),
        sortBy: z
          .enum(["relevance", "monthlyVisits", "activeAds", "productsCount", "createdAt"])
          .default("monthlyVisits"),
        order: z.enum(["desc", "asc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(32),
        offset: z.number().int().min(0).default(0),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    // "domain" is EXACT domain/related-domain matching upstream: a bare brand
    // name like "gruns" produces no domain match and the term is dropped,
    // leaving an unfiltered top-traffic list. Anything that isn't a hostname
    // is therefore searched as free text instead.
    const term = data.search?.trim() ?? "";
    const looksLikeDomain = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(term);
    const requestedType = data.searchType ?? "domain";
    const effectiveSearchType =
      requestedType === "domain" && term && !looksLikeDomain ? "shopContains" : requestedType;
    const effectiveSortBy = data.sortBy;

    const body: Record<string, unknown> = {
      sortBy: effectiveSortBy,
      order: data.order,
      limit: data.limit,
      offset: data.offset,
    };
    if (term) {
      // Their spec types `search` on /shops/query as a STRING (unlike
      // /ads/query and /emails/query, which take arrays). Sending an array
      // made the term be dropped upstream, returning an unfiltered
      // top-traffic list.
      body["search"] = term;
      body["searchType"] = effectiveSearchType;
    }
    if (data.minMonthlyVisits != null) body["minMonthlyVisits"] = data.minMonthlyVisits;
    if (data.maxMonthlyVisits != null) body["maxMonthlyVisits"] = data.maxMonthlyVisits;
    if (data.minActiveAds != null || data.maxActiveAds != null) {
      if (data.minActiveAds != null) body["minActiveAds"] = data.minActiveAds;
      if (data.maxActiveAds != null) body["maxActiveAds"] = data.maxActiveAds;
      body["adsTimePeriod"] = data.adsTimePeriod ?? "last30d";
    }
    // DTC-only: upstream preset (dtcRegion="all" = "any indexed DTC shop" per
    // the API spec). Only an EXACT domain lookup bypasses it — a text search
    // must stay filtered, otherwise the toggle silently does nothing.
    const isDomainLookup = Boolean(term) && effectiveSearchType === "domain" && looksLikeDomain;
    if (data.dtcOnly && !isDomainLookup) {
      body["dtcRegion"] = "all";
      body["minProductsCount"] = Math.max(1, data.minProductsCount ?? 0);
    } else if (data.minProductsCount != null) {
      body["minProductsCount"] = data.minProductsCount;
    }

    if (data.maxProductsCount != null) body["maxProductsCount"] = data.maxProductsCount;
    if (data.isShopifyPlus != null) body["isShopifyPlus"] = data.isShopifyPlus;
    if (data.categoryId != null) body["categoryIds"] = [data.categoryId];
    // Multi-country include; legacy single `country` still accepted.
    const includeCountries = data.countries?.length
      ? data.countries
      : data.country
        ? [data.country]
        : null;
    if (includeCountries) body["creationCountries"] = includeCountries;
    if (data.language) body["languages"] = [data.language];
    if (data.minTrustpilotRating != null) body["minTrustpilotRating"] = data.minTrustpilotRating;
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "shops/query",
      path: "/shops/query",
      method: "POST",
      body,
      summary: {
        search: term || null,
        searchType: term ? effectiveSearchType : null,
        filters: {
          minMonthlyVisits: data.minMonthlyVisits ?? null,
          maxMonthlyVisits: data.maxMonthlyVisits ?? null,
          minActiveAds: data.minActiveAds ?? null,
          maxActiveAds: data.maxActiveAds ?? null,
          isShopifyPlus: data.isShopifyPlus ?? null,
          dtcOnly: data.dtcOnly ?? null,
          dtcApplied: Boolean(data.dtcOnly && !isDomainLookup),
          categoryId: data.categoryId ?? null,
          countries: includeCountries,
          language: data.language ?? null,
          minTrustpilotRating: data.minTrustpilotRating ?? null,
          sortBy: effectiveSortBy,
          order: data.order,
        },

        limit: data.limit,
        offset: data.offset,
      },
      estimatedCost: data.limit,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered: full shop profile (1 credit). */
export const spymarketGetShop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ shopId: z.string().min(1), confirmOverage: z.boolean().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "shops/detail",
      path: `/shops/${encodeURIComponent(data.shopId)}`,
      summary: { shopId: data.shopId },
      estimatedCost: 1,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered on-demand shop tabs: products / advertisers / tiktok / similar / socials / emails. */
export const spymarketGetShopTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        shopId: z.string().min(1),
        tab: z.enum(["products", "advertisers", "tiktok", "similar", "socials", "emails"]),
        limit: z.number().int().min(1).max(100).default(20),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    const shop = encodeURIComponent(data.shopId);
    const paths: Record<string, { path: string; query?: Record<string, string | number> }> = {
      products: { path: `/shops/${shop}/products`, query: { sortBy: "popularity", limit: data.limit } },
      advertisers: { path: `/shops/${shop}/advertisers` },
      tiktok: { path: `/shops/${shop}/tiktok/library`, query: { limit: data.limit } },
      similar: { path: `/shops/${shop}/similar`, query: { limit: data.limit } },
      socials: { path: `/shops/${shop}/socials/history`, query: { period: "week", days: 180 } },
      emails: { path: `/shops/${shop}/emails`, query: { sortBy: "newest", limit: data.limit } },
    };
    const target = paths[data.tab]!;
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: `shops/${data.tab}`,
      path: target.path,
      query: target.query,
      summary: { shopId: data.shopId, tab: data.tab, limit: data.limit },
      estimatedCost: data.tab === "advertisers" || data.tab === "socials" ? 1 : data.limit,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered: full ad detail (1 credit-class call). */
export const spymarketGetAd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ adId: z.string().min(1), confirmOverage: z.boolean().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "ads/detail",
      path: `/ads/${encodeURIComponent(data.adId)}`,
      summary: { adId: data.adId },
      estimatedCost: 1,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered: ad reach time series for the sparkline. */
export const spymarketGetAdReachHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ adId: z.string().min(1), confirmOverage: z.boolean().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "ads/reach-history",
      path: `/ads/${encodeURIComponent(data.adId)}/reach-history`,
      summary: { adId: data.adId },
      estimatedCost: 30,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered: fresh playable media URL for an ad (video). */
export const spymarketGetAdMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ adId: z.string().min(1), confirmOverage: z.boolean().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "ads/media-url",
      path: `/ads/${encodeURIComponent(data.adId)}/media-url`,
      summary: { adId: data.adId },
      estimatedCost: 1,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered: email search across brands (flows + campaigns). */
export const spymarketQueryEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().trim().max(200).optional(),
        searchType: z.enum(["domain", "email", "shopKeywords"]).default("domain"),
        keywordMode: z.enum(["any", "all"]).default("any"),
        sortBy: z
          .enum(["newest", "oldest", "relevance", "monthlyVisits", "bodyLength"])
          .default("newest"),
        campaignType: z.string().trim().max(60).optional(),
        limit: z.number().int().min(1).max(100).default(24),
        page: z.number().int().min(1).default(1),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    const body: Record<string, unknown> = {
      searchType: data.searchType,
      keywordMode: data.keywordMode,
      sortBy: data.sortBy,
      order: "desc",
      page: data.page,
      limit: data.limit,
    };
    if (data.search) body["search"] = [data.search];
    if (data.campaignType) body["campaignTypes"] = [data.campaignType];
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "emails/query",
      path: "/emails/query",
      method: "POST",
      body,
      summary: {
        search: data.search ?? null,
        searchType: data.searchType,
        sortBy: data.sortBy,
        campaignType: data.campaignType ?? null,
        limit: data.limit,
        page: data.page,
      },
      estimatedCost: data.limit,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered: full email detail (subject, body, screenshot, shop identity). */
export const spymarketGetEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        emailId: z.union([z.string().min(1), z.number().int()]),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "emails/detail",
      path: `/emails/${encodeURIComponent(String(data.emailId))}`,
      summary: { emailId: data.emailId },
      estimatedCost: 1,
      confirmOverage: data.confirmOverage,
    });
  });

/** Metered: ad library. GET /ads needs a search term; otherwise POST /ads/query. */
export const spymarketSearchAds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().trim().max(200).optional(),
        searchType: z.enum(["adCopy", "brand"]).default("adCopy"),
        status: z.enum(["active", "inactive", "all"]).default("active"),
        mediaType: z.enum(["image", "video", "carousel"]).optional(),
        sortBy: z
          .enum(["relevance", "newest", "longestRunning", "reach", "reachDelta7d", "reachDelta30d"])
          .default("longestRunning"),
        limit: z.number().int().min(1).max(100).default(24),
        page: z.number().int().min(1).default(1),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    const summary = {
      search: data.search ?? null,
      searchType: data.searchType,
      status: data.status,
      mediaType: data.mediaType ?? null,
      sortBy: data.sortBy,
      limit: data.limit,
      page: data.page,
    };
    if (data.search) {
      // GET /v1/ads — the lightweight listing; search is required there.
      return mod.trendtrackCall({
        userId: context.userId,
        endpoint: "ads",
        path: "/ads",
        query: {
          search: data.search,
          searchType: data.searchType,
          status: data.status,
          mediaType: data.mediaType,
          sortBy: data.sortBy,
          limit: data.limit,
          page: data.page,
        },
        summary,
        estimatedCost: data.limit,
        confirmOverage: data.confirmOverage,
      });
    }
    // POST /v1/ads/query — advanced listing without a required text search.
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "ads/query",
      path: "/ads/query",
      method: "POST",
      body: {
        status: data.status,
        mediaType: data.mediaType,
        sortBy: data.sortBy,
        order: "desc",
        limit: data.limit,
        page: data.page,
      },
      summary,
      estimatedCost: data.limit,
      confirmOverage: data.confirmOverage,
    });
  });

/** Free: our own usage dashboard (reads our log, not their API). */
export const spymarketGetUsageDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    return mod.getUsageDashboard(context.userId);
  });
