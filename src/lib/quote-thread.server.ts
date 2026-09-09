/**
 * Quote conversation — server-only helpers.
 *
 * One thread per quote, between the client and the FlySales team. We are the
 * counterparty, so suppliers are never part of it and sourcing collaborators
 * never see it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendClientEmail } from "./email.server";
import { quoteMessageEmail } from "./email-templates.server";

type Admin = SupabaseClient<Database>;

/** quote → owning account id + workspace, resolved through store → entity. */
export async function quoteOwner(
  admin: Admin,
  quoteId: string,
): Promise<{ accountId: string | null; storeId: string | null; productName: string | null }> {
  const { data } = await admin
    .from("quote_requests")
    .select("store_id, product_name, product_url, stores(entities(account_id))")
    .eq("id", quoteId)
    .maybeSingle();
  const accountId =
    (data?.stores as { entities?: { account_id?: string | null } | null } | null)?.entities
      ?.account_id ?? null;
  return {
    accountId,
    storeId: data?.store_id ?? null,
    productName: data?.product_name ?? data?.product_url ?? null,
  };
}

/** Record an inline system event in the thread (publish, accept, requests…). */
export async function postSystemEvent(
  admin: Admin,
  quoteId: string,
  code: string,
  body: string,
): Promise<void> {
  await admin.from("quote_messages").insert({
    quote_request_id: quoteId,
    author_role: "system",
    kind: "system",
    system_code: code,
    body,
  });
}

/** Branded notification to the client that the FlySales team replied. */
export async function notifyClientOfReply(
  admin: Admin,
  quoteId: string,
  body: string,
): Promise<void> {
  const { accountId, productName } = await quoteOwner(admin, quoteId);
  if (!accountId) return;
  const email = quoteMessageEmail({
    quoteId,
    productName: productName ?? "your quote request",
    excerpt: body.slice(0, 240),
  });
  await sendClientEmail(admin, {
    clientId: accountId,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}
