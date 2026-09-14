import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export const STAFF_DOMAIN = "budigital.org";
export const PERPETUAL_OWNERS = ["flavio@budigital.org", "info@budigital.org"];

export function isStaffEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${STAFF_DOMAIN}`);
}

export function isPerpetualOwner(email: string): boolean {
  return PERPETUAL_OWNERS.includes(email.trim().toLowerCase());
}

/**
 * Generate a sign-in link server-side and deliver it through OUR branded
 * Resend template, exactly like the sourcing invite — so a staff invitation
 * looks and logs like every other transactional email.
 */
export async function sendStaffInvite(
  admin: Admin,
  args: { email: string; level: string; existing: boolean },
): Promise<{ sent: boolean; id?: string; error?: string; userId?: string }> {
  const { appBaseUrl } = await import("./email-layout.server");
  const { staffInviteEmail } = await import("./email-templates.server");
  const { sendLoggedEmail } = await import("./email.server");

  const redirectTo = `${appBaseUrl()}/reset-password`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: args.existing ? "magiclink" : "invite",
    email: args.email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    const message = error?.message ?? "Could not generate the invitation link";
    console.error("[staff:invite] link generation failed:", message);
    return { sent: false, error: message };
  }

  const expires = new Date(Date.now() + 24 * 3600 * 1000);
  const built = staffInviteEmail({
    inviteUrl: data.properties.action_link,
    email: args.email,
    level: args.level,
    expiresLabel: expires.toUTCString().replace(" GMT", " UTC"),
  });
  const result = await sendLoggedEmail(admin, {
    to: args.email,
    subject: built.subject,
    text: built.text,
    html: built.html,
    kind: "staff_invite",
  });
  return { ...result, ...(data.user?.id ? { userId: data.user.id } : {}) };
}
