/**
 * Inbound shipments & stock-in fulfilment — server functions.
 *
 * Clients declare shipments and add tracking (ownership enforced inside the
 * database functions through auth.uid()). Admins count, confirm and refuse.
 * Money only ever moves through apply_wallet_transaction.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createClientProductSchema,
  declareInboundSchema,
  inboundIdSchema,
  inboundTrackingSchema,
  inboundExpectedArrivalSchema,
  confirmInboundSchema,
  refuseInboundSchema,
  stockInPriceSchema,
} from "./schemas";

const uuid = z.string().uuid();

const SHIPMENT_COLUMNS =
  "id, store_id, entity_id, status, qc, tracking_number, tracking_carrier, warehouse_reference, declared_pieces, counted_pieces, declared_cartons, counted_cartons, expected_arrival_date, has_discrepancy, fee_charged, archived_at, wallet_reference, refusal_reason, in_transit_at, received_at, completed_at, created_at";

const LINE_COLUMNS =
  "id, shipment_id, product_id, sku, product_name, declared_qty, counted_qty, products(image_urls)";

/** Short human reference used in labels, emails and the UI. */
export function shipmentRef(id: string): string {
  return `IN-${id.slice(0, 8).toUpperCase()}`;
}

// ---------------- Client ----------------

/** Stock-in SKUs in a workspace the caller owns — what can be declared. */
export const listStockInProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("products")
      .select("id, sku, product_name, variant_label, client_owned, status")
      .eq("store_id", data.storeId)
      .eq("fulfilment_model", "stock_in")
      .eq("status", "active")
      .order("product_name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** "Add my product": client-owned, stock-in only, FS- SKU per variation. */
export const createClientProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createClientProductSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Warehouse service — gated by the paid Fulfilment module.
    const { requireModule } = await import("./modules.server");
    await requireModule(context.supabase, data.storeId, "fulfilment");
    const { data: rows, error } = await context.supabase.rpc("create_client_product", {
      p_store_id: data.storeId,
      p_name: data.name,
      p_variants: data.variants.map((v) => ({ label: v.label })),
      p_image_urls: data.image_urls ?? [],
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** The client's inbound shipments for one workspace, newest first. */
export const listMyInboundShipments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ storeId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: shipments, error } = await context.supabase
      .from("inbound_shipments")
      .select(SHIPMENT_COLUMNS)
      .eq("store_id", data.storeId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const ids = (shipments ?? []).map((s) => s.id);
    if (ids.length === 0) return [];
    const { data: lines, error: lineError } = await context.supabase
      .from("inbound_shipment_lines")
      .select(LINE_COLUMNS)
      .in("shipment_id", ids);
    if (lineError) throw new Error(lineError.message);
    return (shipments ?? []).map((s) => ({
      ...s,
      ref: shipmentRef(s.id),
      lines: (lines ?? []).filter((l) => l.shipment_id === s.id),
    }));
  });

/** Declare a shipment: ≥10 units per variation, optional QC. */
export const declareInboundShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => declareInboundSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireModule } = await import("./modules.server");
    await requireModule(context.supabase, data.storeId, "fulfilment");
    const { data: row, error } = await context.supabase.rpc("declare_inbound_shipment", {
      p_store_id: data.storeId,
      p_qc: data.qc,
      p_lines: data.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
      ...(data.cartons != null ? { p_cartons: data.cartons } : {}),
      ...(data.expected_arrival ? { p_expected_arrival: data.expected_arrival } : {}),
    });
    if (error) {
      if (error.message.includes("MIN_10_UNITS")) {
        throw new Error("Every variation needs at least 10 units on an inbound shipment.");
      }
      throw new Error(error.message);
    }
    return row;
  });

/** Supplier tracking — mandatory before arrival; moves declared → in transit. */
export const setInboundTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inboundTrackingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("set_inbound_tracking", {
      p_shipment_id: data.shipment_id,
      p_tracking_number: data.tracking_number,
      p_tracking_carrier: data.tracking_carrier,
    });
    if (error) throw new Error(error.message);
    return row;
  });

/** Client: set or correct the expected arrival date (and carton count). */
export const setInboundExpectedArrival = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inboundExpectedArrivalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("set_inbound_expected_arrival", {
      p_shipment_id: data.shipment_id,
      p_expected_arrival: data.expected_arrival,
      ...(data.cartons != null ? { p_cartons: data.cartons } : {}),
    });
    if (error) throw new Error(error.message);
    return row;
  });

/** Printable SKU labels (PDF, base64) plus the matching SKU list CSV. */
export const getInboundLabels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inboundIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: shipment, error } = await context.supabase
      .from("inbound_shipments")
      .select("id, store_id, warehouse_reference, declared_cartons, expected_arrival_date")
      .eq("id", data.shipment_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!shipment) throw new Error("Shipment not found");

    const { data: lines, error: lineError } = await context.supabase
      .from("inbound_shipment_lines")
      .select(LINE_COLUMNS)
      .eq("shipment_id", shipment.id);
    if (lineError) throw new Error(lineError.message);

    const { data: store } = await context.supabase
      .from("stores")
      .select("store_name")
      .eq("id", shipment.store_id)
      .maybeSingle();

    const { renderLabelsPdf, buildSkuCsv } = await import("./inbound.server");
    const labelLines = (lines ?? []).map((l) => ({
      sku: l.sku,
      product_name: l.product_name,
      quantity: l.declared_qty,
    }));
    const pdf = await renderLabelsPdf({
      shipmentRef: shipmentRef(shipment.id),
      warehouseReference: shipment.warehouse_reference,
      workspaceName: store?.store_name ?? "Workspace",
      cartons: shipment.declared_cartons,
      expectedArrival: shipment.expected_arrival_date,
      lines: labelLines,
    });
    return {
      filename: `${shipmentRef(shipment.id)}-labels.pdf`,
      pdfBase64: Buffer.from(pdf).toString("base64"),
      csvFilename: `${shipmentRef(shipment.id)}-skus.csv`,
      csv: buildSkuCsv(labelLines),
    };
  });

// ---------------- Admin ----------------

export const adminListInboundShipments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: shipments, error } = await admin
      .from("inbound_shipments")
      .select(SHIPMENT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const ids = (shipments ?? []).map((s) => s.id);
    const [{ data: lines }, { data: stores }] = await Promise.all([
      ids.length
        ? admin.from("inbound_shipment_lines").select(LINE_COLUMNS).in("shipment_id", ids)
        : Promise.resolve({ data: [] as never[] }),
      admin.from("stores").select("id, store_name, entity_id"),
    ]);

    return (shipments ?? []).map((s) => ({
      ...s,
      ref: shipmentRef(s.id),
      workspace_name: (stores ?? []).find((w) => w.id === s.store_id)?.store_name ?? "—",
      lines: (lines ?? []).filter((l) => l.shipment_id === s.id),
    }));
  });

/**
 * Confirm receipt on COUNTED quantities: the database function stores the
 * counts, writes stock into the fulfilment-centre snapshot and debits the
 * wallet once (reference `inbound:<id>`). We then issue the receipt and email
 * the client. Insufficient balance blocks the confirmation.
 */
export const adminConfirmInboundReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => confirmInboundSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: shipment, error } = await admin.rpc("admin_confirm_inbound_receipt", {
      p_shipment_id: data.shipment_id,
      p_counts: data.counts.map((c) => ({ line_id: c.line_id, counted_qty: c.counted_qty })),
      ...(data.counted_cartons != null ? { p_counted_cartons: data.counted_cartons } : {}),
    });

    const { sendClientEmail } = await import("./email.server");
    const { inboundReceivedEmail, inboundPaymentNeededEmail } =
      await import("./email-templates.server");

    if (error) {
      if (error.message.includes("Insufficient funds")) {
        // Counted, but the wallet cannot cover the fee: tell the client.
        const { data: pending } = await admin
          .from("inbound_shipments")
          .select("id, entity_id, qc, declared_pieces")
          .eq("id", data.shipment_id)
          .maybeSingle();
        if (pending) {
          const { inboundFee } = await import("./inbound.server");
          const pieces = data.counts.reduce((sum, c) => sum + c.counted_qty, 0);
          const { data: entity } = await admin
            .from("entities")
            .select("account_id")
            .eq("id", pending.entity_id)
            .maybeSingle();
          const { data: latest } = await admin
            .from("wallet_transactions")
            .select("balance_after")
            .eq("entity_id", pending.entity_id)
            .order("created_at", { ascending: false })
            .order("seq", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (entity?.account_id) {
            const mail = inboundPaymentNeededEmail({
              shipmentRef: shipmentRef(data.shipment_id),
              fee: inboundFee(pieces, pending.qc),
              balance: latest ? Number(latest.balance_after) : 0,
            });
            await sendClientEmail(admin, {
              clientId: entity.account_id,
              subject: mail.subject,
              text: mail.text,
              html: mail.html,
            });
          }
        }
        throw new Error("Client must top up: their wallet does not cover the service fee.");
      }
      throw new Error(error.message);
    }

    const row = shipment as {
      id: string;
      entity_id: string;
      qc: boolean;
      declared_pieces: number;
      counted_pieces: number | null;
      fee_charged: string | number | null;
    };

    // Receipt (idempotent on the wallet reference).
    const { issueInboundFeeReceipt } = await import("./inbound.server");
    await issueInboundFeeReceipt(admin, row.id);

    const { data: lines } = await admin
      .from("inbound_shipment_lines")
      .select("sku, declared_qty, counted_qty")
      .eq("shipment_id", row.id);
    const discrepancies = (lines ?? [])
      .filter((l) => l.counted_qty != null && l.counted_qty !== l.declared_qty)
      .map((l) => ({ sku: l.sku, declared: l.declared_qty, counted: l.counted_qty ?? 0 }));

    const { data: entity } = await admin
      .from("entities")
      .select("account_id")
      .eq("id", row.entity_id)
      .maybeSingle();
    if (entity?.account_id) {
      const mail = inboundReceivedEmail({
        shipmentRef: shipmentRef(row.id),
        countedPieces: row.counted_pieces ?? 0,
        declaredPieces: row.declared_pieces,
        qc: row.qc,
        fee: Number(row.fee_charged ?? 0),
        discrepancies,
      });
      await sendClientEmail(admin, {
        clientId: entity.account_id,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    }

    return row;
  });

/** Refuse a shipment (no tracking, unlabelled): no charge, client emailed. */
export const adminRefuseInbound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => refuseInboundSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();

    const { data: row, error } = await admin.rpc("admin_refuse_inbound", {
      p_shipment_id: data.shipment_id,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);

    const shipment = row as { id: string; entity_id: string };
    const { data: entity } = await admin
      .from("entities")
      .select("account_id")
      .eq("id", shipment.entity_id)
      .maybeSingle();
    if (entity?.account_id) {
      const { sendClientEmail } = await import("./email.server");
      const { inboundRefusedEmail } = await import("./email-templates.server");
      const mail = inboundRefusedEmail({
        shipmentRef: shipmentRef(shipment.id),
        reason: data.reason,
      });
      await sendClientEmail(admin, {
        clientId: entity.account_id,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    }
    return shipment;
  });

/** Admin: flip a product between the two fulfilment models. */
export const adminSetFulfilmentModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ product_id: uuid, fulfilment_model: z.enum(["per_order", "stock_in"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin
      .from("products")
      .update({ fulfilment_model: data.fulfilment_model })
      .eq("id", data.product_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: the outbound fee grid for a stock-in product (variant × country). */
export const adminSaveStockInPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => stockInPriceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { error } = await admin.from("stock_in_prices").upsert(
      {
        product_id: data.product_id,
        country_code: data.country_code,
        fulfilment_fee: data.fulfilment_fee,
        shipping_price: data.shipping_price,
      },
      { onConflict: "product_id,country_code" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListStockInPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ product_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data: rows, error } = await admin
      .from("stock_in_prices")
      .select("id, country_code, fulfilment_fee, shipping_price")
      .eq("product_id", data.product_id)
      .order("country_code");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
