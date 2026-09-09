import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, MessageCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { LineStatusBadge, QuoteStatusBadge, TierBadge } from "@/components/status-badges";
import { UrlPreviewCard } from "@/components/url-preview-card";
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
import { countryName, isEuCountry } from "@/lib/countries";
import {
  closedPrice,
  defaultImportTax,
  feeBase,
  marginAmount,
  PASSTHROUGH_NOTE,
  sourcingCostOf,
  sourcingFee,
} from "@/lib/pricing";
import { adminPublishQuote } from "@/lib/sourcing.functions";
import { QuoteThread } from "@/components/quote-thread";
import {
  adminDeleteQuoteOption,
  adminListQuoteOptions,
  adminSaveQuoteOption,
} from "@/lib/quote-offers.functions";

/** House sourcing fee rate, mirrored from the server default. */
const DEFAULT_FEE_RATE = 0.08;
import { formatDate, formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
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
    meta: [{ title: "Quote request — FlySales Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminQuoteDetailPage,
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: string): number {
  return value === "" ? 0 : Number(value);
}

type GridField = "supplier_cogs" | "supplier_shipping" | "supplier_tax" | "margin_pct";

const GRID_FIELDS: { key: GridField; label: string; short?: string }[] = [
  { key: "supplier_cogs", label: "COGS (EXW)", short: "COGS" },
  { key: "supplier_shipping", label: "Ship" },
  { key: "supplier_tax", label: "IOSS / import per unit", short: "IOSS" },
  { key: "margin_pct", label: "Margin %", short: "Margin" },
];

interface CellForm {
  lineId: string | null;
  status: string;
  supplier_cogs: string;
  supplier_shipping: string;
  supplier_tax: string;
  margin_pct: string;
  /** Snapshotted sourcing fee rate; the house default until sourcing saves one. */
  fee_rate: number;
  /** True for lines whose entered cost already contains the sourcing fee. */
  fee_included: boolean;
  supplier_name: string;
}

interface VariantRow {
  key: string;
  label: string;
  sku: string | null;
  moq: string;
  lead_time_days: string;
  cells: Record<string, CellForm>;
}

function emptyCell(country?: string): CellForm {
  return {
    lineId: null,
    status: "pending",
    supplier_cogs: "0",
    supplier_shipping: "0",
    supplier_tax: country ? String(defaultImportTax(country)) : "0",
    margin_pct: "0",
    fee_rate: DEFAULT_FEE_RATE,
    fee_included: false,
    supplier_name: "",
  };
}

let rowCounter = 0;
function emptyVariant(countries: string[]): VariantRow {
  const cells: Record<string, CellForm> = {};
  for (const c of countries) cells[c] = emptyCell(c);
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

/** COGS + supplier shipping — the base the sourcing fee applies to. */
function cellBase(c: CellForm): number {
  return feeBase(num(c.supplier_cogs), num(c.supplier_shipping));
}

/** The sourcing commission on this line — zero when the cost already includes it. */
function cellFee(c: CellForm): number {
  if (c.fee_included) return 0;
  return sourcingFee(num(c.supplier_cogs), num(c.supplier_shipping), c.fee_rate);
}

/** Everything the goods cost us before margin. */
function cellSourcingCost(c: CellForm): number {
  return sourcingCostOf({
    cogs: num(c.supplier_cogs),
    shipping: num(c.supplier_shipping),
    feeRate: c.fee_rate,
    feeIncluded: c.fee_included,
  });
}

/** Our absolute margin per unit. */
function cellMargin(c: CellForm): number {
  return marginAmount(cellSourcingCost(c), num(c.margin_pct));
}

/** The closed price the client sees: goods + margin + tax passthrough at cost. */
function cellPrice(c: CellForm): number {
  return closedPrice(cellSourcingCost(c), num(c.margin_pct), num(c.supplier_tax));
}

function AdminQuoteDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchQuote = useServerFn(adminGetQuote);
  const fetchImages = useServerFn(adminGetQuoteImageUrls);
  const callSave = useServerFn(adminSaveQuoteLines);
  const callPublish = useServerFn(adminPublishQuote);
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

  // Uploaded files are private-bucket paths (need signed URLs); scraped preview
  // images are external https URLs rendered directly.
  const allImageRefs = (quote?.image_urls ?? []).filter(Boolean) as string[];
  const imagePaths = allImageRefs.filter((p) => !/^https?:\/\//i.test(p));
  const externalImages = allImageRefs.filter((p) => /^https?:\/\//i.test(p));
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

  // ===== Offers: a quote holds up to three publishable options =====
  const fetchOptions = useServerFn(adminListQuoteOptions);
  const callSaveOption = useServerFn(adminSaveQuoteOption);
  const callDeleteOption = useServerFn(adminDeleteQuoteOption);
  const { data: optionsData } = useQuery({
    queryKey: ["admin-quote-options", id],
    queryFn: () => fetchOptions({ data: { quote_id: id } }),
  });
  const options = optionsData?.options ?? [];
  const [optionId, setOptionId] = useState<string | null>(null);
  const activeOption = options.find((o) => o.id === optionId) ?? options[0] ?? null;

  useEffect(() => {
    if (!optionId && options[0]) setOptionId(options[0].id);
  }, [optionId, options]);
  // Switching offer re-hydrates the grid from that offer's own lines.
  useEffect(() => {
    setHydrated(false);
  }, [optionId]);

  const saveOption = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      callSaveOption({
        data: { quote_id: id, ...(optionId ? { option_id: optionId } : {}), ...patch },
      }),
    onSuccess: (r) => {
      if (r.option_id) setOptionId(r.option_id);
      void queryClient.invalidateQueries({ queryKey: ["admin-quote-options", id] });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteOption = useMutation({
    mutationFn: (oid: string) => callDeleteOption({ data: { option_id: oid } }),
    onSuccess: () => {
      setOptionId(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-quote-options", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-quote", id] });
    },
    onError: (err) => toast.error(err.message),
  });

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
    const optionLines = optionId
      ? data.lines.filter((l) => (l as { option_id?: string | null }).option_id === optionId)
      : data.lines;
    if (optionLines.length > 0) {
      const byVariant = new Map<string, VariantRow>();
      for (const l of optionLines) {
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
          margin_pct: l.margin_pct != null ? String(l.margin_pct) : "0",
          fee_rate: l.sourcing_fee_rate != null ? Number(l.sourcing_fee_rate) : DEFAULT_FEE_RATE,
          fee_included: l.fee_included === true,
          supplier_name: "",
        };
      }
      for (const row of byVariant.values()) {
        for (const c of targetCountries) {
          if (!row.cells[c]) row.cells[c] = emptyCell(c);
        }
      }
      setRows([...byVariant.values()]);
    } else {
      setRows([emptyVariant(targetCountries)]);
    }
    setHydrated(true);
  }, [data, hydrated, optionId]);

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
          ? {
              ...r,
              cells: { ...r.cells, [country]: { ...emptyCell(), ...r.cells[country], ...patch } },
            }
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
    mutationFn: async () => {
      if (rows.length === 0) throw new Error("Add at least one variant");
      const labels = rows.map((r) => r.label.trim());
      if (labels.some((l) => !l)) throw new Error("Every variant needs a label");
      if (new Set(labels).size !== labels.length) {
        throw new Error("Variant labels must be unique");
      }
      const lines = rows.flatMap((row) =>
        countries.flatMap((country) => {
          const cell = row.cells[country] ?? emptyCell(country);
          if (cellLocked(cell)) return [];
          return [
            {
              ...(cell.lineId ? { id: cell.lineId } : {}),
              variant_label: row.label.trim(),
              country_code: country,
              supplier_cogs: num(cell.supplier_cogs),
              supplier_shipping: num(cell.supplier_shipping),
              supplier_tax: num(cell.supplier_tax),
              supplier_name: cell.supplier_name,
              moq: row.moq ? Number(row.moq) : null,
              lead_time_days: row.lead_time_days ? Number(row.lead_time_days) : null,
            },
          ];
        }),
      );

      if (lines.length === 0) throw new Error("No editable lines to save");
      const saved = await callSave({
        data: {
          quote_id: id,
          ...(optionId ? { option_id: optionId } : {}),
          lines,
          internal_reference: internalReference,
          quote_valid_until: validUntil || null,
          admin_notes: adminNotes,
        },
      });

      // Second step: the margin. Publishing writes the client price from the
      // saved sourcing cost, so it always uses the numbers the server stored.
      const marginByKey = new Map<string, number>();
      const feeByKey = new Map<string, number>();
      for (const row of rows) {
        for (const country of countries) {
          const cell = row.cells[country];
          if (cell && !cellLocked(cell)) {
            marginByKey.set(`${row.label.trim()}::${country}`, num(cell.margin_pct));
            feeByKey.set(`${row.label.trim()}::${country}`, cell.fee_rate * 100);
          }
        }
      }
      const publishLines = saved.lines.map((l) => ({
        id: l.id,
        margin_pct: marginByKey.get(`${l.variant_label}::${l.country_code}`) ?? 0,
        fee_rate_pct: feeByKey.get(`${l.variant_label}::${l.country_code}`) ?? 0,
      }));
      await callPublish({
        data: {
          quote_id: id,
          lines: publishLines,
          internal_reference: internalReference,
          quote_valid_until: validUntil || null,
          admin_notes: adminNotes,
        },
      });
      return saved;
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
      toast.success(`Quote published — ${r.lines.length} line(s), request is now "quoted"`);
      void queryClient.invalidateQueries({ queryKey: ["admin-quote", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-quote-options", id] });
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

  /**
   * Sourcing brief shared by "Copy" and "WhatsApp". Destination countries drive
   * the shipping cost, so they are mandatory here; variant context tells
   * sourcing whether the pasted URL is the whole story or one of several
   * options on the page.
   */
  const buildBrief = (): string => {
    if (!quote) return "";
    const countriesLine =
      countries.length > 0 ? countries.map((c) => `${countryName(c)} (${c})`).join(", ") : "—";
    const seen = data?.preview?.variants ?? [];
    const variantLine =
      seen.length > 0
        ? `Variants seen on page: ${seen.join(", ")} — confirm which to quote`
        : "Client pasted a single-variant URL — confirm available variants before quoting.";
    return [
      `Product URL: ${quote.product_url ?? ""}`,
      `Product: ${quote.product_name ?? "—"}`,
      `Client: ${client?.company_name ?? "—"} (${client?.contact_name ?? "—"})`,
      `Target countries: ${countriesLine}`,
      `Expected volume: ${quote.target_monthly_volume ?? "—"} units/month`,
      variantLine,
      `Notes: ${quote.notes ?? "—"}`,
    ].join("\n");
  };

  const copyBrief = async () => {
    if (!quote) return;
    await navigator.clipboard.writeText(buildBrief());
    toast.success("Sourcing brief copied to clipboard");
  };

  const sendWhatsApp = () => {
    if (!quote) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(buildBrief())}`, "_blank", "noopener");
  };

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!quote) return <p className="text-sm text-muted-foreground">Quote request not found.</p>;

  const requotable = quote.status === "closed" || quote.status === "expired";

  return (
    <div>
      <PageHeader
        title={quote.product_name || "Quote request"}
        description={`Submitted ${formatDate(quote.created_at)}${countries.length > 0 ? ` · Ships to: ${countries.map((c) => countryName(c)).join(", ")}` : ""}${quote.internal_reference ? ` · Ref: ${quote.internal_reference}` : ""}${quote.supersedes_quote_id ? " · requote of an earlier request" : ""}`}
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
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void copyBrief()}
            >
              <Copy className="h-3.5 w-3.5" /> Copy sourcing brief
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={sendWhatsApp}>
              <MessageCircle className="h-3.5 w-3.5" /> Send via WhatsApp
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
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Product URL
                </div>
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
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Target countries
                </div>
                <p>{countries.map((c) => `${countryName(c)} (${c})`).join(", ") || "—"}</p>
              </div>
              {(data?.preview?.variants ?? []).length > 0 ? (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Variants seen on page
                  </div>
                  <p>
                    {(data?.preview?.variants ?? []).join(", ")}{" "}
                    <span className="text-muted-foreground">— confirm which to quote</span>
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Client pasted a single-variant URL — confirm available variants before quoting.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Volume / month
                  </div>
                  <div className="tnum">{quote.target_monthly_volume ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Client
                  </div>
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
              {((images && images.urls.length > 0) || externalImages.length > 0) && (
                <div>
                  <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                    Images
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(images?.urls ?? []).map((img) => (
                      <a key={img.path} href={img.url} target="_blank" rel="noreferrer">
                        <img
                          src={img.url}
                          alt="Quote attachment"
                          className="h-16 w-16 rounded-md border border-border object-cover"
                        />
                      </a>
                    ))}
                    {externalImages.map((src) => (
                      <a key={src} href={src} target="_blank" rel="noreferrer">
                        <img
                          src={src}
                          alt="Scraped product image"
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
          {data?.preview && (
            <UrlPreviewCard
              url={data.preview.url_normalized}
              preview={{
                status: "ok",
                title: data.preview.title,
                description: data.preview.description,
                imageUrls: data.preview.image_urls ?? [],
                priceHint: data.preview.price_hint,
              }}
            />
          )}
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
              Rows are variants, columns are the requested countries — each cell is a priced variant
              × country line. All amounts in USD. The chain is COGS → + ship → + sourcing fee →
              sourcing cost, then one FlySales margin %. Supplier tax (IOSS / duties) passes through
              at exact cost — it is never marked up. {PASSTHROUGH_NOTE} Cost and margin are never
              visible to the client. Publishing moves the request to "quoted" and generates one SKU
              per variant, shared across its country rows.
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
                  <p className="text-[11px] text-muted-foreground">default: 7 days</p>
                  <Input
                    id="aq-valid"
                    type="date"
                    placeholder="default: 7 days"
                    title="Leave empty and the quote stays valid for 7 days from publish."
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    disabled={!requestEditable}
                  />
                </div>
              </div>

              {rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <div
                    className="grid min-w-max"
                    style={{
                      gridTemplateColumns: `220px repeat(${Math.max(countries.length, 1)}, minmax(200px, 1fr))`,
                    }}
                  >
                    <div className="border-b border-border bg-muted/40 p-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Variant
                    </div>
                    {countries.map((c) => (
                      <div
                        key={c}
                        className="border-b border-l border-border bg-muted/40 p-2 text-center"
                      >
                        <div className="text-xs font-semibold">{c}</div>
                        <div className="text-[10px] text-muted-foreground">{countryName(c)}</div>
                      </div>
                    ))}

                    {rows.map((row) => {
                      const rowLocked = Object.values(row.cells).some(cellLocked);
                      const rowEditable = requestEditable && !rowLocked;
                      return (
                        <div key={row.key} className="contents">
                          <div className="space-y-2 border-b border-border p-2">
                            <Input
                              value={row.label}
                              onChange={(e) => updateRow(row.key, { label: e.target.value })}
                              placeholder='e.g. "20cm", "Red / L"'
                              disabled={!rowEditable}
                              aria-label="Variant label"
                            />
                            <div className="tnum text-[10px] text-muted-foreground">
                              {row.sku ?? "SKU on save"}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <Input
                                type="number"
                                min={1}
                                value={row.moq}
                                onChange={(e) => updateRow(row.key, { moq: e.target.value })}
                                disabled={!rowEditable}
                                placeholder="MOQ"
                                aria-label="MOQ"
                                className="h-7 text-xs"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={row.lead_time_days}
                                onChange={(e) =>
                                  updateRow(row.key, { lead_time_days: e.target.value })
                                }
                                disabled={!rowEditable}
                                placeholder="Lead days"
                                aria-label="Lead time (days)"
                                className="h-7 text-xs"
                              />
                            </div>
                            {rowEditable && countries.length > 1 && (
                              <div className="space-y-1">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Copy {countries[0]} → all
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {GRID_FIELDS.map((f) => (
                                    <button
                                      key={f.key}
                                      type="button"
                                      onClick={() => copyAcross(row.key, f.key)}
                                      className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                                    >
                                      {f.short ?? f.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {rowEditable && rows.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
                                onClick={() =>
                                  setRows((prev) => prev.filter((r) => r.key !== row.key))
                                }
                              >
                                <Trash2 className="h-3 w-3" /> Remove variant
                              </Button>
                            )}
                          </div>
                          {countries.map((country) => {
                            const cell = row.cells[country] ?? emptyCell(country);
                            const locked = cellLocked(cell);
                            const cellEditable = requestEditable && !locked;
                            return (
                              <div
                                key={country}
                                className="space-y-1 border-b border-l border-border p-2"
                              >
                                {GRID_FIELDS.map((f) => (
                                  <div key={f.key}>
                                    <div className="flex items-center gap-1">
                                      <span
                                        className={cn(
                                          "shrink-0 text-[10px] leading-tight text-muted-foreground",
                                          f.key === "supplier_tax" ? "w-16" : "w-12",
                                        )}
                                      >
                                        {f.label}
                                      </span>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={cell[f.key]}
                                        onChange={(e) =>
                                          updateCell(row.key, country, { [f.key]: e.target.value })
                                        }
                                        disabled={!cellEditable}
                                        aria-label={`${f.label} (${country})`}
                                        className="h-7 tnum text-xs"
                                      />
                                    </div>
                                    {f.key === "supplier_cogs" && (
                                      <p className="mt-0.5 pl-[4.25rem] text-[9px] leading-tight text-muted-foreground/80">
                                        Supplier unit price Ex Works — excludes all freight.
                                      </p>
                                    )}
                                    {f.key === "supplier_tax" && (
                                      <p className="mt-0.5 pl-[4.25rem] text-[9px] leading-tight text-muted-foreground/80">
                                        {isEuCountry(country)
                                          ? "EU — $3.50/unit passthrough"
                                          : "usually 0"}
                                      </p>
                                    )}
                                  </div>
                                ))}
                                <div className="mt-1 space-y-0.5 rounded border border-border/60 bg-muted/30 p-1.5 text-[10px] text-muted-foreground">
                                  <div className="flex items-center justify-between">
                                    <span>COGS + ship</span>
                                    <span className="tnum">{formatUSD(cellBase(cell))}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="shrink-0">Sourcing fee %</span>
                                    <div className="flex items-center gap-1">
                                      <Input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        max="100"
                                        value={
                                          cell.fee_included
                                            ? 0
                                            : Math.round(cell.fee_rate * 1000) / 10
                                        }
                                        onChange={(e) =>
                                          updateCell(row.key, country, {
                                            fee_rate: (Number(e.target.value) || 0) / 100,
                                          })
                                        }
                                        disabled={!cellEditable}
                                        aria-label={`Sourcing fee % (${country})`}
                                        className="h-6 w-14 tnum text-[10px]"
                                      />
                                      <span className="tnum">{formatUSD(cellFee(cell))}</span>
                                    </div>
                                  </div>
                                  {cell.fee_included && (
                                    <p className="text-[9px] leading-tight text-muted-foreground/80">
                                      Fee included in cost — never applied twice.
                                    </p>
                                  )}
                                  <div className="flex items-center justify-between font-medium text-foreground">
                                    <span>Sourcing cost</span>
                                    <span className="tnum">
                                      {formatUSD(cellSourcingCost(cell))}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span>Our margin</span>
                                    <span className="tnum">{formatUSD(cellMargin(cell))}</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span>Tax passthrough</span>
                                    <span className="tnum">
                                      {formatUSD(num(cell.supplier_tax))}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between pt-1">
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    Client price
                                  </span>
                                  <span className="tnum text-xs font-semibold">
                                    {formatUSD(cellPrice(cell))}
                                  </span>
                                </div>
                                {locked && (
                                  <LineStatusBadge
                                    status={cell.status as "accepted" | "rejected"}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {requestEditable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setRows((prev) => [...prev, emptyVariant(countries)])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add variant (all {countries.length}{" "}
                  {countries.length === 1 ? "country" : "countries"})
                </Button>
              )}

              {rows.length > 0 && (
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border text-sm">
                  <div className="bg-muted/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Grid
                    </div>
                    <div className="tnum font-medium">
                      {rows.length} variant{rows.length === 1 ? "" : "s"} × {countries.length}{" "}
                      {countries.length === 1 ? "country" : "countries"}
                    </div>
                  </div>
                  <div className="bg-muted/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Lowest unit price
                    </div>
                    <div className="tnum font-medium">{formatUSD(minPrice)}</div>
                  </div>
                  <div className="bg-muted/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Highest unit price
                    </div>
                    <div className="tnum font-semibold">{formatUSD(maxPrice)}</div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="aq-notes">Internal notes (admin only)</Label>
                <Textarea
                  id="aq-notes"
                  rows={3}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                />
              </div>
              {requestEditable && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Publishing…" : "Publish quote to client"}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
