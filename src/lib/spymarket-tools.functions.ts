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
      cacheable: false,
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
        adsTimePeriod: z.enum(["last24h", "last7d", "last30d"]).optional(),
        minProductsCount: z.number().int().min(0).optional(),
        maxProductsCount: z.number().int().min(0).optional(),
        isShopifyPlus: z.boolean().optional(),
        categoryId: z.number().int().optional(),
        country: z.string().length(2).optional(),
        language: z.string().max(10).optional(),
        minTrustpilotRating: z.number().min(0).max(5).optional(),
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
    const body: Record<string, unknown> = {
      sortBy: "monthlyVisits",
      order: "desc",
      limit: data.limit,
      offset: data.offset,
    };
    if (data.search) {
      body["search"] = [data.search];
      body["searchType"] = data.searchType ?? "domain";
    }
    if (data.minMonthlyVisits != null) body["minMonthlyVisits"] = data.minMonthlyVisits;
    if (data.maxMonthlyVisits != null) body["maxMonthlyVisits"] = data.maxMonthlyVisits;
    if (data.minActiveAds != null) {
      body["minActiveAds"] = data.minActiveAds;
      body["adsTimePeriod"] = data.adsTimePeriod ?? "last30d";
    }
    if (data.minProductsCount != null) body["minProductsCount"] = data.minProductsCount;
    if (data.maxProductsCount != null) body["maxProductsCount"] = data.maxProductsCount;
    if (data.isShopifyPlus != null) body["isShopifyPlus"] = data.isShopifyPlus;
    if (data.categoryId != null) body["categoryIds"] = [data.categoryId];
    if (data.country) body["creationCountries"] = [data.country];
    if (data.language) body["languages"] = [data.language];
    if (data.minTrustpilotRating != null) body["minTrustpilotRating"] = data.minTrustpilotRating;
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: "shops/query",
      path: "/shops/query",
      method: "POST",
      body,
      summary: {
        search: data.search ?? null,
        filters: {
          minMonthlyVisits: data.minMonthlyVisits ?? null,
          maxMonthlyVisits: data.maxMonthlyVisits ?? null,
          minActiveAds: data.minActiveAds ?? null,
          isShopifyPlus: data.isShopifyPlus ?? null,
          categoryId: data.categoryId ?? null,
          country: data.country ?? null,
          language: data.language ?? null,
          minTrustpilotRating: data.minTrustpilotRating ?? null,
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

/** Metered on-demand shop tabs: products / advertisers / tiktok library. */
export const spymarketGetShopTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        shopId: z.string().min(1),
        tab: z.enum(["products", "advertisers", "tiktok", "similar"]),
        limit: z.number().int().min(1).max(100).default(20),
        confirmOverage: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./spymarket-tools.server");
    const paths: Record<string, { path: string; query?: Record<string, string | number> }> = {
      products: {
        path: `/shops/${encodeURIComponent(data.shopId)}/products`,
        query: { sortBy: "popularity", limit: data.limit },
      },
      advertisers: { path: `/shops/${encodeURIComponent(data.shopId)}/advertisers` },
      tiktok: {
        path: `/shops/${encodeURIComponent(data.shopId)}/tiktok/library`,
        query: { limit: data.limit },
      },
      similar: {
        path: `/shops/${encodeURIComponent(data.shopId)}/similar`,
        query: { limit: data.limit },
      },
    };
    const target = paths[data.tab]!;
    return mod.trendtrackCall({
      userId: context.userId,
      endpoint: `shops/${data.tab}`,
      path: target.path,
      query: target.query,
      summary: { shopId: data.shopId, tab: data.tab, limit: data.limit },
      estimatedCost: data.tab === "advertisers" ? 1 : data.limit,
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
