import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Minimal server-side observability.
 *
 * cron_runs  — one row per scheduled execution so a silent failure is visible.
 * error_logs — unhandled endpoint errors and failed Stripe webhook processing.
 *
 * Both helpers swallow their own failures: observability must never break a
 * money path.
 */

export async function logAppError(
  admin: Admin,
  args: { job: string; context?: unknown; error: unknown },
): Promise<void> {
  try {
    const message =
      args.error instanceof Error
        ? `${args.error.name}: ${args.error.message}`
        : String(args.error);
    await admin.from("error_logs").insert({
      job: args.job,
      context: (args.context ?? null) as never,
      error: message.slice(0, 2000),
    });
  } catch (e) {
    console.error("[ops] failed to record error log:", e);
  }
}

/** Wraps a cron handler: records start, outcome and error in cron_runs. */
export async function runCronJob<T>(
  admin: Admin,
  job: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; error: unknown }> {
  const startedAt = new Date().toISOString();
  try {
    const result = await fn();
    try {
      await admin.from("cron_runs").insert({
        job,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ok: true,
        detail: (result ?? null) as never,
      });
    } catch (e) {
      console.error("[ops] failed to record cron run:", e);
    }
    return { ok: true, result };
  } catch (error) {
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    try {
      await admin.from("cron_runs").insert({
        job,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        ok: false,
        error: message.slice(0, 2000),
      });
    } catch (e) {
      console.error("[ops] failed to record cron run:", e);
    }
    await logAppError(admin, { job: `cron:${job}`, error });
    return { ok: false, error };
  }
}
