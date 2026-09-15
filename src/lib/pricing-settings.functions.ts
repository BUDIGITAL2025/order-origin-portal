import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Fallback when the platform setting has never been written. */
export const FALLBACK_DEFAULT_MARGIN_PCT = 10;

/** Any staff member: the margin new quote variants are prefilled with. */
export const getDefaultMarginPct = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaffRead, getAdminClient } = await import("./admin.server");
    await requireStaffRead(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data } = await admin
      .from("internal_settings")
      .select("value")
      .eq("key", "default_margin_pct")
      .maybeSingle();
    const parsed = Number(data?.value);
    return {
      margin_pct:
        Number.isFinite(parsed) && parsed >= 0 ? parsed : FALLBACK_DEFAULT_MARGIN_PCT,
    };
  });

/** Owners only: change the platform default margin. Audited. */
export const setDefaultMarginPct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ margin_pct: z.number().min(0).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireOwner, getAdminClient } = await import("./admin.server");
    await requireOwner(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { writeAuditLine } = await import("./cleanup.server");

    const value = String(Math.round(data.margin_pct * 100) / 100);
    const { error } = await admin
      .from("internal_settings")
      .upsert({ key: "default_margin_pct", value }, { onConflict: "key" });
    if (error) throw new Error(error.message);

    await writeAuditLine(admin, {
      actorId: context.userId,
      action: "pricing_default_margin_changed",
      entityType: "internal_settings",
      entityId: null,
      summary: `Default FlySales margin set to ${value}%`,
      detail: { margin_pct: value },
    });
    return { ok: true, margin_pct: Number(value) };
  });
