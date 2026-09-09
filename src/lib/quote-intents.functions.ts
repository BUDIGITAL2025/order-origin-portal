import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quoteIntentSchema } from "./schemas";

/** The seven structured requests a client can raise on a published quote. */
export const INTENT_LABELS: Record<string, string> = {
  price_too_high: "The price is too high",
  add_country: "Quote another country",
  size_chart: "Send the size chart",
  factory_photos: "Send factory photos",
  materials_list: "Send the materials list",
  new_variant: "Quote a new variant",
  stop_quoting: "Stop quoting this product",
};

/** Client: raise a typed request on a quote. Posts to the thread and the admin queue. */
export const createQuoteIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteIntentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const owns = await context.supabase.rpc("owns_quote", { p_quote: data.quote_id });
    if (owns.data !== true) throw new Error("Quote request not found");
    if (data.type === "add_country" && (data.countries ?? []).length === 0) {
      throw new Error("Pick at least one country (up to three)");
    }

    const { getAdminClient } = await import("./admin.server");
    const { postSystemEvent, quoteOwner } = await import("./quote-thread.server");
    const { sendAdminEmail, sendClientEmail } = await import("./email.server");
    const { quoteRequestReceivedEmail } = await import("./email-templates.server");
    const admin = await getAdminClient();
    const owner = await quoteOwner(admin, data.quote_id);
    const label = INTENT_LABELS[data.type] ?? data.type;

    const { error } = await admin.from("quote_intents").insert({
      quote_request_id: data.quote_id,
      store_id: owner.storeId,
      type: data.type,
      payload: { countries: data.countries ?? [], note: data.note ?? "" },
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);

    const detail = [
      (data.countries ?? []).length ? `Countries: ${(data.countries ?? []).join(", ")}` : "",
      data.note ? `Note: ${data.note}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    await postSystemEvent(
      admin,
      data.quote_id,
      `intent:${data.type}`,
      detail ? `${label} — ${detail}` : label,
    );

    // Routing: everything actionable by sourcing goes to the assigned
    // collaborator; price decisions are ours, so those also reach the admin.
    const { assignedSourcer, notifySourcerOfClientMessage } = await import("./quote-thread.server");
    const priceRelated = data.type === "price_too_high" || data.type === "stop_quoting";
    const sourcerId = await assignedSourcer(admin, data.quote_id);
    if (sourcerId) {
      await notifySourcerOfClientMessage(admin, data.quote_id, `Client request: ${label}`, detail);
    }
    if (priceRelated || !sourcerId) {
      await sendAdminEmail({
        subject: `Quote request: ${label}`,
        text: `${label}\n${detail}\nQuote: ${data.quote_id}`,
      });
    }
    if (owner.accountId) {
      const email = quoteRequestReceivedEmail({
        quoteId: data.quote_id,
        productName: owner.productName ?? "your quote request",
        requestLabel: label,
      });
      await sendClientEmail(admin, {
        clientId: owner.accountId,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    }
    return { ok: true };
  });

/** Admin: the open requests queue across every quote. */
export const adminListQuoteIntents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ status: z.enum(["open", "handled"]).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    let query = admin
      .from("quote_intents")
      .select(
        "*, quote_requests(product_name, product_url), stores(store_name, entities(legal_name))",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return {
      intents: (rows ?? []).map((r) => ({
        id: r.id as string,
        quote_request_id: r.quote_request_id as string,
        type: r.type as string,
        label: INTENT_LABELS[r.type as string] ?? (r.type as string),
        payload: r.payload as { countries?: string[]; note?: string },
        status: r.status as string,
        created_at: r.created_at as string,
        product_name:
          (r.quote_requests as { product_name: string | null; product_url: string | null } | null)
            ?.product_name ??
          (r.quote_requests as { product_url: string | null } | null)?.product_url ??
          null,
        workspace:
          (r.stores as { store_name: string | null } | null)?.store_name ??
          (r.stores as { entities?: { legal_name: string | null } | null } | null)?.entities
            ?.legal_name ??
          null,
      })),
    };
  });

/** Admin: close a request once it has been handled. */
export const adminResolveQuoteIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ intent_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin
      .from("quote_intents")
      .update({
        status: "handled",
        handled_at: new Date().toISOString(),
        handled_by: context.userId,
      })
      .eq("id", data.intent_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
