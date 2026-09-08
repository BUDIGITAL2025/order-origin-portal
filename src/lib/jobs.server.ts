/**
 * Data Lake foundation — generic async job runner (server-only).
 *
 * Nothing in this module knows about SEO. It gives any module (SEO today,
 * Research tomorrow) the same four guarantees the async pattern requires:
 *
 *  1. BOUNDED WORK — a tick claims at most one job and runs for a time budget.
 *  2. SINGLE FLIGHT — the claim is a conditional UPDATE on `lease_until`, so a
 *     second concurrent tick (cron + an open browser tab) claims nothing.
 *  3. IDEMPOTENT PROGRESS — each phase's result is written into the artifact
 *     payload as it completes, so a crashed job resumes at the first
 *     incomplete phase and never re-pays for a finished one.
 *  4. NEVER ALL-OR-NOTHING — a failing phase is recorded as skipped and the
 *     job carries on, finishing as 'partial'.
 *
 * jobs      — the control row (status, phase, progress, cost, error).
 * artifacts — the structured result, readable while it is still being built.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Admin = SupabaseClient<Database>;

export type JobStatus = "queued" | "running" | "done" | "failed" | "partial";
export type SectionStatus = "ok" | "skipped" | "pending";

export interface JobRow {
  id: string;
  module: string;
  kind: string;
  status: JobStatus;
  phase: string | null;
  progress_pct: number;
  error: string | null;
  params: Record<string, unknown>;
  total_cost: number;
  attempts: number;
  workspace_id: string | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One phase's slot inside the artifact payload. */
export interface ArtifactSection {
  status: SectionStatus;
  /** Phase label at the moment the section was collected. */
  phase: string;
  collectedAt: string;
  cost: number;
  error?: string;
  data?: unknown;
  /** Free-form phase state (e.g. an in-flight external task id). */
  state?: Record<string, unknown>;
}

export interface ArtifactPayload {
  sections: Record<string, ArtifactSection>;
  [key: string]: unknown;
}

export interface ArtifactRow {
  id: string;
  job_id: string;
  module: string;
  kind: string;
  status: "building" | "ready" | "failed";
  payload: ArtifactPayload;
  storage_ref: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAdmin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Admin;
}

// ---------------------------------------------------------------------------
// creation
// ---------------------------------------------------------------------------

export async function createJob(
  admin: Admin,
  args: {
    module: string;
    kind: string;
    artifactKind: string;
    params: Record<string, unknown>;
    workspaceId?: string | null;
    createdBy: string | null;
  },
): Promise<{ jobId: string; artifactId: string }> {
  const { data: job, error } = await admin
    .from("jobs")
    .insert({
      module: args.module,
      kind: args.kind,
      params: args.params as never,
      workspace_id: args.workspaceId ?? null,
      created_by: args.createdBy,
      status: "queued",
      phase: "queued",
      progress_pct: 0,
    })
    .select("id")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Could not create the job.");

  const { data: artifact, error: artifactError } = await admin
    .from("artifacts")
    .insert({
      job_id: job.id,
      module: args.module,
      kind: args.artifactKind,
      workspace_id: args.workspaceId ?? null,
      status: "building",
      payload: { sections: {} } as never,
    })
    .select("id")
    .single();
  if (artifactError || !artifact) {
    throw new Error(artifactError?.message ?? "Could not create the artifact.");
  }
  return { jobId: job.id, artifactId: artifact.id };
}

// ---------------------------------------------------------------------------
// single-flight claim
// ---------------------------------------------------------------------------

/**
 * Atomically claim the oldest unfinished job of a kind whose lease has expired.
 * The conditional UPDATE is the lock — a parallel tick sees zero rows.
 */
export async function claimNextJob(
  admin: Admin,
  args: { module: string; kind: string; leaseMs: number; jobId?: string },
): Promise<JobRow | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + args.leaseMs).toISOString();

  let query = admin
    .from("jobs")
    .update({
      status: "running",
      lease_until: leaseUntil,
      started_at: now.toISOString(),
    })
    .eq("module", args.module)
    .eq("kind", args.kind)
    .in("status", ["queued", "running"])
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`);

  if (args.jobId) query = query.eq("id", args.jobId);

  const { data, error } = await query
    .select(
      "id, module, kind, status, phase, progress_pct, error, params, total_cost, attempts, workspace_id, created_by, started_at, finished_at, created_at, updated_at",
    )
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(error.message);
  const row = (data ?? [])[0];
  if (!row) return null;
  // `started_at` must stay the first start; restore it when resuming.
  return row as unknown as JobRow;
}

export async function updateJob(
  admin: Admin,
  jobId: string,
  patch: {
    status?: JobStatus;
    phase?: string;
    progressPct?: number;
    error?: string | null;
    finishedAt?: string | null;
    releaseLease?: boolean;
    extendLeaseMs?: number;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.status) row["status"] = patch.status;
  if (patch.phase !== undefined) row["phase"] = patch.phase;
  if (patch.progressPct !== undefined) row["progress_pct"] = patch.progressPct;
  if (patch.error !== undefined) row["error"] = patch.error;
  if (patch.finishedAt !== undefined) row["finished_at"] = patch.finishedAt;
  if (patch.releaseLease) row["lease_until"] = null;
  if (patch.extendLeaseMs) {
    row["lease_until"] = new Date(Date.now() + patch.extendLeaseMs).toISOString();
  }
  if (Object.keys(row).length === 0) return;
  const { error } = await admin.from("jobs").update(row as never).eq("id", jobId);
  if (error) console.error("[jobs] update failed:", error.message);
}

/** Bump the accumulated spend of a job by the real cost a call was charged. */
export async function addJobCost(admin: Admin, jobId: string, cost: number): Promise<void> {
  if (!cost) return;
  const { data } = await admin.from("jobs").select("total_cost").eq("id", jobId).maybeSingle();
  const next = Math.round(((Number(data?.total_cost ?? 0) + cost) + Number.EPSILON) * 1e6) / 1e6;
  const { error } = await admin.from("jobs").update({ total_cost: next }).eq("id", jobId);
  if (error) console.error("[jobs] cost accumulation failed:", error.message);
}

export async function incrementAttempts(admin: Admin, jobId: string, current: number) {
  await admin.from("jobs").update({ attempts: current + 1 }).eq("id", jobId);
}

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------

export async function getArtifact(admin: Admin, jobId: string): Promise<ArtifactRow | null> {
  const { data, error } = await admin
    .from("artifacts")
    .select("id, job_id, module, kind, status, payload, storage_ref, created_at, updated_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const payload = (data.payload ?? {}) as Record<string, unknown>;
  return {
    ...data,
    payload: {
      ...payload,
      sections: (payload["sections"] ?? {}) as Record<string, ArtifactSection>,
    },
  } as ArtifactRow;
}

/**
 * Write one phase's slot into the artifact payload. Read-modify-write on a
 * single artifact row, serialised by the job lease — no lost updates.
 */
export async function writeSection(
  admin: Admin,
  artifact: ArtifactRow,
  key: string,
  section: ArtifactSection,
  extra?: Record<string, unknown>,
): Promise<ArtifactRow> {
  const payload: ArtifactPayload = {
    ...artifact.payload,
    ...(extra ?? {}),
    sections: { ...artifact.payload.sections, [key]: section },
  };
  const { error } = await admin
    .from("artifacts")
    .update({ payload: payload as never })
    .eq("id", artifact.id);
  if (error) throw new Error(error.message);
  return { ...artifact, payload };
}

export async function finishArtifact(
  admin: Admin,
  artifactId: string,
  status: "ready" | "failed",
  storageRef?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (storageRef !== undefined) patch["storage_ref"] = storageRef;
  const { error } = await admin.from("artifacts").update(patch as never).eq("id", artifactId);
  if (error) console.error("[jobs] artifact finish failed:", error.message);
}

// ---------------------------------------------------------------------------
// the phase runner
// ---------------------------------------------------------------------------

export type PhaseOutcome =
  | { kind: "done"; data: unknown; cost?: number; extra?: Record<string, unknown> }
  /** External work still in flight — keep the section pending, retry next tick. */
  | { kind: "wait"; state: Record<string, unknown>; cost?: number };

export interface PhaseDef {
  key: string;
  label: string;
  run: (ctx: {
    job: JobRow;
    artifact: ArtifactRow;
    /** Whatever the previous `wait` outcome stored. */
    state: Record<string, unknown>;
  }) => Promise<PhaseOutcome>;
}

export interface TickResult {
  jobId: string | null;
  status: JobStatus | "idle";
  phase: string | null;
  progress: number;
  ranPhases: string[];
  waiting: boolean;
  totalCost: number;
}

/**
 * Run as many phases as fit in the time budget, resuming at the first
 * incomplete one. Completed sections are never re-run, so a crash mid-run
 * costs nothing on the next tick.
 */
export async function runPhases(
  admin: Admin,
  job: JobRow,
  phases: PhaseDef[],
  opts: { budgetMs: number; leaseMs: number; onError?: (phase: string, error: unknown) => void },
): Promise<TickResult> {
  const deadline = Date.now() + opts.budgetMs;
  let artifact = await getArtifact(admin, job.id);
  if (!artifact) throw new Error("Job has no artifact.");

  const ranPhases: string[] = [];
  let waiting = false;
  let totalCost = Number(job.total_cost ?? 0);

  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i]!;
    const existing = artifact.payload.sections[phase.key];
    if (existing && existing.status !== "pending") continue;

    if (Date.now() > deadline) break;

    await updateJob(admin, job.id, {
      phase: phase.label,
      progressPct: Math.round((i / phases.length) * 100),
      extendLeaseMs: opts.leaseMs,
    });

    try {
      const outcome = await phase.run({
        job,
        artifact,
        state: (existing?.state ?? {}) as Record<string, unknown>,
      });
      const cost = Math.round((outcome.cost ?? 0) * 1e6) / 1e6;
      if (cost) {
        await addJobCost(admin, job.id, cost);
        totalCost = Math.round((totalCost + cost) * 1e6) / 1e6;
      }

      if (outcome.kind === "wait") {
        artifact = await writeSection(admin, artifact, phase.key, {
          status: "pending",
          phase: phase.label,
          collectedAt: new Date().toISOString(),
          cost: (existing?.cost ?? 0) + cost,
          state: outcome.state,
        });
        waiting = true;
        break;
      }

      artifact = await writeSection(
        admin,
        artifact,
        phase.key,
        {
          status: "ok",
          phase: phase.label,
          collectedAt: new Date().toISOString(),
          cost: (existing?.cost ?? 0) + cost,
          data: outcome.data,
        },
        outcome.extra,
      );
      ranPhases.push(phase.key);
    } catch (error) {
      // Resilience: one phase failing never kills the dossier.
      const message = error instanceof Error ? error.message : String(error);
      opts.onError?.(phase.key, error);
      artifact = await writeSection(admin, artifact, phase.key, {
        status: "skipped",
        phase: phase.label,
        collectedAt: new Date().toISOString(),
        cost: existing?.cost ?? 0,
        error: message.slice(0, 500),
      });
      ranPhases.push(phase.key);
    }
  }

  const sections = artifact.payload.sections;
  const complete = phases.every((p) => {
    const s = sections[p.key];
    return s && s.status !== "pending";
  });

  if (waiting || !complete) {
    await updateJob(admin, job.id, {
      status: "running",
      progressPct: Math.round(
        (phases.filter((p) => sections[p.key] && sections[p.key]!.status !== "pending").length /
          phases.length) *
          100,
      ),
      releaseLease: true,
    });
    return {
      jobId: job.id,
      status: "running",
      phase: job.phase,
      progress: Math.round(
        (phases.filter((p) => sections[p.key] && sections[p.key]!.status !== "pending").length /
          phases.length) *
          100,
      ),
      ranPhases,
      waiting,
      totalCost,
    };
  }

  const anySkipped = phases.some((p) => sections[p.key]?.status === "skipped");
  const finalStatus: JobStatus = anySkipped ? "partial" : "done";
  await updateJob(admin, job.id, {
    status: finalStatus,
    phase: "finished",
    progressPct: 100,
    finishedAt: new Date().toISOString(),
    releaseLease: true,
    error: anySkipped
      ? phases
          .filter((p) => sections[p.key]?.status === "skipped")
          .map((p) => `${p.label}: ${sections[p.key]?.error ?? "skipped"}`)
          .join(" · ")
          .slice(0, 1000)
      : null,
  });
  await finishArtifact(admin, artifact.id, "ready");

  return {
    jobId: job.id,
    status: finalStatus,
    phase: "finished",
    progress: 100,
    ranPhases,
    waiting: false,
    totalCost,
  };
}
