/**
 * Sidebar notification bells — generic, driven by NOTIFICATION_NAV_MAP.
 *
 * Reading: one query returns the DISTINCT kinds with at least one unread row
 * for the caller. Admin notifications are the rows scoped to nobody
 * (store_id and entity_id both null); client notifications are whatever RLS
 * lets the caller see.
 *
 * Writing: opening a page marks read the kinds mapped to that page, so the
 * bell clears once seen.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { kindsForNav, NOTIFICATION_NAV_MAP } from "./notifications-nav-map";

const audienceSchema = z.object({ audience: z.enum(["admin", "client"]) });
const markSchema = z.object({
  audience: z.enum(["admin", "client"]),
  to: z.string().min(1),
});

const ALL_KINDS = Object.keys(NOTIFICATION_NAV_MAP);

/** Kinds with at least one unread notification for this caller. */
export const listUnreadNavKinds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => audienceSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ kinds: string[] }> => {
    if (data.audience === "admin") {
      const { getStaffLevel, getAdminClient } = await import("./admin.server");
      const level = await getStaffLevel(context.supabase, context.userId);
      if (!level) return { kinds: [] };
      const admin = await getAdminClient();
      const { data: rows } = await admin
        .from("notifications")
        .select("kind")
        .is("read_at", null)
        .is("store_id", null)
        .is("entity_id", null)
        .in("kind", ALL_KINDS)
        .limit(500);
      return { kinds: [...new Set((rows ?? []).map((r) => r.kind))] };
    }
    // Client: RLS already scopes rows to the caller's stores and entities.
    const { data: rows } = await context.supabase
      .from("notifications")
      .select("kind")
      .is("read_at", null)
      .in("kind", ALL_KINDS)
      .limit(500);
    return { kinds: [...new Set((rows ?? []).map((r) => r.kind))] };
  });

/** Opening a page clears the bells whose kinds belong to that page. */
export const markNavKindsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => markSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const kinds = kindsForNav(data.audience, data.to);
    if (kinds.length === 0) return { ok: true };
    const now = new Date().toISOString();

    if (data.audience === "admin") {
      const { getStaffLevel, getAdminClient } = await import("./admin.server");
      const level = await getStaffLevel(context.supabase, context.userId);
      // Readers see the console; clearing a bell is not a business mutation.
      if (!level) return { ok: true };
      const admin = await getAdminClient();
      await admin
        .from("notifications")
        .update({ read_at: now })
        .is("read_at", null)
        .is("store_id", null)
        .is("entity_id", null)
        .in("kind", kinds);
      return { ok: true };
    }

    await context.supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null)
      .in("kind", kinds);
    return { ok: true };
  });
