import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Single source of truth for sender identity. Every transactional email —
 * invites, receipts, tracking, reminders, claims, digests — ships from this
 * platform mailbox. No template may hardcode its own `from`, and a personal
 * address must never appear in the envelope.
 */
export const SENDER_ADDRESS = process.env["EMAIL_FROM_ADDRESS"]?.trim() || "noreply@flysales.app";
/** Display name for everything client- and collaborator-facing. */
export const SENDER_NAME = process.env["EMAIL_SENDER_NAME"]?.trim() || "FlySales";
/** Display name reserved for internal ops mail (the daily digest). */
export const OPS_SENDER_NAME = "FlySales Ops";
/** Humans answer here; the sending mailbox is unattended. */
export const REPLY_TO_ADDRESS =
  process.env["EMAIL_REPLY_TO_ADDRESS"]?.trim() || "support@flysales.app";

function sender(name = SENDER_NAME): { from: string; name: string; address: string | null } {
  const address = SENDER_ADDRESS || null;
  return { name, address, from: address ? `${name} <${address}>` : name };
}

function htmlFromText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family:Figtree,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b1c1a;white-space:pre-wrap">${escaped}</div>`;
}

/**
 * Low-level transactional send through Resend.
 *
 * Never throws: email must never break a money path. Returns whether the
 * provider accepted the message so callers can log it if they care.
 * When RESEND_API_KEY is unset the message is logged with a loud warning.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  /** Branded HTML part; falls back to the escaped text when omitted. */
  html?: string;
  /** Defaults to support@ — pass null only for internal ops mail. */
  replyTo?: string | null;
  /** Display name override; only the ops digest uses this. */
  senderName?: string;
}): Promise<{ sent: boolean; id?: string; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"]?.trim();
  const { from, address } = sender(args.senderName ?? SENDER_NAME);
  const replyTo = args.replyTo === null ? null : (args.replyTo ?? REPLY_TO_ADDRESS);

  if (!apiKey || !address) {
    console.warn(
      "[email:NO-PROVIDER] RESEND_API_KEY or EMAIL_FROM_ADDRESS is not set — email NOT sent:",
      JSON.stringify({ to: args.to, subject: args.subject, text: args.text }),
    );
    return { sent: false, error: "email provider not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        html: args.html ?? htmlFromText(args.text),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!response.ok) {
      const message = payload.message ?? `HTTP ${response.status}`;
      console.error("[email:resend] send failed:", args.subject, message);
      return { sent: false, error: message };
    }
    console.log("[email:resend] sent", JSON.stringify({ id: payload.id, to: args.to, subject: args.subject }));
    return { sent: true, ...(payload.id ? { id: payload.id } : {}) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[email:resend] send threw:", message);
    return { sent: false, error: message };
  }
}

/**
 * Transactional email to a client (address resolved from auth, never stored
 * on the profile). Swallows every failure by design.
 */
export async function sendClientEmail(
  admin: Admin,
  args: { clientId: string; subject: string; text: string; html?: string },
): Promise<void> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(args.clientId);
    const to = error ? null : (data.user?.email ?? null);
    if (!to) {
      console.warn("[email] no address for account", args.clientId);
      return;
    }
    await sendEmail({
      to,
      subject: args.subject,
      text: args.text,
      ...(args.html ? { html: args.html } : {}),
    });
  } catch (e) {
    console.error("[email] client send failed:", e);
  }
}

/** Internal/ops email to ADMIN_DIGEST_EMAIL (falls back to the sender mailbox). */
export async function sendAdminEmail(args: {
  subject: string;
  text: string;
}): Promise<{ sent: boolean; error?: string }> {
  const to =
    process.env["ADMIN_DIGEST_EMAIL"]?.trim() ||
    process.env["EMAIL_FROM_ADDRESS"]?.trim();
  if (!to) {
    console.warn("[email] no ADMIN_DIGEST_EMAIL configured:", args.subject);
    return { sent: false, error: "no admin recipient" };
  }
  return sendEmail({ to, subject: args.subject, text: args.text });
}

/**
 * Send and record the attempt in `email_log` (admin-visible), so a missing
 * invite can be diagnosed without guessing. Logging never throws.
 */
export async function sendLoggedEmail(
  admin: Admin,
  args: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    /** Short machine label, e.g. "sourcing_invite". */
    kind: string;
    /** Row this email belongs to, when there is one. */
    relatedId?: string;
  },
): Promise<{ sent: boolean; id?: string; error?: string }> {
  const result = await sendEmail({
    to: args.to,
    subject: args.subject,
    text: args.text,
    ...(args.html ? { html: args.html } : {}),
  });
  try {
    await admin.from("email_log").insert({
      to_address: args.to,
      subject: args.subject,
      kind: args.kind,
      status: result.sent ? "sent" : "failed",
      provider_message_id: result.id ?? null,
      error: result.error ?? null,
      related_id: args.relatedId ?? null,
    });
  } catch (e) {
    console.error("[email] log insert failed:", e);
  }
  return result;
}
