import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Transactional email to a client (resolved from auth, never stored on the
 * profile).
 *
 * TODO(email-provider): no email provider is connected to this project yet.
 * Until one is, every email is logged server-side (visible in the function
 * logs) and swallowed — billing flows must never fail because an email could
 * not be sent. To go live, wire this helper to the provider SDK (e.g. via
 * Lovable's transactional email setup) and keep every existing call site
 * unchanged.
 */
export async function sendClientEmail(
  admin: Admin,
  args: { clientId: string; subject: string; text: string },
): Promise<void> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(args.clientId);
    const to = error ? null : (data.user?.email ?? null);
    console.log(
      "[email:pending-provider]",
      JSON.stringify({ to, subject: args.subject, text: args.text }),
    );
  } catch (e) {
    console.error("[email:pending-provider] failed:", e);
  }
}
