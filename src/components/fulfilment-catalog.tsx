/**
 * The fulfilment catalog: one row per SKU (variation), shared by the client
 * and admin Fulfilment → Products tabs. Admin passes `isAdmin` to unlock the
 * full pricing chain, supplier attribution, lead-time origins and photo
 * management inside the SKU detail.
 */
import * as React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus } from "lucide-react";
import { Chip, EmptyCell, TableShell, Value } from "@/components/admin-ui";
import { EmptyState } from "@/components/app-shell";
import { PhotoManagerDialog } from "@/components/photo-manager";
import { ProductThumb } from "@/components/product-thumb";
import { SkuText } from "@/components/sku-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatUSD } from "@/lib/format";
import {
  adminGetFulfilmentSku,
  adminSetProductWeight,
  getFulfilmentSku,
} from "@/lib/fulfilment.functions";

export type CatalogRow = {
  id: string;
  sku: string;
  product_name: string;
  variant_label: string | null;
  fulfilment_model: string;
  status: string;
  archived_at: string | null;
  image_urls: string[];
  client_owned: boolean;
  store_id: string;
  store_name: string | null;
  sellable: number | null;
  days_of_cover: number | null;
  weight_grams?: number | null;
};

function ModelChip({ model }: { model: string }) {
  return (
    <Chip tone={model === "stock_in" ? "info" : "neutral"}>
      {model === "stock_in" ? "stock_in" : "per_order"}
    </Chip>
  );
}

export function FulfilmentCatalog({
  rows,
  isPending,
  isAdmin = false,
  showWorkspace = false,
  invalidateKeys = [],
}: {
  rows: CatalogRow[];
  isPending: boolean;
  isAdmin?: boolean;
  showWorkspace?: boolean;
  invalidateKeys?: unknown[][];
}) {
  const [openSku, setOpenSku] = React.useState<CatalogRow | null>(null);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No fulfilment SKUs yet"
        hint="A variation lands here when its quote is accepted, or when stock you own is registered. Direct-to-client purchases stay in Stock purchases."
      />
    );
  }

  return (
    <>
      <TableShell>
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 w-12"></TableHead>
              <TableHead className="h-9">SKU</TableHead>
              <TableHead className="h-9">Product / variation</TableHead>
              {showWorkspace && <TableHead className="h-9">Workspace</TableHead>}
              <TableHead className="h-9">Model</TableHead>
              <TableHead className="h-9 text-right">Stock</TableHead>
              <TableHead className="h-9 text-right">Days of cover</TableHead>
              <TableHead className="h-9 text-right">Weight</TableHead>
              <TableHead className="h-9">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer hover:bg-accent/60"
                onClick={() => setOpenSku(r)}
              >
                <TableCell className="py-2">
                  <ProductThumb imageUrls={r.image_urls} name={r.product_name} />
                </TableCell>
                <TableCell className="py-2">
                  <SkuText sku={r.sku} />
                </TableCell>
                <TableCell className="max-w-64 py-2">
                  <div className="truncate font-medium">{r.product_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.variant_label ?? "Single variation"}
                  </div>
                </TableCell>
                {showWorkspace && (
                  <TableCell className="max-w-40 truncate py-2">
                    <Value>{r.store_name}</Value>
                  </TableCell>
                )}
                <TableCell className="py-2">
                  <ModelChip model={r.fulfilment_model} />
                </TableCell>
                <TableCell className="tnum py-2 text-right">
                  {r.fulfilment_model === "stock_in" && r.sellable != null ? (
                    r.sellable
                  ) : (
                    <EmptyCell />
                  )}
                </TableCell>
                <TableCell className="tnum py-2 text-right">
                  {r.fulfilment_model === "stock_in" && r.days_of_cover != null ? (
                    `${r.days_of_cover}d`
                  ) : (
                    <EmptyCell />
                  )}
                </TableCell>
                <TableCell className="tnum py-2 text-right">
                  {r.weight_grams != null ? `${r.weight_grams} g` : <EmptyCell />}
                </TableCell>
                <TableCell className="py-2">
                  <Chip
                    tone={r.archived_at ? "neutral" : r.status === "active" ? "success" : "warning"}
                  >
                    {r.archived_at ? "archived" : r.status}
                  </Chip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>

      <SkuDetailDialog
        row={openSku}
        onClose={() => setOpenSku(null)}
        isAdmin={isAdmin}
        invalidateKeys={invalidateKeys}
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function SkuDetailDialog({
  row,
  onClose,
  isAdmin,
  invalidateKeys = [],
}: {
  row: CatalogRow | null;
  onClose: () => void;
  isAdmin: boolean;
  invalidateKeys?: unknown[][];
}) {
  const fetchClient = useServerFn(getFulfilmentSku);
  const fetchAdmin = useServerFn(adminGetFulfilmentSku);
  const [photosOpen, setPhotosOpen] = React.useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["fulfilment-sku", row?.id ?? "", isAdmin],
    enabled: row != null,
    queryFn: () =>
      isAdmin
        ? fetchAdmin({ data: { productId: row!.id } })
        : fetchClient({ data: { productId: row!.id } }),
  });

  const chain = (data as { chain?: Record<string, number | boolean | null> | null } | undefined)
    ?.chain;
  const lead = data?.leadTimes as
    (Record<string, number | string | null> & { production_lead: number }) | null | undefined;

  return (
    <>
      <Dialog open={row != null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {row?.product_name}
              <SkuText sku={row?.sku} />
            </DialogTitle>
            <DialogDescription>
              {row?.variant_label ?? "Single variation"} ·{" "}
              {row?.fulfilment_model === "stock_in" ? "Stock in warehouse" : "Per order"}
            </DialogDescription>
          </DialogHeader>

          {isPending || !data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-5">
              <Section title="Photos">
                <div className="flex flex-wrap items-center gap-2">
                  {(data.product.image_urls ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No photos yet.</p>
                  ) : (
                    (data.product.image_urls as string[]).map((u) => (
                      <ProductThumb key={u} imageUrls={[u]} name={row?.product_name} size={72} />
                    ))
                  )}
                  {isAdmin && (
                    <Button variant="outline" size="sm" onClick={() => setPhotosOpen(true)}>
                      <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                      Manage photos
                    </Button>
                  )}
                </div>
              </Section>

              <Section title="Pricing">
                <div className="flex flex-wrap gap-1.5">
                  {(data.prices ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No accepted price yet.</p>
                  ) : (
                    (
                      data.prices as {
                        country_code: string;
                        unit_price: number;
                        lead_time_days: number | null;
                      }[]
                    ).map((p) => (
                      <span
                        key={p.country_code}
                        className="tnum inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-xs"
                      >
                        <span className="font-semibold">{p.country_code}</span>
                        {formatUSD(p.unit_price)}
                        {p.lead_time_days != null && (
                          <span className="text-muted-foreground">· {p.lead_time_days}d</span>
                        )}
                      </span>
                    ))
                  )}
                </div>
                {isAdmin && chain && (
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border p-3 text-xs sm:grid-cols-3">
                    <span>Supplier goods: {formatUSD(chain["supplier_cogs"] as number)}</span>
                    <span>
                      Supplier shipping: {formatUSD(chain["supplier_shipping"] as number)}
                    </span>
                    <span>Import tax: {formatUSD(chain["supplier_tax"] as number)}</span>
                    <span>Sourcing cost: {formatUSD(chain["sourcing_cost"] as number)}</span>
                    <span>
                      Sourcing fee: {((chain["sourcing_fee_rate"] as number) ?? 0) * 100}%
                      {chain["fee_included"] ? " (included)" : ""}
                    </span>
                    <span>Margin: {chain["margin_pct"] as number}%</span>
                    <span className="font-semibold">
                      Client price: {formatUSD(chain["client_price"] as number)}
                    </span>
                  </div>
                )}
              </Section>

              <Section title="Lead times">
                {lead ? (
                  <p className="text-sm">
                    Production {lead["production_lead"]}d
                    {isAdmin && lead["production_origin"] ? ` (${lead["production_origin"]})` : ""}{" "}
                    · Transit {lead["transit_lead"]}d
                    {isAdmin && lead["transit_origin"] ? ` (${lead["transit_origin"]})` : ""} ·
                    Safety {lead["safety_margin"]}d
                    {isAdmin && lead["safety_origin"] ? ` (${lead["safety_origin"]})` : ""}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not resolved yet.</p>
                )}
              </Section>

              <Section title="Weight">
                {isAdmin ? (
                  <WeightEditor
                    productId={data.product.id as string}
                    initial={
                      (data.product as { weight_grams?: number | null }).weight_grams ?? null
                    }
                    invalidateKeys={invalidateKeys}
                  />
                ) : (
                  <p className="text-sm">
                    {(data.product as { weight_grams?: number | null }).weight_grams != null
                      ? `${(data.product as { weight_grams?: number | null }).weight_grams} g per unit`
                      : "Not recorded yet."}
                  </p>
                )}
              </Section>

              {isAdmin && (
                <Section title="Supplier">
                  <p className="text-sm">
                    {(data.supplier as { name: string } | null)?.name ?? "Not linked"}
                  </p>
                </Section>
              )}

              <Section title="Orders with this SKU">
                {(data.orders ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No orders yet.</p>
                ) : (
                  <div className="space-y-1">
                    {(
                      data.orders as {
                        id: string;
                        order_number: string;
                        status: string;
                        created_at: string;
                        quantity: number;
                        line_total: number;
                      }[]
                    ).map((o) => (
                      <div key={o.id} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs">{o.order_number}</span>
                        <span className="text-muted-foreground">{o.status}</span>
                        <span className="tnum">{o.quantity} pcs</span>
                        <span className="tnum">{formatUSD(o.line_total)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(o.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Inbound receipts">
                {(data.inbound ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No inbound shipments yet.</p>
                ) : (
                  <div className="space-y-1">
                    {(
                      data.inbound as {
                        id: string;
                        status: string;
                        created_at: string;
                        received_at: string | null;
                        declared_qty: number;
                        counted_qty: number | null;
                      }[]
                    ).map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{s.status}</span>
                        <span className="tnum">
                          {s.counted_qty ?? s.declared_qty} / {s.declared_qty} pcs
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(s.received_at ?? s.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {isAdmin && (
        <PhotoManagerDialog
          open={photosOpen}
          onOpenChange={setPhotosOpen}
          target="product"
          id={row?.id ?? ""}
          name={row?.product_name ?? ""}
          initial={(data?.product?.image_urls as string[]) ?? []}
          invalidateKeys={[...(invalidateKeys as string[][]), ["fulfilment-sku"]]}
        />
      )}
    </>
  );
}

/** Admin-only per-variation weight, in grams. */
function WeightEditor({
  productId,
  initial,
  invalidateKeys,
}: {
  productId: string;
  initial: number | null;
  invalidateKeys?: unknown[][];
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial != null ? String(initial) : "");
  const call = useServerFn(adminSetProductWeight);
  const save = useMutation({
    mutationFn: () =>
      call({
        data: { productId, weight_grams: value.trim() === "" ? null : Number(value) },
      }),
    onSuccess: () => {
      toast.success("Weight saved");
      for (const key of invalidateKeys ?? []) void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["fulfilment-sku"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div className="flex items-end gap-2">
      <div className="w-40">
        <Label className="text-xs">Grams per unit</Label>
        <Input
          className="mt-1"
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 450"
        />
      </div>
      <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
