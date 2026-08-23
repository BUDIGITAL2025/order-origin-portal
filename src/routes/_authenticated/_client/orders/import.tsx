import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileUp } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { getCurrentStoreId } from "@/components/store-switcher";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { validateAddressFields } from "@/lib/address";
import { formatUSD } from "@/lib/format";
import { importMyManualOrders } from "@/lib/orders.functions";
import { manualOrderGroupSchema } from "@/lib/schemas";
import { useMyContext } from "../../_client";

export const Route = createFileRoute("/_authenticated/_client/orders/import")({
  head: () => ({
    meta: [
      { title: "Import orders — FlySales" },
      { name: "description", content: "Bulk-import manual orders from a CSV file." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ImportOrdersPage,
});

/**
 * CSV columns (header row required):
 * client_reference, name, email, phone, address1, address2, city,
 * postal_code, state, country, sku, quantity
 * Rows sharing a client_reference become ONE order with several lines.
 */
const COLUMNS = [
  "client_reference",
  "name",
  "email",
  "phone",
  "address1",
  "address2",
  "city",
  "postal_code",
  "state",
  "country",
  "sku",
  "quantity",
] as const;

type CsvRow = Record<(typeof COLUMNS)[number], string>;

/** Minimal CSV parser — handles quoted fields, commas and escaped quotes. */
function parseCsv(text: string): { rows: CsvRow[]; error: string | null } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((c) => c.trim() !== "")) records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  record.push(field);
  if (record.some((c) => c.trim() !== "")) records.push(record);

  if (records.length === 0) return { rows: [], error: "The file is empty" };
  const header = records[0]!.map((h) => h.trim().toLowerCase());
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], error: `Missing columns: ${missing.join(", ")}` };
  }
  const idx = new Map(COLUMNS.map((c) => [c, header.indexOf(c)] as const));
  const rows = records.slice(1).map((rec) => {
    const row = {} as CsvRow;
    for (const col of COLUMNS) row[col] = (rec[idx.get(col)!] ?? "").trim();
    return row;
  });
  return { rows, error: null };
}

interface PreviewOrder {
  key: string;
  reference: string;
  customer: string;
  country: string;
  lines: { sku: string; quantity: number }[];
  group: {
    client_reference: string;
    customer: { name: string; email: string; phone: string };
    address: {
      address1: string;
      address2: string;
      city: string;
      postal_code: string;
      state: string;
      country: string;
    };
    lines: { sku: string; quantity: number }[];
  } | null;
  errors: string[];
}

/** Group rows by client_reference and validate every group up front. */
function buildPreview(rows: CsvRow[]): PreviewOrder[] {
  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = row.client_reference || `__row_${groups.size}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const first = groupRows[0]!;
    const errors: string[] = [];
    if (!first.client_reference) errors.push("client_reference is required (it groups lines into one order)");

    const address = {
      address1: first.address1,
      address2: first.address2,
      city: first.city,
      postal_code: first.postal_code,
      state: first.state,
      country: first.country.toUpperCase(),
    };
    const candidate = {
      client_reference: first.client_reference,
      customer: { name: first.name, email: first.email, phone: first.phone },
      address,
      lines: groupRows.map((r) => ({ sku: r.sku, quantity: Number(r.quantity) })),
    };

    const parsed = manualOrderGroupSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${issue.path.join(".")}: ${issue.message}`);
      }
    } else {
      const addrErrors = validateAddressFields({
        name: first.name,
        email: first.email,
        phone: first.phone,
        ...address,
      });
      for (const [field, message] of Object.entries(addrErrors)) {
        errors.push(`${field}: ${message}`);
      }
    }
    for (const r of groupRows) {
      if (!Number.isInteger(Number(r.quantity)) || Number(r.quantity) < 1) {
        errors.push(`quantity "${r.quantity}" for SKU ${r.sku} is not a positive integer`);
      }
    }

    return {
      key,
      reference: first.client_reference,
      customer: first.name,
      country: first.country.toUpperCase(),
      lines: candidate.lines,
      group: errors.length === 0 && parsed.success ? parsed.data : null,
      errors,
    };
  });
}

const TEMPLATE = `client_reference,name,email,phone,address1,address2,city,postal_code,state,country,sku,quantity
ORDER-1001,Jane Doe,jane@example.com,+14155552671,1 Main St,,Springfield,62701,IL,US,FS-00001,2
ORDER-1001,Jane Doe,jane@example.com,+14155552671,1 Main St,,Springfield,62701,IL,US,FS-00002,1`;

function ImportOrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const callImport = useServerFn(importMyManualOrders);
  const { data: ctx } = useMyContext();

  const [storeId, setStoreId] = useState<string | null>(null);
  useEffect(() => {
    setStoreId(getCurrentStoreId());
  }, []);
  const allStores = ctx?.entities?.flatMap((e) => e.stores) ?? [];
  const store = allStores.find((s) => s.id === storeId) ?? allStores[0] ?? null;

  const [preview, setPreview] = useState<PreviewOrder[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(file: File) {
    setParseError(null);
    void file.text().then((text) => {
      const { rows, error } = parseCsv(text);
      if (error) {
        setParseError(error);
        setPreview(null);
        return;
      }
      setPreview(buildPreview(rows));
    });
  }

  const validOrders = (preview ?? []).filter((p) => p.group);
  const invalidCount = (preview ?? []).length - validOrders.length;

  async function submitAll() {
    if (!store || validOrders.length === 0) return;
    setBusy(true);
    try {
      const result = await callImport({
        data: {
          store_id: store.id,
          orders: validOrders.map((p) => p.group!),
        },
      });
      const paid = result.orders.filter((o) => o.status === "paid").length;
      toast.success(
        `${result.orders.length} order${result.orders.length === 1 ? "" : "s"} imported` +
          (paid > 0 ? ` — ${paid} paid from your wallet` : ""),
      );
      await queryClient.invalidateQueries({ queryKey: ["my-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["my-wallet"] });
      await navigate({ to: "/orders" });
    } catch (err) {
      // All-or-nothing: the DB rolled the whole import back.
      toast.error(err instanceof Error ? err.message : "Import failed — nothing was imported");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <Link
        to="/orders"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All orders
      </Link>
      <PageHeader
        title="Import orders"
        description="Bulk-create manual orders from a CSV. Every order is validated first; if any group fails, nothing is imported."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">CSV file</CardTitle>
          <CardDescription>
            Required columns: {COLUMNS.join(", ")}. Rows sharing a client_reference become one
            order with several lines.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <FileUp className="mr-2 h-4 w-4" />
                Choose CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => {
                const blob = new Blob([TEMPLATE], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "flysales-orders-template.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download template
            </button>
          </div>
          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Preview — {preview.length} order{preview.length === 1 ? "" : "s"}
            </CardTitle>
            <CardDescription>
              {invalidCount === 0
                ? "Everything checks out. Importing creates and prices all orders in one shot."
                : `${invalidCount} order${invalidCount === 1 ? "" : "s"} have errors — fix the CSV and re-upload. Only valid orders can be submitted.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead>Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="tnum text-xs font-medium">
                      {p.reference || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{p.customer}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.country}</TableCell>
                    <TableCell className="text-right tnum text-sm">{p.lines.length}</TableCell>
                    <TableCell>
                      {p.errors.length === 0 ? (
                        <span className="text-xs font-medium text-primary">Ready</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-destructive">
                          {p.errors.slice(0, 3).map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                          {p.errors.length > 3 && <li>+{p.errors.length - 3} more</li>}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {invalidCount > 0
                  ? "Invalid groups are excluded below — re-upload a fixed file to include them."
                  : `Importing into ${store?.store_name ?? "your workspace"}.`}
              </p>
              <Button onClick={submitAll} disabled={busy || validOrders.length === 0}>
                {busy
                  ? "Importing…"
                  : `Import ${validOrders.length} order${validOrders.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Referenced so the bundler keeps formatUSD used in future totals row.
void formatUSD;
