/**
 * Admin-only server functions for the Full SEO study (Phase 3).
 * Thin wrappers: verify the admin role, then delegate to seo-study.server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const domainField = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .transform((v) =>
    v
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "")
      .toLowerCase(),
  );

/** Free: the worst-case cost of a full study, phase by phase. */
export const seoStudyEstimate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const study = await import("./seo-study.server");
    const estimate = await study.estimateStudyCost();
    return { ...estimate, limits: study.STUDY_LIMITS };
  });

/** Queue a study. Returns immediately — the cron tick does the work. */
export const startSeoStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        target: domainField,
        locationCode: z.number().int().default(2620),
        languageCode: z.string().min(2).max(8).default("pt"),
        marketLabel: z.string().min(2).max(80).default("Portugal"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const jobs = await import("./jobs.server");
    const study = await import("./seo-study.server");
    const admin = await jobs.getAdmin();

    const { jobId } = await jobs.createJob(admin, {
      module: study.SEO_MODULE,
      kind: study.SEO_STUDY_KIND,
      artifactKind: study.SEO_DOSSIER_KIND,
      params: {
        target: data.target,
        locationCode: data.locationCode,
        languageCode: data.languageCode,
        marketLabel: data.marketLabel,
      },
      createdBy: context.userId,
    });
    return { jobId };
  });

/** All studies, newest first. */
export const listSeoStudies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const jobs = await import("./jobs.server");
    const study = await import("./seo-study.server");
    return study.listStudies(await jobs.getAdmin(), 50);
  });

/** One dossier — readable while the job is still running. */
export const getSeoStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const jobs = await import("./jobs.server");
    const study = await import("./seo-study.server");
    return study.getStudy(await jobs.getAdmin(), data.jobId);
  });

/**
 * Advance the pipeline once from the browser, so an admin watching a dossier
 * sees phases land without waiting for the next cron minute. The job lease
 * makes a collision with the cron a harmless no-op.
 */
export const tickSeoStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const jobs = await import("./jobs.server");
    const study = await import("./seo-study.server");
    return study.tickStudies(await jobs.getAdmin(), data.jobId);
  });

/** Render (once) and hand back a signed URL to the branded dossier PDF. */
export const seoStudyPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), rebuild: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const jobs = await import("./jobs.server");
    const study = await import("./seo-study.server");
    const admin = await jobs.getAdmin();

    const dossier = await study.getStudy(admin, data.jobId);
    if (!dossier) throw new Error("Study not found.");

    let path = dossier.storageRef;
    if (!path || data.rebuild) {
      const { renderStudyPdf } = await import("./seo-study-pdf.server");
      const bytes = await renderStudyPdf(dossier);
      path = `seo-study/${data.jobId}.pdf`;
      const { error } = await admin.storage
        .from(study.STUDY_BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (error) throw new Error(error.message);
      await jobs.finishArtifact(
        admin,
        dossier.artifactId,
        dossier.job.status === "failed" ? "failed" : "ready",
        path,
      );
    }

    const { data: signed, error: signError } = await admin.storage
      .from(study.STUDY_BUCKET)
      .createSignedUrl(path, 300);
    if (signError || !signed) throw new Error(signError?.message ?? "Could not sign the PDF.");
    return { url: signed.signedUrl, fileName: `flysales-seo-${dossier.job.target}.pdf` };
  });
