/**
 * Supplier-catalog extraction. Server-only: the AI key never leaves here.
 *
 * One import run = one AI call. The file (PDF or image) is sent to the
 * Lovable AI Gateway Responses API with a strict transcription prompt and a
 * strict JSON schema, so the model can only answer with rows. Nothing here
 * ever creates a quote, product or price — it only produces draft rows.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
export const CATALOG_MODEL = "openai/gpt-6-astra";
export const MAX_CATALOG_BYTES = 15 * 1024 * 1024;
export const MAX_CATALOG_PAGES = 10;

export type ExtractedRow = {
  page_no: number;
  row_ref: string | null;
  item_no: string | null;
  description: string | null;
  color: string | null;
  size_text: string | null;
  packaging: string | null;
  inner_qty: number | null;
  outer_qty: number | null;
  available_qty: number | null;
  weight_g: number | null;
  unit_price: number | null;
  /** Normalised 0-1 crop hint for the row's product photo on its page. */
  bbox: { x: number; y: number; w: number; h: number } | null;
  low_confidence: string[];
};

const rowProps = {
  page_no: { type: "integer" },
  row_ref: { type: ["string", "null"] },
  item_no: { type: ["string", "null"] },
  description: { type: ["string", "null"] },
  color: { type: ["string", "null"] },
  size_text: { type: ["string", "null"] },
  packaging: { type: ["string", "null"] },
  inner_qty: { type: ["integer", "null"] },
  outer_qty: { type: ["integer", "null"] },
  available_qty: { type: ["integer", "null"] },
  weight_g: { type: ["number", "null"] },
  unit_price: { type: ["number", "null"] },
  bbox: {
    type: ["object", "null"],
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      w: { type: "number" },
      h: { type: "number" },
    },
    required: ["x", "y", "w", "h"],
    additionalProperties: false,
  },
  low_confidence: { type: "array", items: { type: "string" } },
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: rowProps,
        required: Object.keys(rowProps),
        additionalProperties: false,
      },
    },
  },
  required: ["rows"],
  additionalProperties: false,
};

const PROMPT = `You transcribe supplier catalogues into structured rows.

Rules, without exception:
- Transcribe faithfully what is printed. NEVER invent, guess or complete a value.
- A cell that is empty, unreadable or absent from the catalogue is null. Many catalogues have no prices — then unit_price is null everywhere.
- One row per catalogue line (per item/colour/size combination as printed).
- page_no is the 1-based page the row appears on. row_ref is the printed row/line reference or position (e.g. "p2 r7") so a human can find it again.
- Quantities are integers without separators. weight_g is grams as a number.
- bbox is the product photo's position on its page as fractions of page width/height (x, y = top-left corner). Null when the row has no photo.
- low_confidence lists the field names whose value you are unsure about (e.g. ["available_qty","weight_g"]). Empty array when confident.

Return every row you can read, in printed order.`;

export type ExtractionResult = {
  rows: ExtractedRow[];
  raw: string;
  durationMs: number;
  model: string;
};

/** Read the SSE stream and join the output text deltas. */
async function readResponsesStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The extraction service returned no data.");
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
        let evt: {
          type?: string;
          delta?: string;
          response?: { output_text?: string; output?: unknown };
        };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          text += evt.delta;
        } else if (evt.type === "response.completed" && evt.response) {
          const out = evt.response.output_text;
          if (typeof out === "string" && out) completed = out;
        }
      }
    }
  }
  return text || completed;
}

function clampRow(raw: Record<string, unknown>): ExtractedRow {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);
  const box = raw["bbox"] as Record<string, unknown> | null | undefined;
  const inRange = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
  const conf = raw["low_confidence"];
  return {
    page_no: Math.max(1, int(raw["page_no"]) ?? 1),
    row_ref: str(raw["row_ref"]),
    item_no: str(raw["item_no"]),
    description: str(raw["description"]),
    color: str(raw["color"]),
    size_text: str(raw["size_text"]),
    packaging: str(raw["packaging"]),
    inner_qty: int(raw["inner_qty"]),
    outer_qty: int(raw["outer_qty"]),
    available_qty: int(raw["available_qty"]),
    weight_g: num(raw["weight_g"]),
    unit_price: num(raw["unit_price"]),
    bbox:
      box && inRange(box["x"]) && inRange(box["y"]) && inRange(box["w"]) && inRange(box["h"])
        ? {
            x: box["x"] as number,
            y: box["y"] as number,
            w: box["w"] as number,
            h: box["h"] as number,
          }
        : null,
    low_confidence: Array.isArray(conf)
      ? conf.filter((f): f is string => typeof f === "string").slice(0, 20)
      : [],
  };
}

/** One AI call per import run. Throws with a readable message on failure. */
export async function extractCatalog(args: {
  base64: string;
  mimeType: string;
  fileName: string;
  pageCount: number;
}): Promise<ExtractionResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("The catalogue reader is not configured yet.");

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
      model: CATALOG_MODEL,
      stream: true,
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: PROMPT }, filePart],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "catalog_rows",
          strict: true,
          schema: SCHEMA,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429)
      throw new Error("The catalogue reader is busy — try again in a minute.");
    if (res.status === 402)
      throw new Error("AI credits are exhausted — top them up to keep reading catalogues.");
    throw new Error(`Extraction failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const raw = await readResponsesStream(res);
  const durationMs = Date.now() - started;

  let rows: ExtractedRow[] = [];
  try {
    const parsed = JSON.parse(raw) as { rows?: unknown };
    if (Array.isArray(parsed.rows)) {
      rows = parsed.rows
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map(clampRow)
        .slice(0, 1000);
    }
  } catch {
    // Left empty on purpose: the caller shows the raw attempt plus a manual
    // fallback rather than failing the whole import.
  }

  return { rows, raw, durationMs, model: CATALOG_MODEL };
}
