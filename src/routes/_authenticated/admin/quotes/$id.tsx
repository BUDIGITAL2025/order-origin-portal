import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { LineStatusBadge, QuoteStatusBadge, TierBadge } from "@/components/status-badges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { countryName } from "@/lib/countries";
import { formatDate, formatUSD } from "@/lib/format";
import { effectiveTier, TIER_LABELS } from "@/lib/plans";
import {
  adminGetQuote,
  adminGetQuoteImageUrls,
  adminRequote,
  adminSaveQuoteLines,
  adminSetQuoteStatus,
} from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/admin/quotes/$id")({
  head: () => ({
    meta: [
      { title: "Quote request — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminQuoteDetailPage,
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: string): number {
  return value === "" ? 0 : Number(value);
}

type GridField =
  | "supplier_cogs"
  | "supplier_shipping"
  | "supplier_tax"
  | "markup_product"
  | "markup_shipping";

const GRID_FIELDS: { key: GridField; label: string }[] = [
  { key: "supplier_cogs", label: "COGS" },
  { key: "supplier_shipping", label: "Ship" },
  { key: "supplier_tax", label: "Tax" },
  { key: "markup_product", label: "Mk prod" },
  { key: "markup_shipping", label: "Mk ship" },
];

interface CellForm {
  lineId: string | null;
  status: string;
  supplier_cogs: string;
  supplier_shipping: string;
  supplier_tax: string;
  markup_product: string;
  markup_shipping: string;
}

interface VariantRow {
  key: string;
  label: string;
  sku: string | null;
  moq: string;
  lead_time_days: string;
  cells: Record<string, CellForm>;
}

function emptyCell(): CellForm {
  return {
    lineId: null,
    status: "pending",
    supplier_cogs: "0",
    supplier_shipping: "0",
    supplier_tax: "0",
    markup_product: "0",
    markup_shipping: "0",
  };
}

let rowCounter = 0;
function emptyVariant(countries: string[]): VariantRow {
  const cells: Record<string, CellForm> = {};
  for (const c of countries) cells[c] = emptyCell();
  return {
    key: `new-${++rowCounter}`,
    label: "",
    sku: null,
    moq: "",
    lead_time_days: "",
    cells,
  };
}

function cellLocked(cell: CellForm): boolean {
  return cell.lineId != null && cell.status !== "pending";
}

function cellPrice(c: CellForm): number {
  return round2(
    num(c.supplier_cogs) +
      num(c.supplier_shipping) +
      num(c.supplier_tax) +
      num(c.markup_product) +
      num(c.markup_shipping),
  );
}

function AdminQuoteDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchQuote = useServerFn(adminGetQuote);
  const fetchImages = useServerFn(adminGetQuoteImageUrls);
  const callSave = useServerFn(adminSaveQuoteLines);
  const callSetStatus = useServerFn(adminSetQuoteStatus);
  const callRequote = useServerFn(adminRequote);

  const { data, isPending } = useQuery({
    queryKey: ["admin-quote", id],
    queryFn: () => fetchQuote({ data: { quote_id: id } }),
  });
  const quote = data?.quote;
  const client = (quote?.profiles ?? null) as {
    company_name?: string;
    contact_name?: string;
    platform?: string;
    store_url?: string;
    integration_mode?: string;
    country?: string;
    pricing_tier?: string;
    tier_override?: string | null;
    avg_daily_units_30d?: number;
    subscription_plan?: string;
  } | null;

  const clientTier = effectiveTier(client?.pricing_tier, client?.tier_override);

  const imagePaths = (quote?.image_urls ?? []).filter(Boolean) as string[];
  const { data: images } = useQuery({
    queryKey: ["admin-quote-images", id, imagePaths.join(",")],
    queryFn: () => fetchImages({ data: { paths: imagePaths } }),
    enabled: imagePaths.length > 0,
  });

  const [internalReference, setInternalReference] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const countries = useMemo<string[]>(
    () => (quote?.target_countries ?? []) as string[],
    [quote?.target_countries],
  );

  useEffect(() => {
    if (!data || hydrated) return;
    setInternalReference(data.quote.internal_reference ?? "");
    setValidUntil(data.quote.quote_valid_until ?? "");
    setAdminNotes(data.quote.admin_notes ?? "");
    const targetCountries = (data.quote.target_countries ?? []) as string[];
    if (data.lines.length > 0) {
      const byVariant = new Map<string, VariantRow>();
      for (const l of data.lines) {
        let row = byVariant.get(l.variant_label);
        if (!row) {
          row = {
            key: l.variant_label,
            label: l.variant_label,
            sku: l.sku,
            moq: l.moq != null ? String(l.moq) : "",
            lead_time_days: l.lead_time_days != null ? String(l.lead_time_days) : "",
            cells: {},
          };
          byVariant.set(l.variant_label, row);
        }
        row.cells[l.country_code] = {
          lineId: l.id,
          status: l.status,
          supplier_cogs: l.supplier_cogs != null ? String(l.supplier_cogs) : "0",
          supplier_shipping: l.supplier_shipping != null ? String(l.supplier_shipping) : "0",
          supplier_tax: l.supplier_tax != null ? String(l.supplier_tax) : "0",
          markup_product: l.markup_product != null ? String(l.markup_product) : "0",
          markup_shipping: l.markup_shipping != null ? String(l.markup_shipping) : "0",
        };
      }
      for (const row of byVariant.values()) {
        for (const c of targetCountries) {
          if (!row.cells[c]) row.cells[c] = emptyCell();
        }
      }
      setRows([...byVariant.values()]);
    } else {
      setRows([emptyVariant(targetCountries)]);
    }
    setHydrated(true);
  }, [data, hydrated]);

  const requestEditable =
    quote != null && ["submitted", "sourcing", "quoted"].includes(quote.status);

  const allCells = rows.flatMap((r) =>
    countries.map((c) => r.cells[c]).filter((c): c is CellForm => c != null),
  );
  const prices = allCells.map(cellPrice);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  const updateRow = (key: string, patch: Partial<VariantRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const updateCell = (key: string, country: string, patch: Partial<CellForm>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, cells: { ...r.cells, [country]: { ...emptyCell(), ...r.cells[country], ...patch } } }
          : r,
      ),
    );
  };

  // "Copy across countries": push the first country's value for one field down the whole row.
  const copyAcross = (key: string, field: GridField) => {
    const source = countries[0];
    if (!source) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const value = r.cells[source]?.[field] ?? "0";
        const cells = { ...r.cells };
        for (const c of countries) {
          const cell = cells[c];
          if (cell && !cellLocked(cell)) cells[c] = { ...cell, [field]: value };
        }
        return { ...r, cells };
      }),
    );
    toast.success(
      `${GRID_FIELDS.find((f) => f.key === field)?.label} copied from ${source} to all countries`,
    );
  };

  const save = useMutation({
    mutationFn: () => {
      if (rows.length === 0) throw new Error("Add at least one variant");
      const labels = rows.map((r) => r.label.trim());
      if (labels.some((l) => !l)) throw new Error("Every variant needs a label");
      if (new Set(labels).size !== labels.length) {
        throw new Error("Variant labels must be unique");
      }
      const lines = rows.flatMap((row) =>
        countries.flatMap((country) => {
          const cell = row.cells[country] ?? emptyCell();
          if (cellLocked(cell)) return [];
          return [
            {
              ...(cell.lineId ? { id: cell.lineId } : {}),
              variant_label: row.label.trim(),
              country_code: country,
              supplier_cogs: num(cell.supplier_cogs),
              supplier_shipping: num(cell.supplier_shipping),
              supplier_tax: num(cell.supplier_tax),
              markup_product: num(cell.markup_product),
              markup_shipping: num(cell.markup_shipping),
              moq: row.moq ? Number(row.moq) : null,
              lead_time_days: row.lead_time_days ? Number(row.lead_time_days) : null,
            },
          ];
        }),
      );
      if (lines.length === 0) throw new Error("No editable lines to save");
      return callSave({
        data: {
          quote_id: id,
          lines,
          internal_reference: internalReference,
          quote_valid_until: validUntil || null,
          admin_notes: adminNotes,
        },
      });
    },
    onSuccess: (r) => {
      // Re-key local cells with the persisted line ids / SKUs so a second save
      // updates the same rows instead of inserting duplicates.
      const byKey = new Map(r.lines.map((l) => [`${l.variant_label}::${l.country_code}`, l]));
      setRows((prev) =>
        prev.map((row) => ({
          ...row,
          sku: byKey.get(`${row.label.trim()}::${countries[0]}`)?.sku ?? row.sku,
          cells: Object.fromEntries(
            Object.entries(row.cells).map(([country, cell]) => {
              const saved = byKey.get(`${row.label.trim()}::${country}`);
              return [country, saved ? { ...cell, lineId: saved.id, status: saved.status } : cell];
            }),
          ),
        })),
      );
      toast.success(`Quote saved — ${r.lines.length} line(s), request is now "quoted"`);
      void queryClient.invalidateQueries({ queryKey: ["admin-quote", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const setStatus = useMutation({
    mutationFn: (status: "submitted" | "sourcing" | "expired") =>
      callSetStatus({ data: { quote_id: id, status } }),
    onSuccess: () => {
      toast.success("Status updated");
      void queryClient.invalidateQueries({ queryKey: ["admin-quote", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const requote = useMutation({
    mutationFn: () => callRequote({ data: { quote_id: id } }),
    onSuccess: (r) => {
      toast.success("Requote created in the queue (status: sourcing)");
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
      if (r.quote_id) {
        void queryClient.invalidateQueries({ queryKey: ["admin-quote", r.quote_id] });
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const copyBrief = async () => {
    if (!quote) return;
    const brief = [
      `Product URL: ${quote.product_url ?? ""}`,
      `Product: ${quote.product_name ?? "—"}`,
      `Client: ${client?.company_name ?? "—"} (${client?.contact_name ?? "—"})`,
      `Expected volume: ${quote.target_monthly_volume ?? "—"} units/month`,
      `Notes: ${quote.notes ?? "—"}`,
    ].join("\n");
    await navigator.clipboard.writeText(brief);
    toast.success("Sourcing brief copied to clipboard");
  };

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!quote) return <p className="text-sm text-muted-foreground">Quote request not found.</p>;

  const requotable = quote.status === "closed" || quote.status === "expired";

  return (
    <div>
      <PageHeader
        title={quote.product_name || "Quote request"}
        description={`Submitted ${formatDate(quote.created_at)}${quote.internal_reference ? ` · Ref: ${quote.internal_reference}` : ""}${quote.supersedes_quote_id ? " · requote of an earlier request" : ""}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/admin/quotes">
                <ArrowLeft className="h-3.5 w-3.5" /> Queue
              </Link>
            </Button>
            {requotable && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Requote
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Requote this request?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Creates a new quote request (status: sourcing) with the same product, URL and
                      notes. The original is never edited and the client's monthly quota is not
                      affected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={requote.isPending}
                      onClick={() => requote.mutate()}
                    >
                      Create requote
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void copyBrief()}>
              <Copy className="h-3.5 w-3.5" /> Copy sourcing brief
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Request</CardTitle>
                <QuoteStatusBadge status={quote.status} validUntil={quote.quote_valid_until} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Product URL</div>
                <a
                  href={quote.product_url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all underline-offset-2 hover:underline"
                >
                  {quote.product_url}
                </a>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
                <p className="whitespace-pre-wrap">{quote.notes || "—"}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Volume / month</div>
                  <div className="font-mono">{quote.target_monthly_volume ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Client</div>
                  <div>
                    {client?.company_name ?? "—"} <TierBadge tier={clientTier} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {client?.store_url ?? ""}
                    {client?.tier_override
                      ? ` · override (auto: ${TIER_LABELS[client?.pricing_tier ?? "starter"] ?? client?.pricing_tier})`
                      : ` · auto · ${Number(client?.avg_daily_units_30d ?? 0).toFixed(1)} units/day`}
                  </div>
                </div>
              </div>
              {images && images.urls.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Images</div>
                  <div className="flex flex-wrap gap-2">
                    {images.urls.map((img) => (
                      <a key={img.path} href={img.url} target="_blank" rel="noreferrer">
                        <img
                          src={img.url}
                          alt="Quote attachment"
                          className="h-16 w-16 rounded-md border border-border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {(quote.status === "submitted" || quote.status === "sourcing") && (
                <div className="flex gap-2 pt-1">
                  {quote.status === "submitted" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate("sourcing")}
                    >
                      Mark as sourcing
                    </Button>
                  )}
                  {quote.status === "sourcing" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate("submitted")}
                    >
                      Back to submitted
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Variants & pricing</CardTitle>
              <span className="text-xs text-muted-foreground">
                Client tier: <TierBadge tier={clientTier} />
              </span>
            </div>
            <CardDescription>
              One line per variant. All amounts in USD. Supplier tax (IOSS / duties) passes through
              at exact cost — it is never marked up. Cost and margin are never visible to the
              client. Saving with at least one line moves the request to "quoted" and generates
              SKUs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="aq-ref">Internal reference</Label>
                  <Input
                    id="aq-ref"
                    value={internalReference}
                    onChange={(e) => setInternalReference(e.target.value)}
                    placeholder="e.g. Alibaba #4471"
                    disabled={!requestEditable}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aq-valid">Valid until</Label>
                  <Input
                    id="aq-valid"
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    disabled={!requestEditable}
                  />
                </div>
              </div>

              {respondedLines.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Answered lines (locked)
                  </div>
                  {respondedLines.map((l) => (
                    <div
                      key={l.id ?? l.variant_label}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">{l.variant_label}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm">{formatUSD(linePrice(l))}</span>
                        <LineStatusBadge status={l.status as "accepted" | "rejected"} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-4">
                {lines.map((l, i) => {
                  if (l.status !== "pending") return null;
                  const editable = requestEditable;
                  return (
                    <div key={l.id ?? `new-${i}`} className="space-y-3 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 space-y-1.5">
                          <Label htmlFor={`aq-label-${i}`}>Variant label</Label>
                          <Input
                            id={`aq-label-${i}`}
                            value={l.variant_label}
                            onChange={(e) => updateLine(i, { variant_label: e.target.value })}
                            placeholder='e.g. "20cm", "Red / L"'
                            disabled={!editable}
                            required
                          />
                        </div>
                        <div className="pt-6 font-mono text-xs text-muted-foreground">
                          {l.sku ?? "SKU on save"}
                        </div>
                        {editable && editableLines.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mt-6 text-muted-foreground"
                            onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`aq-cogs-${i}`}>Supplier COGS ($)</Label>
                          <Input id={`aq-cogs-${i}`} type="number" step="0.01" min="0" required value={l.supplier_cogs} onChange={(e) => updateLine(i, { supplier_cogs: e.target.value })} disabled={!editable} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`aq-ship-${i}`}>Supplier shipping ($)</Label>
                          <Input id={`aq-ship-${i}`} type="number" step="0.01" min="0" required value={l.supplier_shipping} onChange={(e) => updateLine(i, { supplier_shipping: e.target.value })} disabled={!editable} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`aq-tax-${i}`}>Supplier tax ($)</Label>
                          <Input id={`aq-tax-${i}`} type="number" step="0.01" min="0" required value={l.supplier_tax} onChange={(e) => updateLine(i, { supplier_tax: e.target.value })} disabled={!editable} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`aq-mkprod-${i}`}>Markup — product ($)</Label>
                          <Input id={`aq-mkprod-${i}`} type="number" step="0.01" min="0" required value={l.markup_product} onChange={(e) => updateLine(i, { markup_product: e.target.value })} disabled={!editable} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`aq-mkship-${i}`}>Markup — shipping ($)</Label>
                          <Input id={`aq-mkship-${i}`} type="number" step="0.01" min="0" required value={l.markup_shipping} onChange={(e) => updateLine(i, { markup_shipping: e.target.value })} disabled={!editable} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`aq-moq-${i}`}>MOQ</Label>
                          <Input id={`aq-moq-${i}`} type="number" min="1" value={l.moq} onChange={(e) => updateLine(i, { moq: e.target.value })} disabled={!editable} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`aq-lead-${i}`}>Lead time (days)</Label>
                          <Input id={`aq-lead-${i}`} type="number" min="0" value={l.lead_time_days} onChange={(e) => updateLine(i, { lead_time_days: e.target.value })} disabled={!editable} />
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
                        <div className="bg-muted/40 p-2">
                          <div className="uppercase tracking-wide text-muted-foreground">Cost</div>
                          <div className="font-mono font-medium">{formatUSD(lineCost(l))}</div>
                        </div>
                        <div className="bg-muted/40 p-2">
                          <div className="uppercase tracking-wide text-muted-foreground">Markup</div>
                          <div className="font-mono font-medium">{formatUSD(lineMarkup(l))}</div>
                        </div>
                        <div className="bg-muted/40 p-2">
                          <div className="uppercase tracking-wide text-muted-foreground">Client price</div>
                          <div className="font-mono font-semibold">{formatUSD(linePrice(l))}</div>
                        </div>
                        <div className="bg-muted/40 p-2">
                          <div className="uppercase tracking-wide text-muted-foreground">Margin</div>
                          <div className="font-mono font-medium">{lineMargin(l).toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {requestEditable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add variant
                </Button>
              )}

              {editableLines.length > 0 && (
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border text-sm">
                  <div className="bg-muted/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Total cost</div>
                    <div className="font-mono font-medium">{formatUSD(totals.cost)}</div>
                  </div>
                  <div className="bg-muted/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Total markup</div>
                    <div className="font-mono font-medium">{formatUSD(totals.markup)}</div>
                  </div>
                  <div className="bg-muted/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Total client price</div>
                    <div className="font-mono font-semibold">{formatUSD(totals.price)}</div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="aq-notes">Internal notes (admin only)</Label>
                <Textarea id="aq-notes" rows={3} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
              </div>
              {requestEditable && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save & send quote"}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
