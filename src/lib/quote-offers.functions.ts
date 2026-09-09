import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acceptOptionSchema, quoteOptionSchema } from "./schemas";
import type { ClientOffer, ClientOfferLine } from "./quote-offers.server";

const quoteIdSchema = z.object({ quote_id: z.string().uuid() });

/**
 * Client: the published offers on one of my quotes, as anonymous options.
 * Ownership is checked in Postgres before anything is read with elevated
 * rights, and only client-safe columns leave the server.
 */
export const listQuoteOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const owns = await context.supabase.rpc("owns_quote", { p_quote: data.quote_id });
    if (owns.data !== true) throw new Error("Quote request not found");

    const { getAdminClient } = await import("./admin.server");
    const { supplierDisputeRate } = await import("./quote-offers.server");
    const admin = await getAdminClient();

    const { data: options, error } = await admin
      .from("quote_options")
      .select(
        "id, letter, quality, recommended, moq, production_lead_days, shipping_lead_days, accepted_at, supplier_id",
      )
      .eq("quote_request_id", data.quote_id)
      .eq("published", true)
      .is("archived_at", null)
      .order("letter", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: lines } = await admin
      .from("quote_lines")
      .select("option_id, variant_label, country_code, unit_price, moq, lead_time_days, status")
      .eq("quote_request_id", data.quote_id);

    const offers: ClientOffer[] = [];
    for (const o of options ?? []) {
      const own = (lines ?? []).filter((l) => l.option_id === o.id);
      offers.push({
        id: o.id,
        letter: o.letter,
        quality: o.quality,
        recommended: o.recommended,
        moq: o.moq,
        production_lead_days: o.production_lead_days == null ? null : Number(o.production_lead_days),
        shipping_lead_days: o.shipping_lead_days == null ? null : Number(o.shipping_lead_days),
        accepted_at: o.accepted_at,
        dispute_rate: await supplierDisputeRate(admin, o.supplier_id),
        lines: own.map(
          (l): ClientOfferLine => ({
            variant_label: l.variant_label,
            country_code: l.country_code,
            unit_price: l.unit_price == null ? null : Number(l.unit_price),
            moq: l.moq,
            lead_time_days: l.lead_time_days,
            status: l.status,
          }),
        ),
      });
    }

    // Every variant quoted anywhere on this request — an option that does not
    // cover one must show that absence, never hide it.
    const allVariants = [...new Set((lines ?? []).map((l) => l.variant_label))];
    return { offers, all_variants: allVariants };
  });

/** Client: accept one option. Its lines become catalogue products; the rest archive. */
export const acceptQuoteOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => acceptOptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: accepted, error } = await context.supabase.rpc("accept_quote_option", {
      p_option_id: data.option_id,
      p_product_name: data.product_name,
    });
    if (error) {
      if (error.message.includes("QUOTE_EXPIRED")) {
        throw new Error("This quote has expired. Ask for a requote.");
      }
      if (error.message.includes("OPTION_NOT_AVAILABLE")) {
        throw new Error("That offer is no longer available.");
      }
      throw new Error(error.message);
    }
    return { ok: true, accepted: accepted ?? 0 };
  });

/** Admin: every option on a quote, with the full internal chain. */
export const adminListQuoteOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data: options, error } = await admin
      .from("quote_options")
      .select("*, suppliers(name)")
      .eq("quote_request_id", data.quote_id)
      .order("letter", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      options: (options ?? []).map((o) => ({
        ...o,
        supplier_name: (o.suppliers as { name: string } | null)?.name ?? "",
      })),
    };
  });

/** Admin: create or update one option (supplier, quality, leads, margin, publish). */
export const adminSaveQuoteOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteOptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { upsertSupplierByName } = await import("./sourcing.server");
    const { nextOptionLetter } = await import("./quote-offers.server");
    const { postSystemEvent } = await import("./quote-thread.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const supplierName = (data.supplier_name ?? "").trim();
    const supplier = supplierName ? await upsertSupplierByName(admin, supplierName) : null;

    const payload = {
      ...(supplier ? { supplier_id: supplier.id } : {}),
      ...(data.quality != null ? { quality: data.quality } : {}),
      ...(data.recommended != null ? { recommended: data.recommended } : {}),
      ...(data.published != null ? { published: data.published } : {}),
      ...(data.moq !== undefined ? { moq: data.moq } : {}),
      ...(data.production_lead_days !== undefined
        ? { production_lead_days: data.production_lead_days }
        : {}),
      ...(data.shipping_lead_days !== undefined
        ? { shipping_lead_days: data.shipping_lead_days }
        : {}),
      ...(data.margin_pct != null ? { margin_pct: data.margin_pct } : {}),
      ...(data.internal_notes !== undefined ? { internal_notes: data.internal_notes || null } : {}),
    };

    let optionId = data.option_id ?? null;
    if (optionId) {
      const { error } = await admin.from("quote_options").update(payload).eq("id", optionId);
      if (error) throw new Error(error.message);
    } else {
      const letter = data.letter ?? (await nextOptionLetter(admin, data.quote_id));
      if (!letter) throw new Error("A quote holds at most three options");
      const { data: created, error } = await admin
        .from("quote_options")
        .insert({ quote_request_id: data.quote_id, letter, ...payload })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      optionId = created.id;
    }

    // Only one option can carry the recommendation.
    if (data.recommended === true && optionId) {
      await admin
        .from("quote_options")
        .update({ recommended: false })
        .eq("quote_request_id", data.quote_id)
        .neq("id", optionId);
    }
    if (data.published === true) {
      await postSystemEvent(
        admin,
        data.quote_id,
        "options_published",
        "New pricing options were published on this quote.",
      );
    }
    return { ok: true, option_id: optionId };
  });

/** Admin: drop an option that no client has accepted. */
export const adminDeleteQuoteOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ option_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data: option } = await admin
      .from("quote_options")
      .select("accepted_at")
      .eq("id", data.option_id)
      .maybeSingle();
    if (option?.accepted_at) throw new Error("An accepted option cannot be deleted");
    await admin.from("quote_lines").delete().eq("option_id", data.option_id).eq("status", "pending");
    const { error } = await admin.from("quote_options").delete().eq("id", data.option_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
