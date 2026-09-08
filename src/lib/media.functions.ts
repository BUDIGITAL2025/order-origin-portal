import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const pathsSchema = z.object({
  paths: z.array(z.string().min(1).max(500)).max(60),
});

/**
 * Short-lived signed URLs for photos in the private `quote-images` bucket.
 *
 * Admins may sign any path; clients only paths inside their own folder
 * (`<user id>/...`), which matches the storage policy used at upload time.
 * External https URLs (scraped previews) are returned untouched.
 */
export const getImageUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pathsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const external = data.paths.filter((p) => /^https?:\/\//i.test(p));
    const paths = data.paths.filter((p) => !/^https?:\/\//i.test(p));
    const out: { path: string; url: string }[] = external.map((p) => ({ path: p, url: p }));
    if (paths.length === 0) return { urls: out };

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const allowed =
      isAdmin === true ? paths : paths.filter((p) => p.startsWith(`${context.userId}/`));
    if (allowed.length === 0) return { urls: out };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage
      .from("quote-images")
      .createSignedUrls(allowed, 600);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) out.push({ path: s.path, url: s.signedUrl });
    }
    return { urls: out };
  });

const setPhotosSchema = z.object({
  target: z.enum(["quote", "product"]),
  id: z.string().uuid(),
  image_urls: z.array(z.string().min(1).max(500)).max(5),
});

/** Admin: replace the photo set on a quote request or a catalogue product. */
export const adminSetPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setPhotosSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const table = data.target === "quote" ? "quote_requests" : "products";
    const { error } = await admin
      .from(table)
      .update({ image_urls: data.image_urls })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
