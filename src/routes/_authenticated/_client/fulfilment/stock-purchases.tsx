import { createFileRoute } from "@tanstack/react-router";
import { ProductCell } from "@/components/product-thumb";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Building2, PackagePlus, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, FULFILMENT_TABS } from "@/components/section-tabs";
import { getCurrentStoreId, STORE_CHANGED_EVENT } from "@/components/store-switcher";
import { Chip, SummaryBar, TableShell } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatUSD } from "@/lib/format";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import {
  createStockPurchase,
  finalizeStockPurchasePayment,
  listMyStockPurchases,
  listOrderableLines,
  payStockPurchase,
} from "@/lib/purchases.functions";
import { createStockPurchaseSchema } from "@/lib/schemas";

const WAREHOUSE_MIN = 10;

const STATUS_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  requested: "warning",
  freight_quoted: "warning",
  paid: "primary",
  in_production: "primary",
  shipped: "primary",
  delivered: "success",
  cancelled: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Awaiting payment",
  freight_quoted: "Freight quoted",
  paid: "Paid",
  in_production: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function safeEnvironment(): "sandbox" | "live" | null {
  try {
    return getStripeEnvironment();
  } catch {
    return null;
  }
}

/** Keeps the page in step with the workspace switcher in the top bar. */
function useStoreId() {
  const [storeId, setStoreId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setStoreId(getCurrentStoreId());
    read();
    window.addEventListener(STORE_CHANGED_EVENT, read);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, read);
  }, []);
  return storeId;
}

export const Route = createFileRoute("/_authenticated/_client/fulfilment/stock-purchases")({
  head: () => ({
    meta: [
      { title: "Stock purchases — FlySales" },
      {
        name: "description",
        content:
          "Buy stock at your quoted price and choose whether it lands in our warehouse or ships straight to you.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StockPurchasesPage,
});

function StockPurchasesPage() {
  const storeId = useStoreId();
  const queryClient = useQueryClient();
  const environment = safeEnvironment();

  const fetchPurchases = useServerFn(listMyStockPurchases);
  const fetchLines = useServerFn(listOrderableLines);
  const callPay = useServerFn(payStockPurchase);
  const callFinalize = useServerFn(finalizeStockPurchasePayment);

  const { data: purchases, isPending } = useQuery({
    queryKey: ["my-stock-purchases", storeId],
    enabled: !!storeId,
    queryFn: () => fetchPurchases({ data: { storeId: storeId! } }),
  });
  const { data: lines } = useQuery({
    queryKey: ["orderable-lines", storeId],
    enabled: !!storeId,
    queryFn: () => fetchLines({ data: { storeId: storeId! } }),
  });

  const [orderOpen, setOrderOpen] = useState(false);

  const rows = purchases ?? [];
  const awaiting = rows.filter((p) => p.status === "requested" || p.status === "freight_quoted");
  const inFlight = rows.filter((p) =>
    ["paid", "in_production", "shipped"].includes(p.status),
  );
  const spend = rows
    .filter((p) => p.paid_at)
    .reduce((sum, p) => sum + Number(p.total_amount ?? 0), 0);

  const pay = useMutation({
    mutationFn: async (purchaseId: string) => {
      if (!environment) throw new Error("Payments are not available in this environment yet.");
      const result = await callPay({ data: { purchase_id: purchaseId, environment } });
      if ("error" in result) throw new Error(String(result.error));
      if (result.status === "requires_action") {
        const stripe = await getStripe();
        if (!stripe) throw new Error("Stripe could not be loaded.");
        const { error } = await stripe.handleNextAction({ clientSecret: result.clientSecret });
        if (error) throw new Error(error.message ?? "Card authentication failed.");
        const done = await callFinalize({
          data: {
            purchase_id: purchaseId,
            environment,
            paymentIntentId: result.paymentIntentId,
          },
        });
        if ("error" in done) throw new Error(String(done.error));
        return done;
      }
      return result;
    },
    onSuccess: async () => {
      toast.success("Purchase paid. We are placing it with the supplier now.");
      await queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e, "The purchase was not paid.")),
  });

  return (
    <div>
      <PageHeader
        title="Stock purchases"
        description="Buy stock upfront at your quoted price. Send it to our warehouse for fulfilment, or straight to your own address."
        actions={
          <Button size="sm" onClick={() => setOrderOpen(true)} disabled={!storeId}>
            <PackagePlus className="mr-1.5 h-4 w-4" />
            Order stock
          </Button>
        }
      />
      <SectionTabs tabs={FULFILMENT_TABS} />

      <SummaryBar
        items={[
          { key: "awaiting", label: "Awaiting payment", value: String(awaiting.length), tone: "warning" },
          { key: "inflight", label: "In progress", value: String(inFlight.length), tone: "primary" },
          {
            key: "delivered",
            label: "Delivered",
            value: String(rows.filter((p) => p.status === "delivered").length),
            tone: "success",
          },
          { key: "spend", label: "Total paid", value: formatUSD(spend) },
        ]}
      />

      {isPending || !storeId ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No stock purchases yet"
          hint="Accept a quote, then buy the first batch at that price. Minimum 10 units when we hold the stock for you."
        />
      ) : (
        <TableShell>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">{p.ref}</TableCell>
                <TableCell className="max-w-64">
                  <ProductCell
                    imageUrls={
                      (p as { products?: { image_urls?: string[] } | null }).products?.image_urls ??
                      []
                    }
                    name={p.product_name}
                    {...(p.variant_label ? { secondary: p.variant_label } : {})}
                  />
                  <div className="text-[11px] text-muted-foreground">{formatDate(p.created_at)}</div>
                </TableCell>
                <TableCell className="text-right tnum text-sm">{p.quantity}</TableCell>
                <TableCell className="text-right tnum text-sm">
                  {formatUSD(Number(p.unit_price))}
                </TableCell>
                <TableCell className="text-right tnum text-sm font-medium">
                  {p.payable_total != null ? formatUSD(p.payable_total) : "Freight pending"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {p.path === "flysales" ? "FlySales warehouse" : "Direct to you"}
                </TableCell>
                <TableCell>
                  <Chip tone={STATUS_TONE[p.status] ?? "neutral"}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Chip>
                  {p.tracking_number ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {p.tracking_carrier} {p.tracking_number}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {p.payable_total != null && !p.paid_at && p.status !== "cancelled" ? (
                    <Button
                      size="sm"
                      disabled={pay.isPending}
                      onClick={() => pay.mutate(p.id)}
                    >
                      Pay {formatUSD(p.payable_total)}
                    </Button>
                  ) : p.status === "requested" && p.path === "direct" ? (
                    <span className="text-xs text-muted-foreground">Quoting freight…</span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableShell>
      )}

      <OrderStockDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        lines={lines ?? []}
        storeId={storeId}
      />
    </div>
  );
}

type OrderableLine = {
  line_id: string;
  product_name: string;
  variant_label: string | null;
  country_code: string;
  unit_price: number;
  moq: number;
  production_lead_days: number | null;
};

function OrderStockDialog({
  open,
  onOpenChange,
  lines,
  storeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lines: OrderableLine[];
  storeId: string | null;
}) {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createStockPurchase);

  const [lineId, setLineId] = useState<string>("");
  const [path, setPath] = useState<"flysales" | "direct">("flysales");
  const [quantity, setQuantity] = useState("");
  const [address, setAddress] = useState({
    address1: "",
    address2: "",
    city: "",
    postal_code: "",
    state: "",
    country: "",
  });

  const line = useMemo(() => lines.find((l) => l.line_id === lineId) ?? null, [lines, lineId]);
  const minimum = line ? (path === "flysales" ? Math.max(line.moq, WAREHOUSE_MIN) : line.moq) : 0;
  const units = Number(quantity);
  const goods = line && Number.isFinite(units) ? line.unit_price * units : 0;

  const create = useMutation({
    mutationFn: async () => {
      const parsed = createStockPurchaseSchema.safeParse({
        quote_line_id: lineId,
        path,
        quantity: units,
        ...(path === "direct" ? { delivery_address: address } : {}),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your input");
      return callCreate({ data: parsed.data });
    },
    onSuccess: async (r) => {
      toast.success(
        path === "flysales"
          ? `Purchase ${r.purchase.ref} created. Pay it to start production.`
          : `Purchase ${r.purchase.ref} created. We will quote the freight to your address.`,
      );
      onOpenChange(false);
      setQuantity("");
      await queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e, "The purchase was not created.")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Order stock</DialogTitle>
          <DialogDescription>
            Buy at your quoted price and choose where the stock lands.
          </DialogDescription>
        </DialogHeader>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no accepted quotes for this workspace yet. Accept a quote first and it will
            appear here.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select value={lineId} onValueChange={setLineId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an accepted variant" />
                </SelectTrigger>
                <SelectContent>
                  {lines.map((l) => (
                    <SelectItem key={l.line_id} value={l.line_id}>
                      {l.product_name}
                      {l.variant_label ? ` — ${l.variant_label}` : ""} ({l.country_code}) ·{" "}
                      {formatUSD(l.unit_price)}/unit
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    value: "flysales" as const,
                    icon: Warehouse,
                    title: "FlySales warehouse",
                    hint: "We store, pick and ship each order. Minimum 10 units.",
                  },
                  {
                    value: "direct" as const,
                    icon: Building2,
                    title: "Direct to you",
                    hint: "Straight to your address. We quote the freight first.",
                  },
                ]
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPath(option.value)}
                  className={cn(
                    "rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/50",
                    path === option.value && "border-primary bg-primary/5",
                  )}
                >
                  <option.icon className="mb-1.5 h-4 w-4 text-muted-foreground" />
                  <div className="text-sm font-medium">{option.title}</div>
                  <div className="text-xs text-muted-foreground">{option.hint}</div>
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>Units</Label>
              <Input
                inputMode="numeric"
                value={quantity}
                placeholder={minimum ? String(minimum) : "100"}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {line ? (
                <p className="text-xs text-muted-foreground">
                  Minimum {minimum} units
                  {line.production_lead_days != null
                    ? ` · about ${line.production_lead_days} days production`
                    : ""}
                </p>
              ) : null}
            </div>

            {path === "direct" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Address</Label>
                  <Input
                    value={address.address1}
                    placeholder="Street and number"
                    onChange={(e) => setAddress((a) => ({ ...a, address1: e.target.value }))}
                  />
                </div>
                <Input
                  value={address.city}
                  placeholder="City"
                  onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                />
                <Input
                  value={address.postal_code}
                  placeholder="Postal code"
                  onChange={(e) => setAddress((a) => ({ ...a, postal_code: e.target.value }))}
                />
                <Input
                  value={address.state}
                  placeholder="State / region"
                  onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}
                />
                <Input
                  value={address.country}
                  maxLength={2}
                  placeholder="Country (US)"
                  onChange={(e) =>
                    setAddress((a) => ({ ...a, country: e.target.value.toUpperCase() }))
                  }
                />
              </div>
            ) : null}

            {line && units > 0 ? (
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Goods</span>
                  <span className="tnum font-medium">{formatUSD(goods)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {path === "flysales"
                    ? "Shipping to our warehouse is included in this price. Fulfilment fees apply per order later."
                    : "Freight to your address is quoted separately before you pay."}
                </p>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!storeId || !lineId || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create purchase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
