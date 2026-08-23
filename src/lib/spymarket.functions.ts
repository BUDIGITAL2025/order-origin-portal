import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SpyMarket interest capture. SpyMarket is a shell — no research tool, no
 * credits ledger, no external API. This module only records which plan an
 * account is interested in (one row per account; re-picking updates it).
 */

const planSchema = z.object({ plan: z.enum(["starter", "plus", "max"]) });

/** Client: my current SpyMarket waitlist registration, if any. */
export const getMySpyMarketInterest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("spymarket_interest")
      .select("id, plan_interest, created_at")
      .eq("account_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

/**
 * Client: register (or change) plan interest. One registration per account —
 * upsert on the UNIQUE(account_id) constraint, so picking a different plan
 * updates plan_interest in place. entity_id stamps the account's first
 * entity when one exists; the row stays valid without one (storeless).
 */
export const registerSpyMarketInterest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => planSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: entity } = await context.supabase
      .from("entities")
      .select("id")
      .eq("account_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: row, error } = await context.supabase
      .from("spymarket_interest")
      .upsert(
        {
          account_id: context.userId,
          entity_id: entity?.id ?? null,
          plan_interest: data.plan,
        },
        { onConflict: "account_id" },
      )
      .select("id, plan_interest, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Admin: the full waitlist with a count per plan — negotiation material. */
export const adminListSpyMarketInterest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("spymarket_interest")
      .select(
        "id, plan_interest, created_at, profiles(contact_name), entities(legal_name)",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const entries = (data ?? []).map((row) => ({
      id: row.id,
      plan_interest: row.plan_interest,
      created_at: row.created_at,
      contact_name:
        (row.profiles as { contact_name?: string } | null)?.contact_name ?? "—",
      entity_name:
        (row.entities as { legal_name?: string } | null)?.legal_name ?? null,
    }));
    const counts = { starter: 0, plus: 0, max: 0 };
    for (const e of entries) counts[e.plan_interest as keyof typeof counts] += 1;
    return { entries, counts, total: entries.length };
  });
