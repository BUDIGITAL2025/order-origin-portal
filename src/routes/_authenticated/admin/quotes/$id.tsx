import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  MessageCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
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
import { deliveryLabel, quoteRefFromSkus } from "@/lib/quote-ref";
import { QuoteThread } from "@/components/quote-thread";
import { LifecycleTimeline } from "@/components/lifecycle-timeline";
import {
  adminDeleteQuoteOption,
  adminListQuoteOptions,
  adminSaveQuoteOption,
} from "@/lib/quote-offers.functions";

/** House sourcing fee rate, mirrored from the server default. */
const DEFAULT_FEE_RATE = 0.08;
import { formatDate, formatUSD, money2 } from "@/lib/format";
import {
  CURRENCY_LABEL,
  CURRENCY_SYMBOL,
  SUPPLIER_CURRENCIES,
  formatCurrency,
  rateFor,
  toUsd,
  type FxRates,
  type SupplierCurrency,
} from "@/lib/fx";
import { getTodayFxRates } from "@/lib/fx.functions";
import { getDefaultMarginPct } from "@/lib/pricing-settings.functions";
import { pct } from "@/lib/fee-tiers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { effectiveTier, TIER_LABELS } from "@/lib/plans";
import {
  adminGetQuote,
  adminGetQuoteImageUrls,
  adminCreateQuoteRevision,
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

/** Shared column track for the compact variant table and its rows. */
const COMPACT_COLS =
  "grid-cols-[minmax(140px,1.6fr)_48px_repeat(4,minmax(76px,1fr))_16px] sm:gap-x-3";

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
  /** COGS as the SUPPLIER quotes it, in `currency`. USD is computed from it. */
  supplier_cogs: string;
  /** Supplier shipping per unit, in the same currency as COGS. */
  supplier_shipping: string;
  /** The import-tax passthrough is always settled in USD. */
  supplier_tax: string;
  currency: SupplierCurrency;
  margin_pct: string;
  /** Snapshotted sourcing fee rate; the house default until sourcing saves one. */
  fee_rate: number;
  /** True for lines whose entered cost already contains the sourcing fee. */
  fee_included: boolean;
  supplier_name: string;
  /** Rate frozen on the saved line — kept while the currency is unchanged. */
  fx?: { currency: SupplierCurrency; rate: number; date: string | null };
}

interface VariantRow {
  key: string;
  label: string;
  sku: string | null;
  moq: string;
  lead_time_days: string;
  cells: Record<string, CellForm>;
}

function emptyCell(country?: string, defaultMargin = 0): CellForm {
  return {
    lineId: null,
    status: "pending",
    supplier_cogs: "0",
    supplier_shipping: "0",
    supplier_tax: money2(country ? defaultImportTax(country) : 0),
    currency: "USD",
    margin_pct: money2(defaultMargin),
    fee_rate: DEFAULT_FEE_RATE,
    fee_included: false,
    supplier_name: "",
  };
}

let rowCounter = 0;
function emptyVariant(countries: string[], defaultMargin = 0): VariantRow {
  const cells: Record<string, CellForm> = {};
  for (const c of countries) cells[c] = emptyCell(c, defaultMargin);
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

/**
 * The rate that applies to this cell: the one frozen on the saved line while
 * the currency is unchanged, otherwise today's market rate. USD is always 1.
 */
function cellRate(c: CellForm, today: FxRates | null): number {
  if (c.currency === "USD") return 1;
  if (c.fx && c.fx.currency === c.currency && c.fx.rate > 0) return c.fx.rate;
  if (!today) return 0;
  try {
    return rateFor(c.currency, today);
  } catch {
    return 0;
  }
}

/** COGS in USD — the supplier amount converted at this cell's rate. */
function cellCogsUsd(c: CellForm, rate: number): number {
  return c.currency === "USD" ? num(c.supplier_cogs) : toUsd(num(c.supplier_cogs), rate);
}

function cellShipUsd(c: CellForm, rate: number): number {
  return c.currency === "USD" ? num(c.supplier_shipping) : toUsd(num(c.supplier_shipping), rate);
}

/** COGS + supplier shipping in USD — the base the sourcing fee applies to. */
function cellBase(c: CellForm, rate: number): number {
  return feeBase(cellCogsUsd(c, rate), cellShipUsd(c, rate));
}

/** The sourcing commission on this line — zero when the cost already includes it. */
function cellFee(c: CellForm, rate: number): number {
  if (c.fee_included) return 0;
  return sourcingFee(cellCogsUsd(c, rate), cellShipUsd(c, rate), c.fee_rate);
}

/** Everything the goods cost us before margin. */
function cellSourcingCost(c: CellForm, rate: number): number {
  return sourcingCostOf({
    cogs: cellCogsUsd(c, rate),
    shipping: cellShipUsd(c, rate),
    feeRate: c.fee_rate,
    feeIncluded: c.fee_included,
  });
}

/** Our absolute margin per unit. */
function cellMargin(c: CellForm, rate: number): number {
  return marginAmount(cellCogsUsd(c, rate), num(c.margin_pct));
}

/** The closed price the client sees: goods + margin + tax passthrough at cost. */
function cellPrice(c: CellForm, rate: number): number {
  return closedPrice(
    cellSourcingCost(c, rate),
    cellCogsUsd(c, rate),
    num(c.margin_pct),
    num(c.supplier_tax),
  );
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
  const callRevision = useServerFn(adminCreateQuoteRevision);

  const { data, isPending } = useQuery({
    queryKey: ["admin-quote", id],
    queryFn: () => fetchQuote({ data: { quote_id: id } }),
  });
  const quote = data?.quote;
  // Today's market rates, for cells priced in a currency with no frozen rate yet.
  const fetchFx = useServerFn(getTodayFxRates);
  const { data: fxToday } = useQuery({
    queryKey: ["fx-today"],
    queryFn: () => fetchFx({}),
    staleTime: 60 * 60 * 1000,
  });
  const todayFx = (fxToday ?? null) as FxRates | null;
  // Platform default margin — prefills every new variant cell.
  const fetchDefaultMargin = useServerFn(getDefaultMarginPct);
  const { data: marginSetting, isSuccess: marginReady } = useQuery({
    queryKey: ["default-margin-pct"],
    queryFn: fetchDefaultMargin,
    staleTime: 10 * 60 * 1000,
  });
  const defaultMargin = marginSetting?.margin_pct ?? 10;
  /** Tier context for the fee field: the agent this request belongs to. */
  const agentTier = data?.agent ?? null;
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
  const navigate = useNavigate();
  const [hydrated, setHydrated] = useState(false);
  /** Explicit-save bookkeeping: the serialized form as last persisted. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [needsSnapshot, setNeedsSnapshot] = useState(false);

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
  /** Which variant × country line has its full editor open, if any. */
  const [openCell, setOpenCell] = useState<string | null>(null);
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
    if (!data || hydrated || !marginReady) return;
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
        // The supplier's own amount is the source of truth: a foreign line is
        // edited in its own currency and read back in USD at the frozen rate.
        const currency = ((l.supplier_currency as SupplierCurrency | null) ??
          "USD") as SupplierCurrency;
        const foreign = currency !== "USD" && l.fx_rate_used != null;
        row.cells[l.country_code] = {
          lineId: l.id,
          status: l.status,
          currency,
          supplier_cogs: money2(foreign ? (l.supplier_cogs_original ?? 0) : (l.supplier_cogs ?? 0)),
          supplier_shipping: money2(
            foreign ? (l.supplier_shipping_original ?? 0) : (l.supplier_shipping ?? 0),
          ),
          supplier_tax: money2(l.supplier_tax ?? 0),
          margin_pct: l.margin_pct != null ? String(l.margin_pct) : "0",
          fee_rate: l.sourcing_fee_rate != null ? Number(l.sourcing_fee_rate) : DEFAULT_FEE_RATE,
          fee_included: l.fee_included === true,
          supplier_name: "",
          ...(foreign
            ? {
                fx: {
                  currency,
                  rate: Number(l.fx_rate_used),
                  date: (l.fx_rate_date as string | null) ?? null,
                },
              }
            : {}),
        };
      }
      for (const row of byVariant.values()) {
        for (const c of targetCountries) {
          if (!row.cells[c]) row.cells[c] = emptyCell(c, defaultMargin);
        }
      }
      setRows([...byVariant.values()]);
    } else {
      setRows([emptyVariant(targetCountries, defaultMargin)]);
    }
    setHydrated(true);
    setNeedsSnapshot(true);
  }, [data, hydrated, optionId, marginReady, defaultMargin]);

  const requestEditable =
    quote != null && ["submitted", "sourcing", "quoted"].includes(quote.status);

  const allCells = rows.flatMap((r) =>
    countries.map((c) => r.cells[c]).filter((c): c is CellForm => c != null),
  );
  const prices = allCells.map((c) => cellPrice(c, cellRate(c, todayFx)));
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

  // Unsaved-changes tracking: the form serialized now vs. as last persisted.
  const formSnapshot = useMemo(
    () => JSON.stringify({ rows, internalReference, validUntil, adminNotes }),
    [rows, internalReference, validUntil, adminNotes],
  );
  useEffect(() => {
    if (needsSnapshot) {
      setSavedSnapshot(formSnapshot);
      setNeedsSnapshot(false);
    }
  }, [needsSnapshot, formSnapshot]);
  const dirty = savedSnapshot !== null && formSnapshot !== savedSnapshot;

  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm("You have unsaved changes. Leave this quote anyway?"),
    enableBeforeUnload: () => dirty,
  });

  /** Copies one cell's margin to every editable cell in the grid. */
  const applyMarginToAll = (key: string, country: string) => {
    const value = rows.find((r) => r.key === key)?.cells[country]?.margin_pct ?? "0";
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        cells: Object.fromEntries(
          Object.entries(r.cells).map(([c, cell]) => [
            c,
            cellLocked(cell) ? cell : { ...cell, margin_pct: value },
          ]),
        ),
      })),
    );
    toast.success(`Margin ${value}% applied to all variants`);
  };

  /** Everything the draft save needs, validated the same way for both actions. */
  const buildLines = () => {
    if (rows.length === 0) throw new Error("Add at least one variant");
    const labels = rows.map((r) => r.label.trim());
    if (labels.some((l) => !l)) throw new Error("Every variant needs a label");
    if (new Set(labels).size !== labels.length) {
      throw new Error("Variant labels must be unique");
    }
    const lines = rows.flatMap((row) =>
      countries.flatMap((country) => {
        const cell = row.cells[country] ?? emptyCell(country, defaultMargin);
        if (cellLocked(cell)) return [];
        return [
          {
            ...(cell.lineId ? { id: cell.lineId } : {}),
            variant_label: row.label.trim(),
            country_code: country,
            // Sent in the supplier's own currency — the server converts and
            // freezes the rate, so the original amount stays the truth.
            supplier_cogs: num(cell.supplier_cogs),
            supplier_shipping: num(cell.supplier_shipping),
            supplier_tax: num(cell.supplier_tax),
            supplier_currency: cell.currency,
            supplier_name: cell.supplier_name,
            moq: row.moq ? Number(row.moq) : null,
            lead_time_days: row.lead_time_days ? Number(row.lead_time_days) : null,
            margin_pct: num(cell.margin_pct),
            fee_rate_pct: cell.fee_rate * 100,
          },
        ];
      }),
    );
    if (lines.length === 0) throw new Error("No editable lines to save");
    return lines;
  };

  type RekeyLine = {
    id: string;
    variant_label: string;
    country_code: string;
    sku: string | null;
    status: string;
  };
  const rekeyRows = (saved: { lines: RekeyLine[] }) => {
    const byKey = new Map(saved.lines.map((l) => [`${l.variant_label}::${l.country_code}`, l]));
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        sku: byKey.get(`${row.label.trim()}::${countries[0]}`)?.sku ?? row.sku,
        cells: Object.fromEntries(
          Object.entries(row.cells).map(([country, cell]) => {
            const saved2 = byKey.get(`${row.label.trim()}::${country}`);
            return [country, saved2 ? { ...cell, lineId: saved2.id, status: saved2.status } : cell];
          }),
        ),
      })),
    );
  };

  /** Saves the draft only — costs, fees, margins, MOQ, leads, valid-until. No email. */
  const save = useMutation({
    mutationFn: async () => {
      const lines = buildLines();
      return callSave({
        data: {
          quote_id: id,
          ...(optionId ? { option_id: optionId } : {}),
          lines,
          internal_reference: internalReference,
          quote_valid_until: validUntil || null,
          admin_notes: adminNotes,
        },
      });
    },
    onSuccess: (r) => {
      rekeyRows(r);
      setNeedsSnapshot(true);
      toast.success("Changes saved — the client was not notified");
      void queryClient.invalidateQueries({ queryKey: ["admin-quote", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
    },
    onError: (err) => toast.error(err.message),
  });

  /** Publishes the saved draft to the client — this is the action that emails them. */
  const publish = useMutation({
    mutationFn: async () => {
      const lines = buildLines();
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
      rekeyRows(r);
      setNeedsSnapshot(true);
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

  const revision = useMutation({
    mutationFn: () => callRevision({ data: { quote_id: id } }),
    onSuccess: (r) => {
      toast.success(
        r.existing
          ? "A revision is already open for this quote — opening it."
          : "Revision created — edit and publish it to the client.",
      );
      void queryClient.invalidateQueries({ queryKey: ["admin-quotes"] });
      void navigate({ to: "/admin/quotes/$id", params: { id: r.quote_id } });
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
  const revisable = quote.status === "quoted" || quote.status === "closed";
  const quoteRef = quoteRefFromSkus(rows.map((r) => r.sku));

  return (
    <div>
      <PageHeader
        title={quote.product_name || "Quote request"}
        description={`Submitted ${formatDate(quote.created_at)}${countries.length > 0 ? ` · Ships to: ${countries.map((c) => countryName(c)).join(", ")}` : ""}${quote.internal_reference ? ` · Ref: ${quote.internal_reference}` : ""}${quote.supersedes_quote_id ? " · requote of an earlier request" : ""} · Delivery: ${deliveryLabel(quote.delivery_mode)}${Number(quote.revision_number ?? 1) > 1 ? ` · revision ${quote.revision_number}` : ""}${quoteRef ? ` · Ref ${quoteRef}` : ""}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to="/admin/quotes">
                <ArrowLeft className="h-3.5 w-3.5" /> Queue
              </Link>
            </Button>
            {revisable && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Create revision
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Create a revision of this quote?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Clones the current pricing into a new editable revision where quantity,
                      delivery, shipping and supplier fields can change. The client keeps the terms
                      they already agreed until they approve the revision.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={revision.isPending}
                      onClick={() => revision.mutate()}
                    >
                      Create revision
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
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
          <QuoteThread quoteId={id} mode="admin" quoteRef={quoteRef} />
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
            <CardTitle className="text-base">Deal view</CardTitle>
            <CardDescription>Every stage of this product, and who acted.</CardDescription>
          </CardHeader>
          <CardContent>
            <LifecycleTimeline quoteId={id} hideHeading />
          </CardContent>
        </Card>

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
            <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Offers
                </span>
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOptionId(o.id)}
                    className={cn(
                      "rounded-full border border-border px-3 py-1 text-xs font-medium",
                      o.id === activeOption?.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    Option {o.letter}
                    {o.recommended ? " ★" : ""}
                    {o.published ? "" : " · draft"}
                  </button>
                ))}
                {options.length < 3 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={saveOption.isPending}
                    onClick={() => {
                      setOptionId(null);
                      saveOption.mutate({});
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add option
                  </Button>
                )}
              </div>
              {activeOption && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Supplier (internal)</Label>
                    <Input
                      defaultValue={activeOption.supplier_name}
                      placeholder="Supplier name"
                      onBlur={(e) => {
                        if (e.target.value.trim() !== activeOption.supplier_name) {
                          saveOption.mutate({ supplier_name: e.target.value.trim() });
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Quality</Label>
                    <div className="grid grid-cols-3 gap-1">
                      {[1, 2, 3].map((q) => (
                        <Button
                          key={q}
                          type="button"
                          size="sm"
                          className="px-0"
                          variant={activeOption.quality === q ? "default" : "outline"}
                          onClick={() => saveOption.mutate({ quality: q })}
                        >
                          {q === 1 ? "Low" : q === 2 ? "Med" : "High"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Shipping lead (days)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      defaultValue={activeOption.shipping_lead_days ?? ""}
                      onBlur={(e) =>
                        saveOption.mutate({
                          shipping_lead_days: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={activeOption.recommended ? "default" : "outline"}
                      onClick={() => saveOption.mutate({ recommended: !activeOption.recommended })}
                    >
                      {activeOption.recommended ? "Recommended" : "Mark recommended"}
                    </Button>
                    {!activeOption.accepted_at && options.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteOption.mutate(activeOption.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Clients see these as anonymous Option A/B/C — never the supplier, the cost chain or
                the margin. Publishing the grid below publishes the selected option.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty) {
                  toast.error("Save your changes first");
                  return;
                }
                publish.mutate();
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
                <div className="overflow-hidden rounded-lg border border-border">
                  {/* Comparison first: one compact line per variant × destination,
                      with the full editor one click away. */}
                  <div
                    className={cn(
                      COMPACT_COLS,
                      "grid items-center gap-x-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                    )}
                  >
                    <span>Variant</span>
                    <span>Dest.</span>
                    <span className="text-right">COGS</span>
                    <span className="text-right">Fee</span>
                    <span className="text-right">Margin</span>
                    <span className="text-right">Client price</span>
                    <span />
                  </div>
                  {rows.map((row) => {
                    const rowLocked = Object.values(row.cells).some(cellLocked);
                    const rowEditable = requestEditable && !rowLocked;
                    return (
                      <div key={row.key}>
                        {countries.map((country) => {
                          const cell = row.cells[country] ?? emptyCell(country);
                          const locked = cellLocked(cell);
                          const cellEditable = requestEditable && !locked;
                          const rate = cellRate(cell, todayFx);
                          const foreign = cell.currency !== "USD";
                          const frozen = cell.fx?.currency === cell.currency;
                          const rateDate = frozen
                            ? (cell.fx?.date ?? null)
                            : (todayFx?.rate_date ?? null);
                          const symbol = CURRENCY_SYMBOL[cell.currency];
                          const cogsUsd = cellCogsUsd(cell, rate);
                          const shipUsd = cellShipUsd(cell, rate);
                          const feeUsd = cellFee(cell, rate);
                          const feePctLabel = cell.fee_included ? "0.00" : money2(cell.fee_rate * 100);
                          const marginPctLabel = money2(cell.margin_pct);
                          const cellKey = `${row.key}::${country}`;
                          const expanded = openCell === cellKey;
                          const conversionLine = (usd: number) =>
                            rate > 0
                              ? `→ ${formatUSD(usd)} @ ${rate.toFixed(4)} (${frozen ? "frozen" : "today"}${rateDate ? ` ${rateDate}` : ""})`
                              : "No exchange rate available yet — save once a rate is published.";
                          const moneyField = (
                            key: "supplier_cogs" | "supplier_shipping",
                            label: string,
                            usd: number,
                          ) => (
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1">
                                <span className="w-12 shrink-0 text-[11px] leading-tight text-muted-foreground">
                                  {label}
                                </span>
                                <Select
                                  value={cell.currency}
                                  onValueChange={(v) =>
                                    updateCell(row.key, country, {
                                      currency: v as SupplierCurrency,
                                    })
                                  }
                                  disabled={!cellEditable}
                                >
                                  <SelectTrigger
                                    className="h-8 w-[4.5rem] text-xs"
                                    aria-label={`Currency (${country})`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SUPPLIER_CURRENCIES.map((c) => (
                                      <SelectItem key={c} value={c} className="text-xs">
                                        {CURRENCY_LABEL[c]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Input
                                  inputMode="decimal"
                                  value={cell[key]}
                                  onChange={(e) =>
                                    updateCell(row.key, country, { [key]: e.target.value })
                                  }
                                  onBlur={(e) =>
                                    updateCell(row.key, country, {
                                      [key]: money2(e.target.value || 0),
                                    })
                                  }
                                  disabled={!cellEditable}
                                  aria-label={`${label} in ${cell.currency} (${country})`}
                                  className="h-8 tnum text-[13px]"
                                />
                              </div>
                              {foreign && (
                                <p className="tnum pl-[4.25rem] text-[11px] leading-tight text-muted-foreground">
                                  {conversionLine(usd)}
                                </p>
                              )}
                            </div>
                          );
                          return (
                            <div key={country} className="border-b border-border last:border-b-0">
                              <button
                                type="button"
                                aria-expanded={expanded}
                                onClick={() => setOpenCell(expanded ? null : cellKey)}
                                className={cn(
                                  COMPACT_COLS,
                                  "grid w-full items-center gap-x-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/40",
                                  expanded && "bg-muted/40",
                                )}
                              >
                                <span className="min-w-0 truncate">
                                  <span className="font-medium">
                                    {row.label || "Untitled variant"}
                                  </span>
                                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                                    {row.sku ?? "SKU on save"}
                                  </span>
                                </span>
                                <span className="text-xs text-muted-foreground">{country}</span>
                                <span className="tnum text-right">{formatUSD(cogsUsd)}</span>
                                <span className="tnum text-right">{formatUSD(feeUsd)}</span>
                                <span className="tnum text-right">
                                  {formatUSD(cellMargin(cell, rate))}
                                </span>
                                <span className="tnum text-right font-semibold">
                                  {formatUSD(cellPrice(cell, rate))}
                                </span>
                                <ChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
                                    expanded && "rotate-180",
                                  )}
                                />
                              </button>

                              {expanded && (
                                <div className="grid gap-4 border-t border-border bg-muted/15 p-3 lg:grid-cols-2">
                                  {/* Variant identity and terms. */}
                                  <div className="space-y-2">
                                    <Input
                                      value={row.label}
                                      onChange={(e) =>
                                        updateRow(row.key, { label: e.target.value })
                                      }
                                      placeholder='e.g. "20cm", "Red / L"'
                                      disabled={!rowEditable}
                                      aria-label="Variant label"
                                      className="h-8 text-[13px]"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                      <Input
                                        type="number"
                                        min={1}
                                        value={row.moq}
                                        onChange={(e) => updateRow(row.key, { moq: e.target.value })}
                                        disabled={!rowEditable}
                                        placeholder="MOQ"
                                        aria-label="MOQ"
                                        className="h-8 tnum text-[13px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
                                        className="h-8 tnum text-[13px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                      />
                                    </div>
                                    {rowEditable && countries.length > 1 && (
                                      <div className="space-y-1">
                                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                          Copy {countries[0]} → all
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                          {GRID_FIELDS.map((f) => (
                                            <button
                                              key={f.key}
                                              type="button"
                                              onClick={() => copyAcross(row.key, f.key)}
                                              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                                            >
                                              {f.short ?? f.label}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {moneyField("supplier_cogs", "COGS", cogsUsd)}
                                    <p className="pl-[4.25rem] text-[11px] leading-tight text-muted-foreground">
                                      Supplier unit price Ex Works — excludes all freight.
                                    </p>
                                    {moneyField("supplier_shipping", "Ship", shipUsd)}
                                    <div className="flex items-center gap-1">
                                      <span className="w-12 shrink-0 text-[11px] leading-tight text-muted-foreground">
                                        IOSS $
                                      </span>
                                      <Input
                                        inputMode="decimal"
                                        value={cell.supplier_tax}
                                        onChange={(e) =>
                                          updateCell(row.key, country, {
                                            supplier_tax: e.target.value,
                                          })
                                        }
                                        onBlur={(e) =>
                                          updateCell(row.key, country, {
                                            supplier_tax: money2(e.target.value || 0),
                                          })
                                        }
                                        disabled={!cellEditable}
                                        aria-label={`Import tax per unit in USD (${country})`}
                                        className="h-8 tnum text-[13px]"
                                      />
                                    </div>
                                    <p className="pl-[3.25rem] text-[11px] leading-tight text-muted-foreground">
                                      {isEuCountry(country)
                                        ? "EU — $3.50/unit passthrough, always USD"
                                        : "usually 0 — always USD"}
                                    </p>
                                    {rowEditable && rows.length > 1 && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1 px-1.5 text-[11px] text-muted-foreground"
                                        onClick={() =>
                                          setRows((prev) => prev.filter((r) => r.key !== row.key))
                                        }
                                      >
                                        <Trash2 className="h-3 w-3" /> Remove variant
                                      </Button>
                                    )}
                                  </div>

                                  {/* Percentages and the USD chain. */}
                                  <div className="space-y-2">
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <div className="space-y-1 rounded-lg border border-border/60 bg-background p-2">
                                        <Label className="text-[11px] font-medium">Agent fee %</Label>
                                        <div className="flex items-center justify-between gap-1.5">
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            max="100"
                                            value={feePctLabel}
                                            onChange={(e) =>
                                              updateCell(row.key, country, {
                                                fee_rate: (Number(e.target.value) || 0) / 100,
                                              })
                                            }
                                            disabled={!cellEditable || cell.fee_included}
                                            aria-label={`Agent fee % (${country})`}
                                            className="h-8 w-[4.5rem] tnum text-[13px]"
                                          />
                                          <span className="tnum text-[13px] font-medium">
                                            {formatUSD(feeUsd)}
                                          </span>
                                        </div>
                                        {agentTier && (
                                          <p className="text-[11px] leading-tight text-muted-foreground">
                                            Tier: {pct(agentTier.rate)}
                                            {agentTier.nextAt != null
                                              ? ` · ${agentTier.count}/${agentTier.nextAt} paid orders to next tier`
                                              : " · final tier"}
                                          </p>
                                        )}
                                      </div>
                                      <div className="space-y-1 rounded-lg border border-border/60 bg-background p-2">
                                        <Label className="text-[11px] font-medium">Margin %</Label>
                                        <div className="flex items-center justify-between gap-1.5">
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={cell.margin_pct}
                                            onChange={(e) =>
                                              updateCell(row.key, country, {
                                                margin_pct: e.target.value,
                                              })
                                            }
                                            onBlur={(e) =>
                                              updateCell(row.key, country, {
                                                margin_pct: money2(e.target.value || 0),
                                              })
                                            }
                                            disabled={!cellEditable}
                                            aria-label={`Margin % (${country})`}
                                            className="h-8 w-[4.5rem] tnum text-[13px]"
                                          />
                                          <span className="tnum text-[13px] font-medium">
                                            {formatUSD(cellMargin(cell, rate))}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    {cell.fee_included && (
                                      <p className="text-[11px] leading-tight text-muted-foreground">
                                        Fee already included in the supplier cost — never applied
                                        twice.
                                      </p>
                                    )}
                                    {foreign && !cell.fee_included && (
                                      <p className="tnum text-[11px] leading-tight text-muted-foreground">
                                        Agent fee in supplier currency: {symbol}
                                        {(num(cell.supplier_cogs) * cell.fee_rate).toFixed(2)}
                                      </p>
                                    )}
                                    <div className="rounded-lg border border-border/60 bg-background p-2 text-[12px] text-muted-foreground">
                                      <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                                        <span>COGS (USD)</span>
                                        <span className="tnum text-right">
                                          {formatUSD(cogsUsd)}
                                        </span>
                                      </div>
                                      {shipUsd > 0 && (
                                        <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                                          <span>Ship</span>
                                          <span className="tnum text-right">
                                            {formatUSD(shipUsd)}
                                          </span>
                                        </div>
                                      )}
                                      <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                                        <span>
                                          Agent fee ({feePctLabel}% of {symbol}
                                          {num(cell.supplier_cogs).toFixed(2)})
                                        </span>
                                        <span className="tnum text-right">{formatUSD(feeUsd)}</span>
                                      </div>
                                      <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 font-medium text-foreground">
                                        <span>Sourcing cost</span>
                                        <span className="tnum text-right">
                                          {formatUSD(cellSourcingCost(cell, rate))}
                                        </span>
                                      </div>
                                      <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                                        <span>
                                          FlySales margin ({marginPctLabel}% of {formatUSD(cogsUsd)}{" "}
                                          COGS)
                                        </span>
                                        <span className="tnum text-right">
                                          {formatUSD(cellMargin(cell, rate))}
                                        </span>
                                      </div>
                                      {num(cell.supplier_tax) > 0 && (
                                        <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                                          <span>Tax passthrough</span>
                                          <span className="tnum text-right">
                                            {formatUSD(num(cell.supplier_tax))}
                                          </span>
                                        </div>
                                      )}
                                      <div className="mt-1 grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-border pt-1">
                                        <span className="font-semibold uppercase text-foreground">
                                          Client price
                                        </span>
                                        <span className="tnum text-right text-sm font-bold text-foreground">
                                          {formatUSD(cellPrice(cell, rate))}
                                        </span>
                                      </div>
                                    </div>
                                    {locked && (
                                      <LineStatusBadge status={cell.status as "accepted" | "rejected"} />
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {requestEditable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    setRows((prev) => [...prev, emptyVariant(countries, defaultMargin)])
                  }
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
                <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-3 border-t border-border bg-card/95 px-6 py-3 backdrop-blur">
                  {dirty ? (
                    <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                      Unsaved changes
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">All changes saved</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      type="button"
                      variant={dirty ? "default" : "outline"}
                      disabled={save.isPending || publish.isPending || !dirty}
                      onClick={() => save.mutate()}
                    >
                      {save.isPending ? "Saving…" : "Save changes"}
                    </Button>
                    <Button
                      type="submit"
                      variant={dirty ? "outline" : "default"}
                      disabled={dirty || save.isPending || publish.isPending}
                      title={dirty ? "Save your changes first" : undefined}
                    >
                      {publish.isPending ? "Publishing…" : "Publish quote to client"}
                    </Button>
                  </div>
                  {dirty && (
                    <p className="w-full text-xs text-muted-foreground">Save your changes first</p>
                  )}
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
