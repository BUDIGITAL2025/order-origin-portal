/**
 * FX server functions — staff and sourcing only. Clients never see anything
 * but USD, so there is no client-facing endpoint here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Today's USD → EUR / CNY rates, fetched once a day and cached. */
export const getTodayFxRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdminOrSourcing, getAdminClient } = await import("./admin.server");
    await requireAdminOrSourcing(context.supabase, context.userId);
    const { ensureDailyRates } = await import("./fx.server");
    return ensureDailyRates(await getAdminClient());
  });

/** Admin: override a day's rate by hand (audited through fx_fetch_log). */
export const adminSetFxRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        rate_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
        eur: z.number().positive().max(1000),
        cny: z.number().positive().max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin.from("fx_rates").upsert(
      {
        rate_date: data.rate_date,
        base: "USD",
        eur: data.eur,
        cny: data.cny,
        source: "manual override",
        manual: true,
        set_by: context.userId,
      },
      { onConflict: "rate_date" },
    );
    if (error) throw new Error(error.message);
    await admin.from("fx_fetch_log").insert({
      rate_date: data.rate_date,
      source: "manual override",
      status: "ok",
      payload: { eur: data.eur, cny: data.cny, set_by: context.userId } as never,
    });
    return { ok: true };
  });

/** Admin: recent rate days plus the fetch history behind them. */
export const listFxHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaffRead, getAdminClient } = await import("./admin.server");
    await requireStaffRead(context.supabase, context.userId);
    const admin = await getAdminClient();
    const [rates, log] = await Promise.all([
      admin
        .from("fx_rates")
        .select("rate_date, eur, cny, source, manual, created_at")
        .order("rate_date", { ascending: false })
        .limit(30),
      admin
        .from("fx_fetch_log")
        .select("id, rate_date, source, status, error, duration_ms, created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    return { rates: rates.data ?? [], log: log.data ?? [] };
  });
