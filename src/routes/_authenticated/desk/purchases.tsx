import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, DESK_TABS } from "@/components/section-tabs";
import { Chip, SummaryBar, TableShell } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatUSD } from "@/lib/format";
import { deskListPurchases } from "@/lib/po.functions";

export const PURCHASE_CHIPS: Record<
  string,
  { label: string; tone: "neutral" | "primary" | "success" | "warning" | "danger" }
> = {
  paid: { label: "Ready for PO", tone: "warning" },
  po_sent: { label: "PO sent", tone: "neutral" },
  invoice_uploaded: { label: "Invoice uploaded", tone: "neutral" },
  invoice_verified: { label: "Invoice verified", tone: "success" },
  invoice_discrepancy: { label: "Discrepancy", tone: "danger" },
  supplier_paid: { label: "Supplier paid", tone: "primary" },
  in_production: { label: "In production", tone: "primary" },
  shipped: { label: "Shipped", tone: "primary" },
  delivered: { label: "Delivered", tone: "success" },
};

export const Route = createFileRoute("/_authenticated/desk/purchases")({
  head: () => ({
    meta: [
      { title: "Purchases — FlySales sourcing desk" },
      {
        name: "description",
        content:
          "Paid stock purchases waiting for a purchase order, a supplier invoice and the supplier payment.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PurchasesPage,
});

function PurchasesPage() {
  const fetchPurchases = useServerFn(deskListPurchases);
  const { data, isPending } = useQuery({ queryKey: ["desk-purchases"], queryFn: fetchPurchases });

  const rows = data ?? [];
  const toDo = rows.filter((r) => r.status === "paid").length;
  const waiting = rows.filter((r) =>
    ["po_sent", "invoice_uploaded", "invoice_discrepancy"].includes(r.status),
  ).length;
  const committed = rows.reduce((sum, r) => sum + (r.expected_total ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Every purchase here is already paid by the client. Confirm the supplier, issue the purchase order and upload the supplier invoice."
      />
      <SectionTabs tabs={DESK_TABS} />

      <SummaryBar
        items={[
          { key: "todo", label: "Need a PO", value: String(toDo), tone: "warning" },
          { key: "waiting", label: "In progress", value: String(waiting), tone: "primary" },
          { key: "all", label: "Total purchases", value: String(rows.length) },
          { key: "value", label: "Supplier value", value: formatUSD(committed) },
        ]}
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No purchases yet"
          hint="A purchase appears here once a client pays for stock from a product you sourced."
        />
      ) : (
        <TableShell>
          <TableHeader>
            <TableRow>
              <TableHead>Paid</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Supplier total</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const chip = PURCHASE_CHIPS[p.status] ?? {
                label: p.status,
                tone: "neutral" as const,
              };
              return (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {p.paid_at ? formatDate(p.paid_at) : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-medium">{p.po_number ?? p.ref}</TableCell>
                  <TableCell className="max-w-72 text-sm">
                    {p.product_name}
                    {p.variant_label ? (
                      <span className="text-muted-foreground"> — {p.variant_label}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.client_label}</TableCell>
                  <TableCell className="text-right tnum text-sm">{p.quantity}</TableCell>
                  <TableCell className="text-right tnum text-sm">
                    {p.expected_total != null ? formatUSD(p.expected_total) : "—"}
                  </TableCell>
                  <TableCell>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant={p.status === "paid" ? "default" : "outline"}>
                      <Link to="/desk/purchase/$id" params={{ id: p.id }}>
                        {p.status === "paid" ? "Start PO" : "Open"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </TableShell>
      )}
    </div>
  );
}
