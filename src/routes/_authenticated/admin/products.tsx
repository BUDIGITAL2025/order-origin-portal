import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import {
  ProductStatusBadge,
  ProductTypeBadge,
  PushStatusBadge,
} from "@/components/status-badges";
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

function AdminProductsPage() {
  const queryClient = useQueryClient();
  const fetchProducts = useServerFn(adminListProducts);
  const callOverride = useServerFn(adminSetPriceOverride);
  const callStatus = useServerFn(adminSetProductStatus);
  const callRetry = useServerFn(adminRetryPush);

  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

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

  return (
    <div>
      <PageHeader
        title="Products"
        description="Every product across all clients — accepted quote variants and client bundles."
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={!statusFilter ? "default" : "outline"} onClick={() => setStatusFilter(null)}>
            All statuses
          </Button>
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
            >
              {s.replace("_", " ")}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={!typeFilter ? "default" : "outline"} onClick={() => setTypeFilter(null)}>
            All types
          </Button>
          {TYPE_FILTERS.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={typeFilter === t ? "default" : "outline"}
              onClick={() => setTypeFilter(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : products.length === 0 ? (
        <EmptyState title="No products" hint="Products appear when clients accept quote lines or create bundles." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Push</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const isBundle = p.product_type === "bundle";
                const bundlePrice = isBundle ? priceByBundle.get(p.id) : undefined;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{p.profiles?.company_name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{p.product_name}</div>
                      {p.variant_label && (
                        <div className="text-xs text-muted-foreground">{p.variant_label}</div>
                      )}
                      {isBundle && (
                        <div className="text-xs text-muted-foreground">
                          {bundlePrice?.component_count ?? 0} components
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                    <TableCell>
                      <ProductTypeBadge type={p.product_type} />
                    </TableCell>
                    <TableCell className="text-right">
                      {isBundle ? (
                        <div>
                          <div className="font-mono text-sm">
                            {bundlePrice?.effective_price != null
                              ? formatUSD(bundlePrice.effective_price)
                              : "—"}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">
                            calc{" "}
                            {bundlePrice?.calculated_price != null
                              ? formatUSD(bundlePrice.calculated_price)
                              : "—"}
                            {p.price_override != null
                              ? ` · override ${formatUSD(p.price_override)}`
                              : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono text-sm">
                          {p.unit_price != null ? formatUSD(p.unit_price) : "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ProductStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <PushStatusBadge status={p.push_status} />
                        {p.push_status === "failed" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title={p.push_error ?? "Retry push"}
                            disabled={retry.isPending}
                            onClick={() => retry.mutate(p.id)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {p.push_status === "failed" && p.push_error && (
                        <div className="mt-1 max-w-48 truncate text-xs text-destructive">
                          {p.push_error}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(p.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {isBundle && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setOverrideValue(
                                p.price_override != null ? String(p.price_override) : "",
                              );
                              setOverrideFor(p);
                            }}
                          >
                            Override
                          </Button>
                        )}
                        {p.status !== "discontinued" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ productId: p.id, status: "discontinued" })}
                          >
                            Discontinue
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ productId: p.id, status: "active" })}
                          >
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={overrideFor != null} onOpenChange={(open) => !open && setOverrideFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Price override — {overrideFor?.product_name}</DialogTitle>
            <DialogDescription>
              Set a fixed sell price for this bundle. Leave empty to clear the override and use the
              calculated price ({overrideFor && formatUSD(priceByBundle.get(overrideFor.id)?.calculated_price ?? 0)}).
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
