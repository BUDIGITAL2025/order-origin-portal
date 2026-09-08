import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const cleanupTypeSchema = z.enum([
  "quote",
  "product",
  "order",
  "stock_purchase",
  "inbound",
  "account",
]);

const targetSchema = z.object({
  type: cleanupTypeSchema,
  id: z.string().uuid(),
});

const archiveSchema = targetSchema.extend({ archived: z.boolean() });

/** Admin: can this record be hard-deleted, and what would go with it? */
export const adminCleanupCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { runCleanupCheck } = await import("./cleanup.server");
    return runCleanupCheck(admin, data.type, data.id);
  });

/** Admin: hard delete, refused when any money trail exists. Always audited. */
export const adminCleanupDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { runCleanupCheck, runCleanupDelete, writeAuditLine } = await import(
      "./cleanup.server"
    );

    const check = await runCleanupCheck(admin, data.type, data.id);
    if (!check.deletable) {
      throw new Error(
        `This cannot be deleted: ${check.blockers.join(", ")}. Archive it instead.`,
      );
    }
    await runCleanupDelete(admin, data.type, data.id);
    await writeAuditLine(admin, {
      actorId: context.userId,
      action: "delete",
      entityType: data.type,
      entityId: data.id,
      summary: `Deleted ${data.type}: ${check.label}`,
      detail: { cascade: check.cascade },
    });
    return { ok: true, label: check.label };
  });

/** Admin: archive or restore. Archived rows drop out of the default lists. */
export const adminSetArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => archiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { ARCHIVE_TARGET, writeAuditLine } = await import("./cleanup.server");

    const target = ARCHIVE_TARGET[data.type];
    const patch: Record<string, unknown> = {
      archived_at: data.archived ? new Date().toISOString() : null,
    };
    // Archiving an account also suspends it, so nobody can keep using it.
    if (data.type === "account") patch["status"] = data.archived ? "suspended" : "active";

    const { error } = await (admin.from(target.table as never) as never as {
      update: (p: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
    })
      .update(patch)
      .eq(target.column, data.id);
    if (error) throw new Error(error.message);

    await writeAuditLine(admin, {
      actorId: context.userId,
      action: data.archived ? "archive" : "restore",
      entityType: data.type,
      entityId: data.id,
      summary: `${data.archived ? "Archived" : "Restored"} ${data.type} ${data.id}`,
    });
    return { ok: true };
  });

/** Admin: the cleanup trail. */
export const adminListAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from("admin_audit_log")
      .select("id, action, entity_type, entity_id, summary, created_at, actor_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { entries: data ?? [] };
  });
