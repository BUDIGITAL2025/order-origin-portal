import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, RefreshCw, RotateCcw, Tag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import {
  ProductStatusBadge,
  ProductTypeBadge,
  PushStatusBadge,
} from "@/components/status-badges";
import {
  AdminSearch,
  EmptyCell,
  FilterTabs,
  RowAction,
  RowActions,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
} from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatUSD } from "@/lib/format";
import {
  adminListProducts,
  adminRetryPush,
  adminSetPriceOverride,
  adminSetProductStatus,
} from "@/lib/products.functions";

export const Route = createFileRoute("/_authenticated/admin/products")({
  head: () => ({
    meta: [
      { title: "Products — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminProductsPage,
});

type Product = {
  id: string;
  client_id: string;
  sku: string;
  product_name: string;
  variant_label: string | null;
  product_type: "simple" | "bundle";
  price_override: number | null;
  moq: number | null;
  status: "active" | "discontinued" | "needs_review";
  push_status: "pending" | "pushed" | "failed";
  push_error: string | null;
  middleware_product_id: string | null;
  created_at: string;
  profiles: { company_name: string } | null;
};

type BundlePrice = {
  bundle_product_id: string | null;
  country_code: string | null;
  calculated_price: number | null;
  component_count: number | null;
  effective_price: number | null;
  max_lead_time_days: number | null;
};

type CountryPrice = {
  product_id: string | null;
  country_code: string | null;
  unit_price: number | null;
  lead_time_days: number | null;
};

const STATUS_FILTERS = ["active", "needs_review", "discontinued"] as const;
const TYPE_FILTERS = ["simple", "bundle"] as const;

const STATUS_TABS = [
  { id: "all", label: "All statuses" },
  { id: "active", label: "Active" },
  { id: "needs_review", label: "Needs review" },
  { id: "discontinued", label: "Discontinued" },
] as const;
type StatusTab = (typeof STATUS_TABS)[number]["id"];

const TYPE_TABS = [
  { id: "all", label: "All types" },
  { id: "simple", label: "Simple" },
  { id: "bundle", label: "Bundle" },
] as const;
type TypeTab = (typeof TYPE_TABS)[number]["id"];

function AdminProductsPage() {
  const queryClient = useQueryClient();
  const fetchProducts = useServerFn(adminListProducts);
  const callOverride = useServerFn(adminSetPriceOverride);
  const callStatus = useServerFn(adminSetProductStatus);
  const callRetry = useServerFn(adminRetryPush);

  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");


  const { data, isPending } = useQuery({
    queryKey: ["admin-products", statusFilter ?? "all", typeFilter ?? "all"],
    queryFn: () =>
      fetchProducts({
        data: {
          ...(statusFilter ? { status: statusFilter as (typeof STATUS_FILTERS)[number] } : {}),
          ...(typeFilter ? { type: typeFilter as (typeof TYPE_FILTERS)[number] } : {}),
        },
      }),
  });
  // Summary counts always read the unfiltered set so the chips stay stable.
  const { data: allData } = useQuery({
    queryKey: ["admin-products", "all", "all"],
    queryFn: () => fetchProducts({ data: {} }),
  });
  const allProducts = (allData?.products ?? []) as unknown as Product[];

  const products = (data?.products ?? []) as unknown as Product[];
  const prices = (data?.prices ?? []) as BundlePrice[];
  const countryPrices = (data?.countryPrices ?? []) as CountryPrice[];
  const priceByBundle = new Map<string, BundlePrice[]>();
  for (const p of prices) {
    if (!p.bundle_product_id) continue;
    const list = priceByBundle.get(p.bundle_product_id) ?? [];
    list.push(p);
    priceByBundle.set(p.bundle_product_id, list);
  }
  const priceByProduct = new Map<string, CountryPrice[]>();
  for (const cp of countryPrices) {
    if (!cp.product_id) continue;
    const list = priceByProduct.get(cp.product_id) ?? [];
    list.push(cp);
    priceByProduct.set(cp.product_id, list);
  }

  const [overrideFor, setOverrideFor] = useState<Product | null>(null);
  const [overrideValue, setOverrideValue] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-products"] });
  };

  const setOverride = useMutation({
    mutationFn: (vars: { productId: string; value: number | null }) =>
      callOverride({ data: { product_id: vars.productId, price_override: vars.value } }),
    onSuccess: () => {
      toast.success("Price override updated.");
      setOverrideFor(null);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { productId: string; status: "active" | "discontinued" }) =>
      callStatus({ data: { product_id: vars.productId, status: vars.status } }),
    onSuccess: () => {
      toast.success("Status updated.");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const retry = useMutation({
    mutationFn: (productId: string) => callRetry({ data: { product_id: productId } }),
    onSuccess: () => {
      toast.success("Push requeued (pending).");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const term = search.trim().toLowerCase();
  const rows = products.filter((p) => {
    if (!term) return true;
    return [p.product_name, p.sku, p.variant_label ?? "", p.profiles?.company_name ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });
  const countBy = (fn: (p: Product) => boolean) => allProducts.filter(fn).length;

  return (
    <div>
      <PageHeader
        title="Products"
        description="Every product across all clients — accepted quote variants and client bundles."
      />

      <SummaryBar
        className="lg:grid-cols-4"
        items={[
          {
            key: "active",
            label: "Active",
            value: countBy((p) => p.status === "active"),
            tone: "success",
            active: statusFilter === "active",
            onClick: () => setStatusFilter(statusFilter === "active" ? null : "active"),
          },
          {
            key: "needs_review",
            label: "Needs review",
            value: countBy((p) => p.status === "needs_review"),
            tone: "warning",
            active: statusFilter === "needs_review",
            onClick: () => setStatusFilter(statusFilter === "needs_review" ? null : "needs_review"),
          },
          {
            key: "discontinued",
            label: "Discontinued",
            value: countBy((p) => p.status === "discontinued"),
            active: statusFilter === "discontinued",
            onClick: () =>
              setStatusFilter(statusFilter === "discontinued" ? null : "discontinued"),
          },
          {
            key: "push_failed",
            label: "Push failed",
            value: countBy((p) => p.push_status === "failed"),
            tone: "danger",
          },
        ]}
      />

      <ToolBar>
        <div className="flex flex-wrap items-center gap-2">
          <FilterTabs
            tabs={STATUS_TABS}
            value={(statusFilter ?? "all") as StatusTab}
            onChange={(id) => setStatusFilter(id === "all" ? null : id)}
          />
          <FilterTabs
            tabs={TYPE_TABS}
            value={(typeFilter ?? "all") as TypeTab}
            onChange={(id) => setTypeFilter(id === "all" ? null : id)}
          />
        </div>
        <AdminSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by product, SKU or client"
        />
      </ToolBar>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No products" hint="Products appear when clients accept quote lines or create bundles." />
      ) : (
        <TableShell>
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Client</TableHead>
                <TableHead className="h-9">Product</TableHead>
                <TableHead className="h-9">SKU</TableHead>
                <TableHead className="h-9">Type</TableHead>
                <TableHead className="h-9 text-right">Price</TableHead>
                <TableHead className="h-9">Status</TableHead>
                <TableHead className="h-9">Push</TableHead>
                <TableHead className="h-9">Created</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const isBundle = p.product_type === "bundle";
                const bundlePrices = isBundle ? (priceByBundle.get(p.id) ?? []) : [];
                const simplePrices = priceByProduct.get(p.id) ?? [];
                return (
                  <TableRow key={p.id} className="hover:bg-accent/60">
                    <TableCell className="max-w-40 truncate py-2.5">
                      <Value>{p.profiles?.company_name}</Value>
                    </TableCell>
                    <TableCell className="max-w-56 py-2.5">
                      <div className="truncate font-medium">{p.product_name}</div>
                      {p.variant_label && (
                        <div className="truncate text-xs text-muted-foreground">
                          {p.variant_label}
                        </div>
                      )}
                      {isBundle && (
                        <div className="text-xs text-muted-foreground">
                          {bundlePrices[0]?.component_count ?? 0} components
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">
                      {p.sku}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <ProductTypeBadge type={p.product_type} />
                    </TableCell>
                    <TableCell className="py-2.5 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {isBundle
                          ? bundlePrices.map((r) => (
                              <span
                                key={r.country_code}
                                className="tnum inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-xs"
                                title={`Calculated ${formatUSD(r.calculated_price ?? 0)}${p.price_override != null ? ` · override ${formatUSD(p.price_override)}` : ""}`}
                              >
                                <span className="font-semibold">{r.country_code}</span>
                                {r.effective_price != null ? formatUSD(r.effective_price) : "—"}
                              </span>
                            ))
                          : simplePrices.map((r) => (
                              <span
                                key={r.country_code}
                                className="tnum inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-xs"
                              >
                                <span className="font-semibold">{r.country_code}</span>
                                {r.unit_price != null ? formatUSD(r.unit_price) : "—"}
                                {r.lead_time_days != null && (
                                  <span className="text-muted-foreground">
                                    · {r.lead_time_days}d
                                  </span>
                                )}
                              </span>
                            ))}
                        {(isBundle ? bundlePrices : simplePrices).length === 0 && <EmptyCell />}
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <ProductStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <PushStatusBadge status={p.push_status} />
                        {p.push_status === "failed" && (
                          <RowAction
                            label={p.push_error ?? "Retry push"}
                            icon={RefreshCw}
                            disabled={retry.isPending}
                            onClick={() => retry.mutate(p.id)}
                          />
                        )}
                      </div>
                      {p.push_status === "failed" && p.push_error && (
                        <div className="mt-1 max-w-48 truncate text-xs text-destructive">
                          {p.push_error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">
                      {formatDate(p.created_at)}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <RowActions>
                        {isBundle && (
                          <RowAction
                            label="Set price override"
                            icon={Tag}
                            onClick={() => {
                              setOverrideValue(
                                p.price_override != null ? String(p.price_override) : "",
                              );
                              setOverrideFor(p);
                            }}
                          />
                        )}
                        {p.status !== "discontinued" ? (
                          <RowAction
                            label="Discontinue"
                            icon={Ban}
                            tone="danger"
                            disabled={setStatus.isPending}
                            onClick={() =>
                              setStatus.mutate({ productId: p.id, status: "discontinued" })
                            }
                          />
                        ) : (
                          <RowAction
                            label="Reactivate"
                            icon={RotateCcw}
                            tone="primary"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ productId: p.id, status: "active" })}
                          />
                        )}
                      </RowActions>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableShell>
      )}


      <Dialog open={overrideFor != null} onOpenChange={(open) => !open && setOverrideFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Price override — {overrideFor?.product_name}</DialogTitle>
            <DialogDescription>
              Set a fixed sell price for this bundle. Leave empty to clear the override and use the
              calculated price ({overrideFor && (priceByBundle.get(overrideFor.id) ?? []).map((r) => `${r.country_code} ${formatUSD(r.calculated_price ?? 0)}`).join(", ") || "—"}).
              Only admins can change this.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="override-price">Override price (USD)</Label>
            <Input
              id="override-price"
              type="number"
              step="0.01"
              min="0"
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              placeholder="Empty = calculated price"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={setOverride.isPending}
              onClick={() => {
                if (!overrideFor) return;
                setOverride.mutate({
                  productId: overrideFor.id,
                  value: overrideValue === "" ? null : Number(overrideValue),
                });
              }}
            >
              {setOverride.isPending ? "Saving…" : "Save override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
