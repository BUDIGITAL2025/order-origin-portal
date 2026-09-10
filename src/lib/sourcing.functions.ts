/**
 * Sourcing desk — server functions.
 *
 * Every collaborator-facing function reads through the service role AFTER
 * `requireCollaborator`, and projects only the columns that layer is allowed
 * to see. Client identity, client price and owner margin are never selected,
 * so they cannot leak even by accident.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sourcingFee } from "./pricing";
import {
  assignSourcerSchema,
  collaboratorInviteSchema,
  collaboratorUpdateSchema,
  publishQuoteSchema,
  settleEarningsSchema,
  sourcingSaveLinesSchema,
} from "./schemas";

const uuid = z.string().uuid();

/** Columns of a quote request a collaborator may see — no store, no client. */
const DESK_QUOTE_COLUMNS =
  "id, product_url, product_name, notes, target_monthly_volume, target_countries, image_urls, status, created_at, quote_due_at, sourcing_submitted_at, assigned_sourcer, client_site";

/**
 * A product URL that points at the client's own site identifies the client, so
 * the sourcing layer never receives it — they source from the essentials
 * (name, photos, specs, variants, countries) instead.
 */
function maskClientSiteUrl<T extends { product_url: string | null; client_site?: boolean | null }>(
  quote: T,
): T {
  return quote.client_site ? { ...quote, product_url: null } : quote;
}

/** Columns of a quote line a collaborator may see — no unit_price, no margin. */
const DESK_LINE_COLUMNS =
  "id, quote_request_id, variant_label, country_code, sku, supplier_id, supplier_unit_price, supplier_cogs, supplier_shipping, supplier_tax, fee_included, moq, production_lead_days, sourcing_notes, sourcing_image_urls, sourcing_fee_rate, sourcing_cost, sourced_at, status";

// ===================== Collaborator desk =====================

/** Who am I on the sourcing desk? Returns null for everyone else. */
export const getSourcingDeskContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();
    const { data } = await admin
      .from("sourcing_collaborators")
      .select("id, email, display_name, fee_rate, active")
      .eq("user_id", context.userId)
      .maybeSingle();
    return { collaborator: data?.active ? data : null };
  });

/** The queue: requests assigned to me, plus anything still unassigned. */
export const sourcingListQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { requireCollaborator } = await import("./sourcing.server");
    const admin = await getAdminClient();
    const me = await requireCollaborator(admin, context.userId);

    const { data: quotes, error } = await admin
      .from("quote_requests")
      .select(DESK_QUOTE_COLUMNS)
      .in("status", ["submitted", "sourcing", "quoted"])
      .or(`assigned_sourcer.eq.${context.userId},assigned_sourcer.is.null`)
      .order("quote_due_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);

    const ids = (quotes ?? []).map((q) => q.id);
    const { data: lines } = ids.length
      ? await admin
          .from("quote_lines")
          .select("quote_request_id, supplier_unit_price")
          .in("quote_request_id", ids)
      : { data: [] };
    const pricedByQuote = new Map<string, number>();
    for (const l of lines ?? []) {
      if (l.supplier_unit_price != null) {
        pricedByQuote.set(l.quote_request_id, (pricedByQuote.get(l.quote_request_id) ?? 0) + 1);
      }
    }

    return {
      feeRate: Number(me.fee_rate),
      quotes: (quotes ?? []).map((q) => ({
        ...maskClientSiteUrl(q),
        mine: q.assigned_sourcer === context.userId,
        priced_lines: pricedByQuote.get(q.id) ?? 0,
      })),
    };
  });

/** One request with the sourcing layer only. */
export const sourcingGetQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ quote_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { requireCollaborator, feeAmount } = await import("./sourcing.server");
    const admin = await getAdminClient();
    const me = await requireCollaborator(admin, context.userId);

    const { data: quote, error } = await admin
      .from("quote_requests")
      .select(`${DESK_QUOTE_COLUMNS}, preview_id`)
      .eq("id", data.quote_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) throw new Error("Quote request not found");
    if (quote.assigned_sourcer && quote.assigned_sourcer !== context.userId) {
      throw new Error("This request is assigned to another collaborator");
    }

    const { data: lines } = await admin
      .from("quote_lines")
      .select(DESK_LINE_COLUMNS)
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });

    const supplierIds = [...new Set((lines ?? []).map((l) => l.supplier_id).filter(Boolean))];
    const { data: suppliers } = supplierIds.length
      ? await admin
          .from("suppliers")
          .select("id, name")
          .in("id", supplierIds as string[])
      : { data: [] };
    const nameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

    let preview: {
      title: string | null;
      description: string | null;
      image_urls: string[];
      price_hint: string | null;
      variants: string[];
    } | null = null;
    if (quote.preview_id) {
      const { data: p } = await admin
        .from("url_previews")
        .select("title, description, image_urls, price_hint, variants")
        .eq("id", quote.preview_id)
        .maybeSingle();
      if (p) preview = { ...p, variants: p.variants ?? [] };
    }
    // On a client-site listing the scraped title/description carry the brand,
    // so only the neutral essentials (photos, variants) survive.
    if (quote.client_site && preview) {
      preview = { ...preview, title: null, description: null, price_hint: null };
    }

    return {
      feeRate: Number(me.fee_rate),
      quote: maskClientSiteUrl(quote),
      essentialsOnly: quote.client_site === true,
      preview,
      lines: (lines ?? []).map((l) => ({
        ...l,
        supplier_name: l.supplier_id ? (nameById.get(l.supplier_id) ?? null) : null,
        my_fee: l.fee_included
          ? 0
          : sourcingFee(
              Number(l.supplier_cogs ?? l.supplier_unit_price ?? 0),
              Number(l.supplier_shipping ?? 0),
              Number(l.sourcing_fee_rate ?? me.fee_rate),
            ),
      })),
    };
  });

/**
 * Save the sourcing layer for a request: supplier, COGS, supplier shipping,
 * import-tax passthrough, MOQ, production lead time. The fee rate is
 * snapshotted from the collaborator's own row — never sent by the browser —
 * and sourcing_cost is computed here.
 */
export const sourcingSaveLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sourcingSaveLinesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const sourcing = await import("./sourcing.server");
    const { ensureDefaultOption } = await import("./quote-offers.server");
    const admin = await getAdminClient();
    const me = await sourcing.requireCollaborator(admin, context.userId);
    const feeRate = Number(me.fee_rate);

    const { data: quote } = await admin
      .from("quote_requests")
      .select("id, status, assigned_sourcer, store_id")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (!quote) throw new Error("Quote request not found");
    if (quote.assigned_sourcer && quote.assigned_sourcer !== context.userId) {
      throw new Error("This request is assigned to another collaborator");
    }

    const saved = await sourcing.writeSourcingLines(admin, {
      quoteId: data.quote_id,
      lines: data.lines,
      feeRate,
      sourcedBy: context.userId,
      optionId: data.option_id ?? (await ensureDefaultOption(admin, data.quote_id)),
    });

    await admin
      .from("quote_requests")
      .update({
        status: "sourcing",
        assigned_sourcer: context.userId,
        sourcing_submitted_at: new Date().toISOString(),
      })
      .eq("id", data.quote_id);

    return { ok: true, lines: saved.length };
  });

/**
 * The admin acting as sourcing: same inputs, same chain. The fee rate is the
 * house default, and no commission is accrued because no collaborator is
 * attached to the line.
 */
export const adminSaveSourcingLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sourcingSaveLinesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { DEFAULT_FEE_RATE, writeSourcingLines } = await import("./sourcing.server");
    const { ensureDefaultOption } = await import("./quote-offers.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: quote } = await admin
      .from("quote_requests")
      .select("id, status")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (!quote) throw new Error("Quote request not found");
    if (!["submitted", "sourcing", "quoted"].includes(quote.status)) {
      throw new Error("This request can no longer be edited");
    }

    const saved = await writeSourcingLines(admin, {
      quoteId: data.quote_id,
      lines: data.lines,
      feeRate: DEFAULT_FEE_RATE,
      sourcedBy: null,
      optionId: data.option_id ?? (await ensureDefaultOption(admin, data.quote_id)),
    });

    if (quote.status === "submitted") {
      await admin.from("quote_requests").update({ status: "sourcing" }).eq("id", data.quote_id);
    }
    return { ok: true, lines: saved };
  });

/** The collaborator's own earnings — accrued and settled totals plus lines. */
export const sourcingMyEarnings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { requireCollaborator } = await import("./sourcing.server");
    const admin = await getAdminClient();
    await requireCollaborator(admin, context.userId);

    const { data, error } = await admin
      .from("sourcing_earnings")
      .select("id, description, units, fee_rate, amount, accrued_at, settled, settled_at")
      .eq("collaborator_user_id", context.userId)
      .order("accrued_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const total = (settled: boolean) =>
      Math.round(
        rows.filter((r) => r.settled === settled).reduce((a, r) => a + Number(r.amount), 0) * 100,
      ) / 100;
    return { rows, pending: total(false), settled: total(true) };
  });

/**
 * When the withheld listing leaves too little to source from, the collaborator
 * asks US — never the client. Admin decides what may be passed along.
 */
export const sourcingRequestProductDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ quote_id: uuid, note: z.string().trim().max(1000).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { requireCollaborator } = await import("./sourcing.server");
    const { sendAdminEmail } = await import("./email.server");
    const admin = await getAdminClient();
    const me = await requireCollaborator(admin, context.userId);

    const { data: quote } = await admin
      .from("quote_requests")
      .select("id, store_id, product_name, assigned_sourcer")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (!quote) throw new Error("Quote request not found");
    if (quote.assigned_sourcer !== context.userId) {
      throw new Error("This request is not assigned to you");
    }

    const { error } = await admin.from("quote_intents").insert({
      quote_request_id: quote.id,
      store_id: quote.store_id,
      type: "need_product_details",
      payload: { note: data.note ?? "", from: "sourcing" },
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    await sendAdminEmail({
      subject: `Sourcing needs more product details: ${quote.product_name ?? quote.id}`,
      text: [
        `${me.display_name || me.email} needs more details to source this request.`,
        data.note ? `Note: ${data.note}` : "",
        `Quote: ${quote.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return { ok: true };
  });

// ===================== Admin: collaborators =====================

export const adminListCollaborators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from("sourcing_collaborators")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: earnings } = await admin
      .from("sourcing_earnings")
      .select("collaborator_user_id, amount, settled");
    const totals = new Map<string, { pending: number; settled: number }>();
    for (const e of earnings ?? []) {
      const t = totals.get(e.collaborator_user_id) ?? { pending: 0, settled: 0 };
      if (e.settled) t.settled += Number(e.amount);
      else t.pending += Number(e.amount);
      totals.set(e.collaborator_user_id, t);
    }
    // "Pending" = the account has never signed in, so the invite is unused.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const signedIn = new Map(
      (list?.users ?? []).map((u) => [u.id, Boolean(u.last_sign_in_at)] as const),
    );

    return {
      collaborators: (data ?? []).map((c) => ({
        ...c,
        pending: Math.round((totals.get(c.user_id)?.pending ?? 0) * 100) / 100,
        settled_total: Math.round((totals.get(c.user_id)?.settled ?? 0) * 100) / 100,
        invite_pending: !(signedIn.get(c.user_id) ?? false),
      })),
    };
  });

/** Invite a collaborator by email (or link an existing account). */
export const adminInviteCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => collaboratorInviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { sendCollaboratorInvite } = await import("./sourcing.server");
    const admin = await getAdminClient();
    const email = data.email.toLowerCase();
    const displayName = data.display_name || null;
    const feeRate = data.fee_rate_pct / 100;

    // Existing account? Reuse it. Otherwise the invite link creates it.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existingUser = (list?.users ?? []).find((u) => u.email?.toLowerCase() === email) ?? null;

    const invite = await sendCollaboratorInvite(admin, {
      email,
      displayName,
      feeRate,
      existing: Boolean(existingUser),
    });
    const userId = existingUser?.id ?? invite.userId;
    if (!userId) {
      throw new Error(invite.error ?? "Could not create the collaborator account");
    }

    const now = new Date().toISOString();
    const { data: row, error: insertError } = await admin
      .from("sourcing_collaborators")
      .upsert(
        {
          user_id: userId,
          email,
          display_name: displayName,
          fee_rate: feeRate,
          active: true,
          invited_at: now,
          invite_last_sent_at: now,
        },
        { onConflict: "user_id" },
      )
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    return {
      ok: true,
      invited: !existingUser,
      emailSent: invite.sent,
      messageId: invite.id ?? null,
      emailError: invite.error ?? null,
      collaboratorId: row?.id ?? null,
    };
  });

/** Re-send the branded invitation to a collaborator who never signed in. */
export const adminResendCollaboratorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { sendCollaboratorInvite } = await import("./sourcing.server");
    const admin = await getAdminClient();

    const { data: row, error } = await admin
      .from("sourcing_collaborators")
      .select("id, user_id, email, display_name, fee_rate")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Collaborator not found");

    const { data: existing } = await admin.auth.admin.getUserById(row.user_id);
    const invite = await sendCollaboratorInvite(admin, {
      email: row.email,
      displayName: row.display_name,
      feeRate: Number(row.fee_rate),
      existing: Boolean(existing?.user),
      collaboratorId: row.id,
    });
    if (!invite.sent) throw new Error(invite.error ?? "The invitation was not sent");

    await admin
      .from("sourcing_collaborators")
      .update({ invite_last_sent_at: new Date().toISOString() })
      .eq("id", row.id);

    return { ok: true, messageId: invite.id ?? null };
  });

export const adminUpdateCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => collaboratorUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin
      .from("sourcing_collaborators")
      .update({
        ...(data.display_name !== undefined ? { display_name: data.display_name || null } : {}),
        ...(data.fee_rate_pct !== undefined ? { fee_rate: data.fee_rate_pct / 100 } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminAssignSourcer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => assignSourcerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin
      .from("quote_requests")
      .update({ assigned_sourcer: data.user_id })
      .eq("id", data.quote_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===================== Admin: publish the chain =====================

/** Quotes published without an explicit date stay valid for 7 days. */
export const DEFAULT_QUOTE_VALID_DAYS = 7;

function defaultValidUntil(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + DEFAULT_QUOTE_VALID_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * The owner's step: set the margin per variant and publish. client_price is
 * computed here from the stored sourcing_cost — the browser only ever sends
 * a margin percentage.
 */
export const adminPublishQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => publishQuoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { clientPrice } = await import("./sourcing.server");
    const { sourcingCostOf } = await import("./pricing");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: lines, error } = await admin
      .from("quote_lines")
      .select(
        "id, option_id, sourcing_cost, supplier_cogs, supplier_shipping, supplier_tax, sourcing_fee_rate, fee_included, quote_request_id",
      )
      .eq("quote_request_id", data.quote_id);
    if (error) throw new Error(error.message);
    const byId = new Map((lines ?? []).map((l) => [l.id, l]));

    for (const input of data.lines) {
      const line = byId.get(input.id);
      if (!line) continue;
      if (line.sourcing_cost == null) {
        throw new Error("Every variant needs a supplier price before publishing.");
      }

      // The owner may adjust the sourcing fee per line before publishing; the
      // chain is then recomputed here so the stored cost matches what was shown.
      let cost = Number(line.sourcing_cost);
      const feeFields: { sourcing_fee_rate?: number; sourcing_cost?: number } = {};
      if (input.fee_rate_pct != null) {
        const feeRate = input.fee_rate_pct / 100;
        cost = sourcingCostOf({
          cogs: Number(line.supplier_cogs ?? 0),
          shipping: Number(line.supplier_shipping ?? 0),
          feeRate,
          // A cost that already contains the fee never gets a second one.
          feeIncluded: line.fee_included === true,
        });
        feeFields.sourcing_fee_rate = feeRate;
        feeFields.sourcing_cost = cost;
      }

      const price = clientPrice(cost, input.margin_pct, Number(line.supplier_tax ?? 0));
      const { error: updateError } = await admin
        .from("quote_lines")
        .update({
          ...feeFields,
          margin_pct: input.margin_pct,
          unit_price: price,
          responded_at: null,
        })
        .eq("id", input.id);
      if (updateError) throw new Error(updateError.message);
    }

    // Publishing a line publishes the offer it belongs to, so the client sees
    // exactly the options that were priced.
    const publishedOptions = [
      ...new Set(
        data.lines.map((input) => byId.get(input.id)?.option_id).filter((v): v is string => !!v),
      ),
    ];
    if (publishedOptions.length > 0) {
      await admin.from("quote_options").update({ published: true }).in("id", publishedOptions);
      const { postSystemEvent } = await import("./quote-thread.server");
      await postSystemEvent(
        admin,
        data.quote_id,
        "options_published",
        publishedOptions.length > 1
          ? `${publishedOptions.length} pricing options were published.`
          : "Your pricing was published.",
      );
    }

    // Left empty, a published quote stays open for 7 days.
    const validUntil = data.quote_valid_until ?? defaultValidUntil();

    const { error: quoteError } = await admin
      .from("quote_requests")
      .update({
        status: "quoted",
        quoted_at: new Date().toISOString(),
        quoted_by: context.userId,
        quote_valid_until: validUntil,
      })
      .eq("id", data.quote_id);
    if (quoteError) throw new Error(quoteError.message);

    if (data.admin_notes) {
      await admin
        .from("quote_request_internal")
        .upsert(
          { quote_request_id: data.quote_id, admin_notes: data.admin_notes },
          { onConflict: "quote_request_id" },
        );
    }
    return { ok: true };
  });

// ===================== Admin: earnings report =====================

export const adminEarningsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        settled: z.enum(["all", "pending", "settled"]).default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    let query = admin
      .from("sourcing_earnings")
      .select("*")
      .order("accrued_at", { ascending: false })
      .limit(1000);
    if (data.from) query = query.gte("accrued_at", data.from);
    if (data.to) query = query.lte("accrued_at", data.to);
    if (data.settled !== "all") query = query.eq("settled", data.settled === "settled");
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const { data: collaborators } = await admin
      .from("sourcing_collaborators")
      .select("user_id, email, display_name");
    const nameByUser = new Map(
      (collaborators ?? []).map((c) => [c.user_id, c.display_name || c.email]),
    );
    return {
      rows: (rows ?? []).map((r) => ({
        ...r,
        collaborator: nameByUser.get(r.collaborator_user_id) ?? "Unknown",
      })),
    };
  });

export const adminSettleEarnings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => settleEarningsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin
      .from("sourcing_earnings")
      .update({ settled: true, settled_at: new Date().toISOString() })
      .in("id", data.ids)
      .eq("settled", false);
    if (error) throw new Error(error.message);
    return { ok: true, settled: data.ids.length };
  });
