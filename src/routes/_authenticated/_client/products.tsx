import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Plus, X } from "lucide-react";
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
  component: MyProductsPage,
});

type Product = {
  id: string;
  sku: string;
  product_name: string;
  variant_label: string | null;
  product_type: "simple" | "bundle";
  unit_price: number | null;
  moq: number | null;
  lead_time_days: number | null;
  status: "active" | "discontinued" | "needs_review";
  created_at: string;
};

type Component = {
  id: string;
  bundle_product_id: string | null;
  component_product_id: string | null;
  quantity: number;
  component: { sku: string; product_name: string; variant_label: string | null; unit_price: number | null } | null;
};

type BundlePrice = {
  bundle_product_id: string | null;
  calculated_price: number | null;
  price_override: number | null;
  effective_price: number | null;
  lead_time_days: number | null;
  component_count: number | null;
};

function BundleDialog({
  mode,
  bundle,
  simpleProducts,
  existing,
  onClose,
}: {
  mode: "create" | "edit";
  bundle?: Product;
  simpleProducts: Product[];
  existing?: Component[];
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
  const calculatedTotal = selected.reduce(
    (acc, p) => acc + (p.unit_price ?? 0) * (quantities[p.id] ?? 0),
    0,
  );

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
          A bundle is one sellable SKU that explodes into simple SKUs at fulfilment. Pick
          components from your active simple products and set a quantity for each.
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
                  <div className="font-mono text-xs text-muted-foreground">
                    {p.sku} · {p.unit_price != null ? formatUSD(p.unit_price) : "—"}
                  </div>
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
        <span className="font-mono font-semibold">
          Calculated price: {formatUSD(Math.round(calculatedTotal * 100) / 100)}
        </span>
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

function MyProductsPage() {
  const queryClient = useQueryClient();
  const fetchProducts = useServerFn(listMyProducts);
  const callDiscontinue = useServerFn(discontinueMyBundle);

  const { data, isPending } = useQuery({
    queryKey: ["my-products"],
    queryFn: fetchProducts,
  });

  const products = (data?.products ?? []) as Product[];
  const components = (data?.components ?? []) as Component[];
  const prices = (data?.prices ?? []) as BundlePrice[];
  const priceByBundle = new Map(prices.map((p) => [p.bundle_product_id, p]));
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
        description="Your sellable catalogue. Accepted quote variants and bundles live here."
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
          hint="Accept quote lines and they'll appear here as catalogue products."
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
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">MOQ</TableHead>
                <TableHead className="text-right">Lead time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const isBundle = p.product_type === "bundle";
                const bundlePrice = isBundle ? priceByBundle.get(p.id) : undefined;
                const effectivePrice = isBundle
                  ? (bundlePrice?.effective_price ?? null)
                  : p.unit_price;
                const bundleComponents = componentsByBundle.get(p.id) ?? [];
                const isExpanded = expanded.has(p.id);
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
                            {bundlePrice?.component_count ?? bundleComponents.length} component
                            {(bundlePrice?.component_count ?? bundleComponents.length) === 1 ? "" : "s"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.sku}
                      </TableCell>
                      <TableCell>
                        <ProductTypeBadge type={p.product_type} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {effectivePrice != null ? formatUSD(effectivePrice) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{p.moq ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {p.lead_time_days != null ? `${p.lead_time_days}d` : "—"}
                      </TableCell>
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
                        <TableCell colSpan={8} className="bg-muted/20 p-0">
                          <div className="space-y-1 px-4 py-3">
                            {bundleComponents.map((c) => (
                              <div key={c.id} className="flex items-center justify-between text-sm">
                                <span>
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {c.component?.sku}
                                  </span>{" "}
                                  {c.component?.product_name}
                                  {c.component?.variant_label ? ` — ${c.component.variant_label}` : ""}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground">
                                  ×{c.quantity} ·{" "}
                                  {c.component?.unit_price != null
                                    ? formatUSD(c.component.unit_price * c.quantity)
                                    : "—"}
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
