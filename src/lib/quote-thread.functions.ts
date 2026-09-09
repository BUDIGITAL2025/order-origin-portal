import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { quoteMessageSchema } from "./schemas";

export type ThreadMessage = {
  id: string;
  author_role: string;
  kind: string;
  system_code: string | null;
  body: string | null;
  attachments: string[];
  pinned: boolean;
  created_at: string;
};

const quoteIdSchema = z.object({ quote_id: z.string().uuid() });

/** Client: read my conversation with the FlySales team on one quote. */
export const listQuoteMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("quote_messages")
      .select("id, author_role, kind, system_code, body, attachments, pinned, created_at")
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { messages: (rows ?? []) as ThreadMessage[] };
  });

/** Client: post a message (text and/or images) into the thread. */
export const postQuoteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteMessageSchema.parse(input))
  .handler(async ({ data, context }) => {
    const body = (data.body ?? "").trim();
    const attachments = data.attachments ?? [];
    if (!body && attachments.length === 0) throw new Error("Write a message or attach an image");

    const { error } = await context.supabase.from("quote_messages").insert({
      quote_request_id: data.quote_id,
      author_user_id: context.userId,
      author_role: "client",
      kind: "message",
      body: body || null,
      attachments,
    });
    if (error) throw new Error(error.message);

    const { getAdminClient } = await import("./admin.server");
    const { sendAdminEmail } = await import("./email.server");
    const { assignedSourcer, notifySourcerOfClientMessage } = await import("./quote-thread.server");
    const admin = await getAdminClient();
    const { data: quote } = await admin
      .from("quote_requests")
      .select("product_name, product_url")
      .eq("id", data.quote_id)
      .maybeSingle();

    // The assigned collaborator owns the conversation on their own quotes; the
    // admin is only pulled in when nobody is sourcing it yet, so ordinary
    // messages do not drown the internal mailbox.
    const sourcerId = await assignedSourcer(admin, data.quote_id);
    if (sourcerId) {
      await notifySourcerOfClientMessage(
        admin,
        data.quote_id,
        "New client message",
        body || "(image only)",
      );
    } else {
      await sendAdminEmail({
        subject: `New client message on a quote: ${quote?.product_name ?? quote?.product_url ?? data.quote_id}`,
        text: `${body || "(image only)"}\n\nQuote: ${data.quote_id}`,
      });
    }
    return { ok: true };
  });

/**
 * Sourcing collaborator: read the thread of a quote assigned to me. The client
 * is masked here and never identified anywhere in the payload.
 */
export const sourcingListQuoteMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { requireCollaborator } = await import("./sourcing.server");
    const { clientShortLabel } = await import("./quote-thread.server");
    await requireCollaborator(await getAdminClient(), context.userId);
    const admin = await getAdminClient();

    const { data: quote } = await admin
      .from("quote_requests")
      .select("assigned_sourcer, store_id")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (!quote || quote.assigned_sourcer !== context.userId) {
      throw new Error("This request is assigned to another collaborator");
    }

    const { data: rows, error } = await admin
      .from("quote_messages")
      .select("id, author_role, kind, system_code, body, attachments, pinned, created_at")
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    await admin
      .from("quote_messages")
      .update({ read_by_sourcer_at: new Date().toISOString() })
      .eq("quote_request_id", data.quote_id)
      .eq("author_role", "client")
      .is("read_by_sourcer_at", null);

    return {
      client_label: clientShortLabel(quote.store_id),
      messages: (rows ?? []).map((m) => ({ ...m, pinned: m.pinned })) as ThreadMessage[],
    };
  });

/** Sourcing collaborator: reply on a quote assigned to me, as FlySales Sourcing. */
export const sourcingPostQuoteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteMessageSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { requireCollaborator } = await import("./sourcing.server");
    const { notifyClientOfReply } = await import("./quote-thread.server");
    const admin = await getAdminClient();
    await requireCollaborator(admin, context.userId);

    const { data: quote } = await admin
      .from("quote_requests")
      .select("assigned_sourcer")
      .eq("id", data.quote_id)
      .maybeSingle();
    if (!quote || quote.assigned_sourcer !== context.userId) {
      throw new Error("This request is assigned to another collaborator");
    }

    const body = (data.body ?? "").trim();
    const attachments = data.attachments ?? [];
    if (!body && attachments.length === 0) throw new Error("Write a message or attach an image");

    // The real author is always stored, even though both sides see a role.
    const { error } = await admin.from("quote_messages").insert({
      quote_request_id: data.quote_id,
      author_user_id: context.userId,
      author_role: "sourcing",
      kind: "message",
      body: body || null,
      attachments,
    });
    if (error) throw new Error(error.message);
    await notifyClientOfReply(admin, data.quote_id, body || "The team attached new images.");
    return { ok: true };
  });

/** Admin: read any quote thread. */
export const adminListQuoteMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data: rows, error } = await admin
      .from("quote_messages")
      .select("id, author_role, kind, system_code, body, attachments, pinned, created_at")
      .eq("quote_request_id", data.quote_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { messages: (rows ?? []) as ThreadMessage[] };
  });

/** Admin: reply to the client. Sends the branded notification email. */
export const adminPostQuoteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteMessageSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { notifyClientOfReply } = await import("./quote-thread.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const body = (data.body ?? "").trim();
    const attachments = data.attachments ?? [];
    if (!body && attachments.length === 0) throw new Error("Write a message or attach an image");

    const { error } = await admin.from("quote_messages").insert({
      quote_request_id: data.quote_id,
      author_user_id: context.userId,
      author_role: "admin",
      kind: "message",
      body: body || null,
      attachments,
    });
    if (error) throw new Error(error.message);
    await notifyClientOfReply(admin, data.quote_id, body || "The team attached new images.");
    return { ok: true };
  });

/** Admin: pin/unpin a message so it stays at the top of the thread. */
export const adminPinQuoteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ message_id: z.string().uuid(), pinned: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin
      .from("quote_messages")
      .update({ pinned: data.pinned })
      .eq("id", data.message_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Signed URLs for thread attachments. Both sides upload into their own folder
 * of the private quote-images bucket, so cross-side reads are signed here
 * after the caller's access to the quote has been checked.
 */
export const getThreadAttachmentUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ quote_id: z.string().uuid(), paths: z.array(z.string().max(500)).max(50) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getAdminClient } = await import("./admin.server");
    const { callerIsAdmin } = await import("./sourcing.server");
    const admin = await getAdminClient();
    const allowed =
      (await callerIsAdmin(context.supabase, context.userId)) ||
      (await context.supabase.rpc("owns_quote", { p_quote: data.quote_id })).data === true ||
      (await context.supabase.rpc("is_assigned_sourcer", { p_quote: data.quote_id })).data === true;
    if (!allowed) throw new Error("Forbidden");

    if (data.paths.length === 0) return { urls: [] };
    const { data: signed, error } = await admin.storage
      .from("quote-images")
      .createSignedUrls(data.paths, 300);
    if (error) throw new Error(error.message);
    return {
      urls: (signed ?? [])
        .filter((s) => s.signedUrl)
        .map((s) => ({ path: s.path ?? "", url: s.signedUrl! })),
    };
  });

/** Client: mark the team's messages on one quote as read. */
export const markQuoteThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => quoteIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const owns = await context.supabase.rpc("owns_quote", { p_quote: data.quote_id });
    if (owns.data !== true) return { ok: false };
    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();
    await admin
      .from("quote_messages")
      .update({ read_by_client_at: new Date().toISOString() })
      .eq("quote_request_id", data.quote_id)
      .eq("author_role", "admin")
      .is("read_by_client_at", null);
    return { ok: true };
  });

/**
 * Client: unread-message counts across my quotes, for the saved views and the
 * dashboard widget.
 */
export const listMyQuoteSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: quotes } = await context.supabase
      .from("quote_requests")
      .select("id")
      .is("archived_at", null);
    const ids = (quotes ?? []).map((q) => q.id);
    if (ids.length === 0) return { unread: {} as Record<string, number> };

    const { getAdminClient } = await import("./admin.server");
    const admin = await getAdminClient();
    const { data: rows } = await admin
      .from("quote_messages")
      .select("quote_request_id")
      .in("quote_request_id", ids)
      .eq("author_role", "admin")
      .is("read_by_client_at", null);
    const unread: Record<string, number> = {};
    for (const r of rows ?? []) {
      unread[r.quote_request_id] = (unread[r.quote_request_id] ?? 0) + 1;
    }
    return { unread };
  });
