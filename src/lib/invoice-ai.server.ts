/**
 * Supplier-invoice reading — server-only.
 *
 * Same pattern as the catalogue import: one AI call per upload, strict JSON
 * schema, transcription only. The model NEVER decides anything: it reads the
 * document and the platform compares the total against what we agreed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
export const INVOICE_MODEL = "openai/gpt-6-astra";
export const MAX_INVOICE_BYTES = 15 * 1024 * 1024;

export type InvoiceLine = {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
};

export type InvoiceExtract = {
  invoice_number: string | null;
  invoice_date: string | null;
  supplier_name: string | null;
  currency: string | null;
  total_amount: number | null;
  bank_details: string | null;
  lines: InvoiceLine[];
};

const lineProps = {
  description: { type: ["string", "null"] },
  quantity: { type: ["number", "null"] },
  unit_price: { type: ["number", "null"] },
  amount: { type: ["number", "null"] },
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    invoice_number: { type: ["string", "null"] },
    invoice_date: { type: ["string", "null"] },
    supplier_name: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    total_amount: { type: ["number", "null"] },
    bank_details: { type: ["string", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: lineProps,
        required: Object.keys(lineProps),
        additionalProperties: false,
      },
    },
  },
  required: [
    "invoice_number",
    "invoice_date",
    "supplier_name",
    "currency",
    "total_amount",
    "bank_details",
    "lines",
  ],
  additionalProperties: false,
};

const PROMPT = `You transcribe supplier invoices (proforma or commercial) into structured data.

Rules, without exception:
- Transcribe faithfully what is printed. NEVER invent, guess or complete a value.
- Anything absent or unreadable is null.
- total_amount is the grand total payable as a plain number, no currency symbol or separators.
- currency is the ISO code when printed (USD, CNY, EUR); null when not stated.
- invoice_date as printed (ISO if possible).
- bank_details is a single short text with the beneficiary/bank/account/SWIFT when printed, otherwise null.
- One entry in lines per printed invoice line.`;

async function readStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The invoice reader returned no data.");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt: { type?: string; delta?: string; response?: { output_text?: string } };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          text += evt.delta;
        } else if (evt.type === "response.completed" && typeof evt.response?.output_text === "string") {
          completed = evt.response.output_text || completed;
        }
      }
    }
  }
  return text || completed;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null;
}

export async function extractSupplierInvoice(args: {
  base64: string;
  mimeType: string;
  fileName: string;
}): Promise<{ extract: InvoiceExtract; raw: string; durationMs: number; model: string }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("The invoice reader is not configured yet.");

  const dataUrl = `data:${args.mimeType};base64,${args.base64}`;
  const filePart =
    args.mimeType === "application/pdf"
      ? { type: "input_file", filename: args.fileName, file_data: dataUrl }
      : { type: "input_image", image_url: dataUrl, detail: "high" };

  const started = Date.now();
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: INVOICE_MODEL,
      stream: true,
      reasoning: { effort: "low" },
      input: [{ role: "user", content: [{ type: "input_text", text: PROMPT }, filePart] }],
      text: { format: { type: "json_schema", name: "supplier_invoice", strict: true, schema: SCHEMA } },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("The invoice reader is busy — try again in a minute.");
    if (res.status === 402)
      throw new Error("AI credits are exhausted — top them up to keep reading invoices.");
    throw new Error(`Invoice reading failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const raw = await readStream(res);
  const durationMs = Date.now() - started;

  let extract: InvoiceExtract = {
    invoice_number: null,
    invoice_date: null,
    supplier_name: null,
    currency: null,
    total_amount: null,
    bank_details: null,
    lines: [],
  };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    extract = {
      invoice_number: str(parsed["invoice_number"]),
      invoice_date: str(parsed["invoice_date"]),
      supplier_name: str(parsed["supplier_name"]),
      currency: str(parsed["currency"]),
      total_amount: num(parsed["total_amount"]),
      bank_details: str(parsed["bank_details"]),
      lines: Array.isArray(parsed["lines"])
        ? (parsed["lines"] as Record<string, unknown>[]).slice(0, 200).map((l) => ({
            description: str(l["description"]),
            quantity: num(l["quantity"]),
            unit_price: num(l["unit_price"]),
            amount: num(l["amount"]),
          }))
        : [],
    };
  } catch {
    // Keep the empty extract: the agent still sees the file and can type the
    // total manually rather than losing the upload.
  }

  return { extract, raw, durationMs, model: INVOICE_MODEL };
}

/** Audit row, same table the catalogue import writes to. */
export async function logInvoiceAiCall(
  admin: SupabaseClient<Database>,
  args: {
    purchaseId: string;
    userId: string;
    durationMs: number;
    status: "ok" | "error";
    error?: string | null;
  },
): Promise<void> {
  try {
    await admin.from("ai_calls").insert({
      provider: "lovable-ai-gateway",
      model: INVOICE_MODEL,
      operation: "supplier_invoice_extract",
      duration_ms: args.durationMs,
      status: args.status,
      error: args.error ?? null,
      ref_table: "stock_purchases",
      ref_id: args.purchaseId,
      created_by: args.userId,
    });
  } catch (e) {
    console.error("[invoice-ai] audit insert failed", e);
  }
}
