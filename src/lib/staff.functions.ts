import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const levelSchema = z.enum(["owner", "collaborator", "reader"]);

export interface StaffRow {
  user_id: string;
  email: string;
  level: "owner" | "collaborator" | "reader";
  status: "active" | "inactive";
  last_active_at: string | null;
  created_at: string;
  perpetual: boolean;
}

/** Owners: the internal team list. */
export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireOwner, getAdminClient } = await import("./admin.server");
    await requireOwner(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { isPerpetualOwner } = await import("./staff.server");

    const { data, error } = await admin
      .from("staff_members")
      .select("user_id, email, level, status, last_active_at, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ...row,
      perpetual: isPerpetualOwner(row.email),
    })) as StaffRow[];
  });

/** Owners: change someone's level. Perpetual owners are refused by the DB. */
export const setStaffLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), level: levelSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireOwner, getAdminClient } = await import("./admin.server");
    await requireOwner(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { writeAuditLine } = await import("./cleanup.server");

    const { data: before, error: readError } = await admin
      .from("staff_members")
      .select("email, level")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!before) throw new Error("That team member no longer exists.");

    const { error } = await admin
      .from("staff_members")
      .update({ level: data.level })
      .eq("user_id", data.user_id);
    if (error) throw new Error(translate(error.message));

    await syncAdminRole(admin, data.user_id, data.level, "active");
    await writeAuditLine(admin, {
      actorId: context.userId,
      action: "staff_level_change",
      entityType: "staff_member",
      entityId: data.user_id,
      summary: `${before.email}: ${before.level} → ${data.level}`,
      detail: { from: before.level, to: data.level, email: before.email },
    });
    return { ok: true };
  });

/** Owners: deactivate or reactivate a team member. */
export const setStaffStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid(), status: z.enum(["active", "inactive"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireOwner, getAdminClient } = await import("./admin.server");
    await requireOwner(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { writeAuditLine } = await import("./cleanup.server");

    const { data: before, error: readError } = await admin
      .from("staff_members")
      .select("email, level, status")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!before) throw new Error("That team member no longer exists.");

    const { error } = await admin
      .from("staff_members")
      .update({ status: data.status })
      .eq("user_id", data.user_id);
    if (error) throw new Error(translate(error.message));

    await syncAdminRole(admin, data.user_id, before.level, data.status);
    await writeAuditLine(admin, {
      actorId: context.userId,
      action: data.status === "active" ? "staff_reactivate" : "staff_deactivate",
      entityType: "staff_member",
      entityId: data.user_id,
      summary: `${before.email}: ${before.status} → ${data.status}`,
      detail: { from: before.status, to: data.status, email: before.email },
    });
    return { ok: true };
  });

/** Owners: invite a new @budigital.org colleague. */
export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().email(), level: levelSchema.default("reader") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireOwner, getAdminClient } = await import("./admin.server");
    await requireOwner(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { isStaffEmail, sendStaffInvite } = await import("./staff.server");
    const { writeAuditLine } = await import("./cleanup.server");

    const email = data.email.trim().toLowerCase();
    if (!isStaffEmail(email)) {
      throw new Error("Only @budigital.org addresses can join the internal team.");
    }

    const { data: existingRow } = await admin
      .from("staff_members")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();

    const invite = await sendStaffInvite(admin, {
      email,
      level: data.level,
      existing: Boolean(existingRow),
    });
    if (!invite.sent) throw new Error(invite.error ?? "Could not send the invitation.");

    // Create the staff row right away so the team list shows the invitee
    // before they sign in; the signup trigger then finds it already there.
    const userId = invite.userId ?? existingRow?.user_id ?? null;
    if (userId) {
      await admin
        .from("staff_members")
        .upsert(
          { user_id: userId, email, level: data.level, invited_by: context.userId },
          { onConflict: "user_id" },
        );
      await syncAdminRole(admin, userId, data.level, "active");
    }

    await writeAuditLine(admin, {
      actorId: context.userId,
      action: "staff_invite",
      entityType: "staff_member",
      entityId: userId,
      summary: `Invited ${email} as ${data.level}`,
      detail: { email, level: data.level },
    });
    return { ok: true, email };
  });

/** Turn the raw DB guard exceptions into sentences a human can act on. */
function translate(message: string): string {
  if (message.includes("PERPETUAL_OWNER")) {
    return "flavio@budigital.org and info@budigital.org are permanent owners — they cannot be changed or removed.";
  }
  if (message.includes("NOT_STAFF_EMAIL")) {
    return "Only @budigital.org addresses can be internal staff.";
  }
  return message;
}

/**
 * Readers must not hold the admin role anywhere: the role drives the database
 * access rules, so a reader keeps read access through the console only.
 */
async function syncAdminRole(
  admin: Awaited<ReturnType<typeof import("./admin.server").getAdminClient>>,
  userId: string,
  level: string,
  status: string,
): Promise<void> {
  if (status === "active") {
    await admin
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
  } else {
    await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "admin");
  }
  void level;
}
