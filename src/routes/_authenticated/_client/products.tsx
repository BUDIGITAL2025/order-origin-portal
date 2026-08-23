import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Copy, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { ProductStatusBadge, ProductTypeBadge } from "@/components/status-badges";
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
import { formatUSD } from "@/lib/format";
import {
  createBundle,
  discontinueMyBundle,
  listMyProducts,
  updateBundle,
} from "@/lib/products.functions";

export const Route = createFileRoute("/_authenticated/_client/products")({
  head: () => ({
    meta: [
      { title: "My products — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyProductsPageInner,
});

type Product = {
  id: string;
  sku: string;
  product_name: string;
  variant_label: string | null;
  product_type: "simple" | "bundle";
  moq: number | null;
  status: "active" | "discontinued" | "needs_review";
  created_at: string;
};

type CountryPrice = {
  product_id: string | null;
  country_code: string | null;
  unit_price: number | null;
  lead_time_days: number | null;
};

type Component = {
  id: string;
  bundle_product_id: string | null;
  component_product_id: string | null;
  quantity: number;
  component: { sku: string; product_name: string; variant_label: string | null } | null;
};

type BundlePrice = {
  bundle_product_id: string | null;
  country_code: string | null;
  calculated_price: number | null;
  component_count: number | null;
  effective_price: number | null;
  max_lead_time_days: number | null;
};

function CopySku({ sku }: { sku: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tnum text-xs text-muted-foreground">{sku}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        title="Copy SKU — your shop must use this exact SKU for order matching"
        onClick={async () => {
          await navigator.clipboard.writeText(sku);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </Button>
    </span>
  );
}

function PriceBadges({ entries }: { entries: { country: string; price: number; lead?: number | null }[] }) {
  if (entries.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {entries.map((e) => (
        <span
          key={e.country}
          className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 tnum text-xs"
        >
          <span className="font-semibold">{e.country}</span>
          {formatUSD(e.price)}
          {e.lead != null && <span className="text-muted-foreground">· {e.lead}d</span>}
        </span>
      ))}
    </div>
  );
}

function BundleDialog({
  mode,
  bundle,
  simpleProducts,
  priceByProduct,
  existing,
  onClose,
}: {
  mode: "create" | "edit";
  bundle?: Product | undefined;
  simpleProducts: Product[];
  priceByProduct: Map<string, CountryPrice[]>;
  existing?: Component[] | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createBundle);
  const callUpdate = useServerFn(updateBundle);

  const [name, setName] = useState(bundle?.product_name ?? "");
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const c of existing ?? []) {
      if (c.component_product_id) map[c.component_product_id] = c.quantity;
    }
    return map;
  });

  const selected = simpleProducts.filter((p) => (quantities[p.id] ?? 0) > 0);
  // Calculated bundle price per country: only countries priced on EVERY selected component.
  const totalsByCountry = new Map<string, number>();
  for (const p of selected) {
    for (const cp of priceByProduct.get(p.id) ?? []) {
      if (!cp.country_code || cp.unit_price == null) continue;
      totalsByCountry.set(
        cp.country_code,
        (totalsByCountry.get(cp.country_code) ?? 0) + cp.unit_price * (quantities[p.id] ?? 0),
      );
    }
  }
  for (const [country] of totalsByCountry) {
    const covered = selected.every((p) =>
      (priceByProduct.get(p.id) ?? []).some((cp) => cp.country_code === country),
    );
    if (!covered) totalsByCountry.delete(country);
  }

  const save = useMutation({
    mutationFn: () => {
      const components = selected.map((p) => ({
        product_id: p.id,
        quantity: quantities[p.id] ?? 1,
      }));
      if (mode === "create") {
        return callCreate({ data: { name: name.trim(), components } });
      }
      return callUpdate({
        data: { bundle_id: bundle!.id, name: name.trim(), components },
      });
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Bundle created." : "Bundle updated.");
      void queryClient.invalidateQueries({ queryKey: ["my-products"] });
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Create bundle" : `Edit ${bundle?.product_name}`}</DialogTitle>
        <DialogDescription>
          A bundle is one sellable SKU that explodes into simple SKUs at fulfilment. It is sellable
          in a country only when every component has a price there.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="bundle-name">Bundle name</Label>
        <Input
          id="bundle-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Starter Pack"
          maxLength={200}
        />
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-3">
        {simpleProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active simple products yet — accept quote lines first.
          </p>
        ) : (
          simpleProducts.map((p) => {
            const qty = quantities[p.id] ?? 0;
            return (
              <div key={p.id} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {p.product_name}
                    {p.variant_label ? ` — ${p.variant_label}` : ""}
                  </div>
                  <div className="tnum text-xs text-muted-foreground">{p.sku}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={`qty-${p.id}`} className="text-xs text-muted-foreground">
                    Qty
                  </Label>
                  <Input
                    id={`qty-${p.id}`}
                    type="number"
                    min={0}
                    className="w-20"
                    value={qty}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      setQuantities((prev) => ({ ...prev, [p.id]: v }));
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {selected.length} component{selected.length === 1 ? "" : "s"}
        </span>
        <PriceBadges
          entries={[...totalsByCountry.entries()].map(([country, price]) => ({
            country,
            price: Math.round(price * 100) / 100,
          }))}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending || name.trim().length < 2 || selected.length === 0}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : mode === "create" ? "Create bundle" : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function MyProductsPageInner() {
  const queryClient = useQueryClient();
  const fetchProducts = useServerFn(listMyProducts);
  const callDiscontinue = useServerFn(discontinueMyBundle);

  const { data, isPending } = useQuery({
    queryKey: ["my-products"],
    queryFn: fetchProducts,
  });

  const products = (data?.products ?? []) as Product[];
  const countryPrices = (data?.countryPrices ?? []) as CountryPrice[];
  const components = (data?.components ?? []) as Component[];
  const prices = (data?.prices ?? []) as BundlePrice[];

  const priceByProduct = new Map<string, CountryPrice[]>();
  for (const cp of countryPrices) {
    if (!cp.product_id) continue;
    const list = priceByProduct.get(cp.product_id) ?? [];
    list.push(cp);
    priceByProduct.set(cp.product_id, list);
  }
  const bundlePriceRows = new Map<string, BundlePrice[]>();
  for (const p of prices) {
    if (!p.bundle_product_id) continue;
    const list = bundlePriceRows.get(p.bundle_product_id) ?? [];
    list.push(p);
    bundlePriceRows.set(p.bundle_product_id, list);
  }
  const componentsByBundle = new Map<string, Component[]>();
  for (const c of components) {
    if (!c.bundle_product_id) continue;
    const list = componentsByBundle.get(c.bundle_product_id) ?? [];
    list.push(c);
    componentsByBundle.set(c.bundle_product_id, list);
  }

  const simpleActive = products.filter((p) => p.product_type === "simple" && p.status === "active");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; bundle: Product } | null>(
    null,
  );

  const discontinue = useMutation({
    mutationFn: (productId: string) => callDiscontinue({ data: { product_id: productId } }),
    onSuccess: () => {
      toast.success("Bundle discontinued.");
      void queryClient.invalidateQueries({ queryKey: ["my-products"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="My products"
        description="Your sellable catalogue, priced per country. Orders match on the FlySales SKU — use these exact SKUs in your Shopify store or manual orders."
        actions={
          <Dialog open={dialog != null} onOpenChange={(open) => !open && setDialog(null)}>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setDialog({ mode: "create" })}
              disabled={simpleActive.length === 0}
            >
              <Plus className="h-3.5 w-3.5" /> Create bundle
            </Button>
            {dialog && (
              <BundleDialog
                mode={dialog.mode}
                bundle={dialog.mode === "edit" ? dialog.bundle : undefined}
                simpleProducts={simpleActive}
                priceByProduct={priceByProduct}
                existing={
                  dialog.mode === "edit" ? componentsByBundle.get(dialog.bundle.id) : undefined
                }
                onClose={() => setDialog(null)}
              />
            )}
          </Dialog>
        }
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : products.length === 0 ? (
        <EmptyState
          title="No products yet"
          hint="Accept a quote to add your first product."
          action={{ label: "View quotes", to: "/quotes" }}
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Pricing by country</TableHead>
                <TableHead className="text-right">MOQ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const isBundle = p.product_type === "bundle";
                const bundleComponents = componentsByBundle.get(p.id) ?? [];
                const isExpanded = expanded.has(p.id);
                const priceEntries = isBundle
                  ? (bundlePriceRows.get(p.id) ?? [])
                      .filter((r) => r.country_code && r.effective_price != null)
                      .map((r) => ({
                        country: r.country_code!,
                        price: r.effective_price!,
                        lead: r.max_lead_time_days,
                      }))
                  : (priceByProduct.get(p.id) ?? [])
                      .filter((r) => r.country_code && r.unit_price != null)
                      .map((r) => ({
                        country: r.country_code!,
                        price: r.unit_price!,
                        lead: r.lead_time_days,
                      }));
                return (
                  <>
                    <TableRow key={p.id}>
                      <TableCell>
                        {isBundle && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => toggle(p.id)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{p.product_name}</div>
                        {p.variant_label && (
                          <div className="text-xs text-muted-foreground">{p.variant_label}</div>
                        )}
                        {isBundle && (
                          <div className="text-xs text-muted-foreground">
                            {bundleComponents.length} component{bundleComponents.length === 1 ? "" : "s"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <CopySku sku={p.sku} />
                      </TableCell>
                      <TableCell>
                        <ProductTypeBadge type={p.product_type} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PriceBadges entries={priceEntries} />
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{p.moq ?? "—"}</TableCell>
                      <TableCell>
                        <ProductStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {isBundle && p.status !== "discontinued" && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setDialog({ mode: "edit", bundle: p })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Discontinue this bundle?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Products are never deleted — discontinuing keeps the history
                                    while removing it from sale. This cannot be undone from your
                                    side.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    disabled={discontinue.isPending}
                                    onClick={() => discontinue.mutate(p.id)}
                                  >
                                    Discontinue
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {isBundle && isExpanded && (
                      <TableRow key={`${p.id}-components`}>
                        <TableCell />
                        <TableCell colSpan={7} className="bg-muted/20 p-0">
                          <div className="space-y-1 px-4 py-3">
                            {bundleComponents.map((c) => (
                              <div key={c.id} className="flex items-center justify-between text-sm">
                                <span>
                                  <span className="tnum text-xs text-muted-foreground">
                                    {c.component?.sku}
                                  </span>{" "}
                                  {c.component?.product_name}
                                  {c.component?.variant_label ? ` — ${c.component.variant_label}` : ""}
                                </span>
                                <span className="tnum text-xs text-muted-foreground">
                                  ×{c.quantity}
                                </span>
                              </div>
                            ))}
                            {bundleComponents.length === 0 && (
                              <p className="text-xs text-muted-foreground">No components found.</p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

