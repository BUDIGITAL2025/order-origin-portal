/**
 * Catalog import — admin-only server functions.
 *
 * Extraction produces DRAFT rows only. Quotes and products are created only
 * by an explicit convert action, after a human has reviewed the table.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const uuid = z.string().uuid();

const startImportSchema = z.object({
  file_path: z.string().min(3).max(500),
  file_name: z.string().min(1).max(200),
  mime_type: z.enum(["application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp"]),
  page_count: z.number().int().min(1).max(10).default(1),
  store_id: uuid.optional(),
});

const rowPatchSchema = z.object({
  row_id: uuid,
  patch: z.object({
    item_no: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    color: z.string().trim().max(200).nullable().optional(),
    size_text: z.string().trim().max(200).nullable().optional(),
    packaging: z.string().trim().max(200).nullable().optional(),
    inner_qty: z.number().int().min(0).max(10_000_000).nullable().optional(),
    outer_qty: z.number().int().min(0).max(10_000_000).nullable().optional(),
    available_qty: z.number().int().min(0).max(100_000_000).nullable().optional(),
    weight_g: z.number().min(0).max(10_000_000).nullable().optional(),
    unit_price: z.number().min(0).max(1_000_000).nullable().optional(),
    included: z.boolean().optional(),
    image_urls: z.array(z.string().max(500)).max(5).optional(),
  }),
});

const convertQuoteSchema = z.object({
  import_id: uuid,
  row_ids: z.array(uuid).min(1, "Select at least one row").max(200),
  store_id: uuid,
  mode: z.enum(["single_product", "product_per_row"]),
  product_name: z.string().trim().min(2, "Give the product a name").max(200),
  country_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a 2-letter country code"),
});

const convertProductsSchema = z.object({
  import_id: uuid,
  row_ids: z.array(uuid).min(1, "Select at least one row").max(200),
  store_id: uuid,
  product_name: z.string().trim().min(2, "Give the product a name").max(200),
});

function variantLabel(row: {
  color: string | null;
  size_text: string | null;
  item_no: string | null;
  description: string | null;
}): string {
  const parts = [row.color, row.size_text].filter(Boolean) as string[];
  if (parts.length) return parts.join(" / ").slice(0, 120);
  return (row.item_no || row.description || "Variant").slice(0, 120);
}

/** Admin: run one extraction over an uploaded catalogue file. */
export const startCatalogImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => startImportSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    const { extractCatalog, MAX_CATALOG_BYTES } = await import("./catalog.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: file, error: dlError } = await admin.storage
      .from("quote-images")
      .download(data.file_path);
    if (dlError || !file) throw new Error("Could not read the uploaded file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_CATALOG_BYTES) throw new Error("The file is larger than 15MB.");

    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const base64 = btoa(binary);

    const { data: imp, error: impError } = await admin
      .from("catalog_imports")
      .insert({
        created_by: context.userId,
        store_id: data.store_id ?? null,
        file_path: data.file_path,
        file_name: data.file_name,
        mime_type: data.mime_type,
        page_count: data.page_count,
        status: "processing",
      })
      .select("id")
      .single();
    if (impError || !imp) throw new Error(impError?.message ?? "Could not start the import.");

    try {
      const result = await extractCatalog({
        base64,
        mimeType: data.mime_type,
        fileName: data.file_name,
        pageCount: data.page_count,
      });

      if (result.rows.length) {
        const { error: rowsError } = await admin.from("catalog_import_rows").insert(
          result.rows.map((r, i) => ({
            import_id: imp.id,
            page_no: r.page_no,
            row_ref: r.row_ref,
            item_no: r.item_no,
            description: r.description,
            color: r.color,
            size_text: r.size_text,
            packaging: r.packaging,
            inner_qty: r.inner_qty,
            outer_qty: r.outer_qty,
            available_qty: r.available_qty,
            weight_g: r.weight_g,
            unit_price: r.unit_price,
            bbox: r.bbox,
            low_confidence: r.low_confidence,
            sort_order: i,
          })),
        );
        if (rowsError) throw new Error(rowsError.message);
      }

      await admin
        .from("catalog_imports")
        .update({
          status: result.rows.length ? "ready" : "empty",
          raw_response: result.raw.slice(0, 200_000),
          model: result.model,
          duration_ms: result.durationMs,
        })
        .eq("id", imp.id);

      await admin.from("ai_calls").insert({
        provider: "lovable-ai",
        model: result.model,
        operation: "catalog_extract",
        pages: data.page_count,
        duration_ms: result.durationMs,
        status: result.rows.length ? "ok" : "empty",
        ref_table: "catalog_imports",
        ref_id: imp.id,
        created_by: context.userId,
      });

      return { import_id: imp.id, rows: result.rows.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Extraction failed";
      await admin
        .from("catalog_imports")
        .update({ status: "failed", error: message })
        .eq("id", imp.id);
      await admin.from("ai_calls").insert({
        provider: "lovable-ai",
        model: "openai/gpt-6-astra",
        operation: "catalog_extract",
        pages: data.page_count,
        status: "error",
        error: message,
        ref_table: "catalog_imports",
        ref_id: imp.id,
        created_by: context.userId,
      });
      throw new Error(message);
    }
  });

/** Admin: recent imports. */
export const listCatalogImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from("catalog_imports")
      .select("id, file_name, mime_type, page_count, status, created_at, store_id")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Admin: one import with its draft rows and a signed link to the source file. */
export const getCatalogImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ import_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: imp, error } = await admin
      .from("catalog_imports")
      .select("*")
      .eq("id", data.import_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!imp) throw new Error("Import not found");

    const { data: rows, error: rowsError } = await admin
      .from("catalog_import_rows")
      .select("*")
      .eq("import_id", data.import_id)
      .order("sort_order", { ascending: true });
    if (rowsError) throw new Error(rowsError.message);

    const { data: signed } = await admin.storage
      .from("quote-images")
      .createSignedUrl(imp.file_path, 60 * 60);

    return { import: imp, rows: rows ?? [], file_url: signed?.signedUrl ?? null };
  });

/** Admin: edit one extracted cell (or include/exclude the row). */
export const updateCatalogRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rowPatchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    type RowUpdate =
      import("@/integrations/supabase/types").Database["public"]["Tables"]["catalog_import_rows"]["Update"];
    const patch = Object.fromEntries(
      Object.entries(data.patch).filter(([, v]) => v !== undefined),
    ) as RowUpdate;
    const { error } = await admin.from("catalog_import_rows").update(patch).eq("id", data.row_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: add an empty row by hand (fallback when extraction misses rows). */
export const addCatalogRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ import_id: uuid, page_no: z.number().int().min(1).max(50).default(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { count } = await admin
      .from("catalog_import_rows")
      .select("id", { count: "exact", head: true })
      .eq("import_id", data.import_id);
    const { data: row, error } = await admin
      .from("catalog_import_rows")
      .insert({ import_id: data.import_id, page_no: data.page_no, sort_order: count ?? 0 })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteCatalogRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ row_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin.from("catalog_import_rows").delete().eq("id", data.row_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin: turn selected rows into DRAFT quote request(s) for a workspace.
 * Normal sourcing, pricing and publishing apply afterwards — nothing here
 * sets a client price.
 */
export const convertRowsToQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => convertQuoteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: rows, error } = await admin
      .from("catalog_import_rows")
      .select("*")
      .eq("import_id", data.import_id)
      .in("id", data.row_ids)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("No rows selected");

    const groups = data.mode === "single_product" ? [rows] : rows.map((r) => [r] as typeof rows);
    const createdQuoteIds: string[] = [];

    for (const group of groups) {
      const first = group[0]!;
      const name =
        data.mode === "single_product"
          ? data.product_name
          : `${data.product_name} — ${first.item_no || variantLabel(first)}`;

      const { data: quote, error: quoteError } = await admin
        .from("quote_requests")
        .insert({
          store_id: data.store_id,
          product_name: name.slice(0, 200),
          product_url: `https://app.flysales.app/catalog-import/${data.import_id}`,
          notes: `Imported from supplier catalogue (${group.length} row${group.length === 1 ? "" : "s"}).`,
          target_countries: [data.country_code],
          image_urls: group.flatMap((r) => r.image_urls).slice(0, 10),
          status: "submitted",
        })
        .select("id")
        .single();
      if (quoteError || !quote)
        throw new Error(quoteError?.message ?? "Could not create the quote");
      createdQuoteIds.push(quote.id);

      for (const row of group) {
        const { data: sku } = await admin.rpc("generate_sku", { p_prefix: "FS" });
        const notes = [
          row.item_no ? `Item no: ${row.item_no}` : null,
          row.packaging ? `Packaging: ${row.packaging}` : null,
          row.inner_qty != null ? `Inner qty: ${row.inner_qty}` : null,
          row.outer_qty != null ? `Outer qty: ${row.outer_qty}` : null,
          row.available_qty != null ? `Available: ${row.available_qty}` : null,
          row.weight_g != null ? `Weight: ${row.weight_g} g` : null,
          row.unit_price != null ? `Catalogue price: ${row.unit_price}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

        const { error: lineError } = await admin.from("quote_lines").insert({
          quote_request_id: quote.id,
          sku: sku ?? `FS-${Date.now()}`,
          status: "pending",
          variant_label: variantLabel(row),
          country_code: data.country_code,
          moq: row.inner_qty ?? null,
          sourcing_notes: notes || null,
          sourcing_image_urls: row.image_urls ?? [],
        });
        if (lineError) throw new Error(lineError.message);
      }

      await admin.from("quote_request_internal").upsert(
        {
          quote_request_id: quote.id,
          internal_reference: (first.item_no || "").slice(0, 120) || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "quote_request_id" },
      );

      await admin
        .from("catalog_import_rows")
        .update({ converted_quote_id: quote.id })
        .in(
          "id",
          group.map((r) => r.id),
        );
    }

    return { quote_ids: createdQuoteIds };
  });

/** Admin: turn selected rows into client-owned stock-in catalogue products. */
export const convertRowsToProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => convertProductsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: rows, error } = await admin
      .from("catalog_import_rows")
      .select("*")
      .eq("import_id", data.import_id)
      .in("id", data.row_ids)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("No rows selected");

    const created: { id: string; sku: string }[] = [];
    for (const row of rows) {
      const { data: sku } = await admin.rpc("generate_sku", { p_prefix: "FS" });
      const { data: product, error: prodError } = await admin
        .from("products")
        .insert({
          store_id: data.store_id,
          sku: sku ?? `FS-${Date.now()}`,
          product_name: data.product_name.slice(0, 200),
          variant_label: variantLabel(row),
          fulfilment_model: "stock_in",
          client_owned: true,
          status: "active",
          image_urls: row.image_urls ?? [],
          ...(row.weight_g != null ? { weight_grams: Math.round(row.weight_g) } : {}),
        })
        .select("id, sku")
        .single();
      if (prodError || !product) throw new Error(prodError?.message ?? "Could not create product");
      created.push(product);
      await admin
        .from("catalog_import_rows")
        .update({ converted_product_id: product.id })
        .eq("id", row.id);
    }
    return { products: created };
  });

/** Admin: workspaces to attach a converted catalogue to. */
export const listWorkspacesForImport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from("stores")
      .select("id, store_name, store_url")
      .order("store_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
