/**
 * Public (unauthenticated) helpers that let the sign-up and reset screens tell
 * a visitor exactly WHY a flow cannot continue: the email already has an
 * account, or it has a pending sourcing invitation whose link must be used.
 *
 * These run with the service role because they inspect auth state, but they
 * only ever return a coarse status string — never profile data.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const emailSchema = z.object({ email: z.string().email() });

export type EmailStatus = "free" | "account_exists" | "sourcing_invite_pending";

async function lookup(email: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (list?.users ?? []).find((u) => u.email?.toLowerCase() === email) ?? null;
  const { data: collaborator } = await supabaseAdmin
    .from("sourcing_collaborators")
    .select("id, display_name, fee_tiers, active, invite_last_sent_at")
    .eq("email", email)
    .maybeSingle();
  return { admin: supabaseAdmin, user, collaborator };
}

/** What would happen if this email tried to sign up right now? */
export const checkEmailStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emailSchema.parse(input))
  .handler(async ({ data }): Promise<{ status: EmailStatus }> => {
    const email = data.email.toLowerCase();
    const { user, collaborator } = await lookup(email);
    if (!user) return { status: "free" };
    if (collaborator?.active && !user.last_sign_in_at) {
      return { status: "sourcing_invite_pending" };
    }
    return { status: "account_exists" };
  });

/**
 * Re-send the sourcing invitation link to an invitee who lost or burned the
 * original. Only works for an active collaborator who has never signed in, and
 * at most once a minute, so it cannot be used to probe or spam addresses.
 */
export const resendSourcingInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emailSchema.parse(input))
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase();
    const { admin, user, collaborator } = await lookup(email);
    if (!user || !collaborator?.active || user.last_sign_in_at) {
      throw new Error("No pending invitation for this email address.");
    }
    const last = collaborator.invite_last_sent_at
      ? new Date(collaborator.invite_last_sent_at).getTime()
      : 0;
    if (Date.now() - last < 60_000) {
      throw new Error("An invitation was just sent — please check your inbox first.");
    }
    const { sendCollaboratorInvite } = await import("./sourcing.server");
    const { parseFeeTiers } = await import("./fee-tiers");
    const result = await sendCollaboratorInvite(admin, {
      email,
      displayName: collaborator.display_name,
      feeTiers: parseFeeTiers(collaborator.fee_tiers),
      existing: true,
      collaboratorId: collaborator.id,
    });
    if (!result.sent) throw new Error(result.error ?? "Could not send the invitation email.");
    await admin
      .from("sourcing_collaborators")
      .update({ invite_last_sent_at: new Date().toISOString() })
      .eq("id", collaborator.id);
    return { ok: true as const };
  });
