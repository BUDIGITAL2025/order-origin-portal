/**
 * Server functions for FlySales Ads. Thin wrappers: authenticate, resolve the
 * caller's role, enforce the ad-account wall, then delegate to ads.server —
 * the only module that talks to the provider.
 *
 * Nothing here fires on render except getMyAdsContext (no provider call).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function isAdmin(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return data === true;
}

const accountId = z.string().trim().min(1).max(64);
const days = z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(90)]);

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

/**
 * Free lookup, safe on render: which ad accounts are mapped to my
 * workspaces, plus the onboarding copy inputs when none are.
 */
export const getMyAdsContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const mod = await import("./ads.server");
    const [accounts, businessId] = await Promise.all([
      mod.listMyMappedAccounts(context.userId),
      mod.getBusinessManagerId(),
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: workspaces } = await supabaseAdmin
      .from("stores")
      .select("id, store_name, entities!inner(account_id)")
      .eq("entities.account_id", context.userId);
    const workspaceIds = (workspaces ?? []).map((w) => w.id);
    const { data: requests } = workspaceIds.length
      ? await supabaseAdmin
          .from("ads_activation_requests")
          .select("workspace_id, created_at, status")
          .in("workspace_id", workspaceIds)
          .order("created_at", { ascending: false })
      : { data: [] };

    return {
      accounts: accounts.map((a) => ({
        adAccountId: a.ad_account_id,
        platform: a.platform,
        label: a.label ?? a.workspace_name ?? a.ad_account_id,
        workspaceId: a.workspace_id,
      })),
      workspaces: (workspaces ?? []).map((w) => ({ id: w.id, name: w.store_name })),
      businessManagerId: businessId,
      pendingRequests: (requests ?? []).map((r) => ({
        workspaceId: r.workspace_id,
        createdAt: r.created_at,
        status: r.status,
      })),
    };
  });

/** "Notify us" from the onboarding state: records the ask and emails admin. */
export const requestAdsActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workspaceId: z.string().uuid(), note: z.string().trim().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Ownership: the workspace must belong to the caller (RLS-respecting read).
    const { data: workspace, error } = await context.supabase
      .from("stores")
      .select("id, store_name")
      .eq("id", data.workspaceId)
      .maybeSingle();
    if (error || !workspace) throw new Error("Workspace not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("ads_activation_requests")
      .select("id")
      .eq("workspace_id", data.workspaceId)
      .eq("status", "open")
      .maybeSingle();
    if (existing) return { ok: true, alreadyRequested: true };

    await supabaseAdmin.from("ads_activation_requests").insert({
      workspace_id: data.workspaceId,
      requested_by: context.userId,
      note: data.note ?? null,
    });

    const { adsActivationRequestedEmail } = await import("./email-templates.server");
    const { sendAdminEmail } = await import("./email.server");
    const email = adsActivationRequestedEmail({
      workspaceName: workspace.store_name ?? "Unnamed workspace",
      workspaceId: workspace.id,
      note: data.note ?? null,
    });
    await sendAdminEmail({ subject: email.subject, text: email.text });

    return { ok: true, alreadyRequested: false };
  });

/** KPI cards + charts for one account and one range. Explicit action only. */
export const getAdsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId, days, refresh: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const mod = await import("./ads.server");
    const admin = await isAdmin(context.supabase, context.userId);
    const { workspaceId } = await mod.assertAccountAllowed({
      userId: context.userId,
      isAdmin: admin,
      accountId: data.accountId,
      platform: "meta",
    });
    return mod.fetchOverview({
      userId: context.userId,
      workspaceId,
      accountId: data.accountId,
      days: data.days,
      ...(data.refresh ? { refresh: true } : {}),
    });
  });

/** Campaigns, ad sets or ads with their performance for the same range. */
export const getAdsLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        accountId,
        days,
        level: z.enum(["campaign", "adset", "ad"]),
        parentId: z.string().trim().max(64).optional(),
        refresh: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const mod = await import("./ads.server");
    const admin = await isAdmin(context.supabase, context.userId);
    const { workspaceId } = await mod.assertAccountAllowed({
      userId: context.userId,
      isAdmin: admin,
      accountId: data.accountId,
      platform: "meta",
    });
    return mod.fetchLevel({
      userId: context.userId,
      workspaceId,
      accountId: data.accountId,
      days: data.days,
      level: data.level,
      parentId: data.parentId ?? null,
      ...(data.refresh ? { refresh: true } : {}),
    });
  });

/** Creative behind one ad row. */
export const getAdCreative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId, adId: z.string().trim().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const mod = await import("./ads.server");
    const admin = await isAdmin(context.supabase, context.userId);
    const { workspaceId } = await mod.assertAccountAllowed({
      userId: context.userId,
      isAdmin: admin,
      accountId: data.accountId,
      platform: "meta",
    });
    const creative = await mod.fetchCreative({
      userId: context.userId,
      workspaceId,
      accountId: data.accountId,
      adId: data.adId,
    });
    const { raw: _raw, ...safe } = creative;
    return safe;
  });

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

/** Ad accounts visible in OUR provider connection. One metered call, 24h cache. */
export const adminListProviderAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ refresh: z.boolean().default(false) }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./ads.server");
    const call = await mod.callAdsToolWithStale({
      userId: context.userId,
      workspaceId: null,
      tool: "get_ad_accounts",
      args: { user_id: "me", limit: 200 },
      ttlMs: mod.STRUCTURE_TTL_MS,
      ...(data.refresh ? { refresh: true } : {}),
    });
    const rows = mod.adsRowsArray(call.data).map((row) => {
      const id =
        (typeof row["id"] === "string" && row["id"]) ||
        (typeof row["account_id"] === "string" && row["account_id"]) ||
        "";
      return {
        id,
        name: typeof row["name"] === "string" ? row["name"] : id,
        status: typeof row["account_status"] === "number" ? String(row["account_status"]) : null,
        currency: typeof row["currency"] === "string" ? row["currency"] : null,
      };
    });
    return { accounts: rows, cached: call.cached, stale: call.stale, fetchedAt: call.fetchedAt };
  });

/** Every workspace↔account mapping, with workspace names. */
export const adminListMappings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./ads.server");
    const [mappings, businessId] = await Promise.all([
      mod.listAllMappedAccounts(),
      mod.getBusinessManagerId(),
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: workspaces }, { data: requests }] = await Promise.all([
      supabaseAdmin
        .from("stores")
        .select("id, store_name, entities(legal_name)")
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("ads_activation_requests")
        .select("id, workspace_id, status, note, created_at, stores(store_name)")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    return {
      mappings,
      businessManagerId: businessId,
      workspaces: (workspaces ?? []).map((w) => {
        const entity = w.entities as { legal_name: string } | null;
        return {
          id: w.id,
          name: w.store_name ?? "Unnamed workspace",
          entity: entity?.legal_name ?? null,
        };
      }),
      openRequests: (requests ?? []).map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        workspaceName: (r.stores as { store_name: string | null } | null)?.store_name ?? null,
        note: r.note,
        createdAt: r.created_at,
      })),
    };
  });

/** Assign (or re-assign) one ad account to a workspace. */
export const adminSaveMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        adAccountId: accountId,
        label: z.string().trim().max(120).optional(),
        active: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("workspace_ad_accounts").upsert(
      {
        workspace_id: data.workspaceId,
        ad_account_id: data.adAccountId,
        platform: "meta",
        label: data.label ?? null,
        active: data.active,
        created_by: context.userId,
      },
      { onConflict: "platform,ad_account_id" },
    );
    if (error) throw new Error(error.message);
    // Any open activation request for this workspace is now satisfied.
    await supabaseAdmin
      .from("ads_activation_requests")
      .update({ status: "done" })
      .eq("workspace_id", data.workspaceId)
      .eq("status", "open");
    return { ok: true };
  });

/** Unassign a mapping entirely. */
export const adminRemoveMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("workspace_ad_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Our Business Manager ID, shown in the client onboarding card. */
export const adminSetBusinessManagerId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ businessManagerId: z.string().trim().min(3).max(64) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const mod = await import("./ads.server");
    await mod.setBusinessManagerId(data.businessManagerId);
    return { ok: true };
  });

/** Usage view: per-workspace and per-tool counts with cache-hit rate. */
export const adminAdsUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("ads_api_calls")
      .select("id, workspace_id, tool, ad_account_id, ok, cached, rows_returned, duration_ms, error, created_at, stores(store_name)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const calls = (data ?? []).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: (row.stores as { store_name: string | null } | null)?.store_name ?? null,
      tool: row.tool,
      adAccountId: row.ad_account_id,
      ok: row.ok,
      cached: row.cached,
      rows: row.rows_returned,
      durationMs: row.duration_ms,
      error: row.error,
      createdAt: row.created_at,
    }));

    const byTool = new Map<string, { tool: string; calls: number; cached: number; failed: number }>();
    const byWorkspace = new Map<string, { workspace: string; calls: number; cached: number; failed: number }>();
    for (const c of calls) {
      const t = byTool.get(c.tool) ?? { tool: c.tool, calls: 0, cached: 0, failed: 0 };
      t.calls += 1;
      if (c.cached) t.cached += 1;
      if (!c.ok) t.failed += 1;
      byTool.set(c.tool, t);

      const key = c.workspaceName ?? c.workspaceId ?? "Admin / unmapped";
      const w = byWorkspace.get(key) ?? { workspace: key, calls: 0, cached: 0, failed: 0 };
      w.calls += 1;
      if (c.cached) w.cached += 1;
      if (!c.ok) w.failed += 1;
      byWorkspace.set(key, w);
    }

    return {
      calls: calls.slice(0, 100),
      byTool: [...byTool.values()].sort((a, b) => b.calls - a.calls),
      byWorkspace: [...byWorkspace.values()].sort((a, b) => b.calls - a.calls),
      total: calls.length,
      cacheHitRate: calls.length ? calls.filter((c) => c.cached).length / calls.length : 0,
      failures: calls.filter((c) => !c.ok).length,
    };
  });
