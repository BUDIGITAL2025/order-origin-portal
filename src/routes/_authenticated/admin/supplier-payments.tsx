import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, ADMIN_SOURCING_TABS } from "@/components/section-tabs";
import { Chip, SummaryBar, TableShell } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatDate, formatUSD } from "@/lib/format";
import {
  adminListSupplierPayments,
  adminPurchaseDocumentUrl,
  adminRecordSupplierPayment,
} from "@/lib/po.functions";

export const Route = createFileRoute("/_authenticated/admin/supplier-payments")({
  head: () => ({
    meta: [
      { title: "Supplier payments — FlySales admin" },
      {
        name: "description",
        content: "Verified supplier invoices waiting for the payment that starts production.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SupplierPaymentsPage,
});

type Row = Awaited<ReturnType<typeof adminListSupplierPayments>>[number];

function SupplierPaymentsPage() {
  const qc = useQueryClient();
  const fetchRows = useServerFn(adminListSupplierPayments);
  const docUrl = useServerFn(adminPurchaseDocumentUrl);
  const recordPayment = useServerFn(adminRecordSupplierPayment);

  const { data, isPending } = useQuery({
    queryKey: ["admin-supplier-payments"],
    queryFn: fetchRows,
  });
  const rows = data ?? [];

  const [target, setTarget] = React.useState<Row | null>(null);
  const [paidOn, setPaidOn] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = React.useState<"wire" | "alibaba" | "other">("wire");
  const [reference, setReference] = React.useState("");
  const [proof, setProof] = React.useState<File | null>(null);

  const openDoc = useMutation({
    mutationFn: (args: { id: string; kind: "po" | "invoice" | "proof" }) =>
      docUrl({ data: { purchase_id: args.id, kind: args.kind } }),
    onSuccess: (r) => window.open(r.url, "_blank", "noopener"),
    onError: (e: Error) => toast.error(e.message),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("No purchase selected");
      let proofFields = {};
      if (proof) {
        const bytes = new Uint8Array(await proof.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        proofFields = {
          proof_base64: btoa(binary),
          proof_name: proof.name,
          proof_mime: proof.type as "application/pdf" | "image/png" | "image/jpeg" | "image/webp",
        };
      }
      return recordPayment({
        data: {
          purchase_id: target.id,
          paid_on: paidOn,
          method,
          ...(reference ? { reference } : {}),
          ...proofFields,
        },
      });
    },
    onSuccess: () => {
      toast.success("Supplier payment recorded — the purchase is now in production");
      setTarget(null);
      setProof(null);
      setReference("");
      void qc.invalidateQueries({ queryKey: ["admin-supplier-payments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verified = rows.filter((r) => r.invoice_state === "verified").length;
  const flagged = rows.filter((r) => r.invoice_state === "discrepancy").length;

  return (
    <div>
      <PageHeader
        title="Supplier payments"
        description="Invoices our sourcing agents uploaded against paid purchases. Record the payment here to start production."
      />
      <SectionTabs tabs={ADMIN_SOURCING_TABS} />

      <SummaryBar
        items={[
          { key: "queue", label: "In the queue", value: String(rows.length) },
          { key: "verified", label: "Verified", value: String(verified), tone: "success" },
          { key: "flagged", label: "Discrepancies", value: String(flagged), tone: "warning" },
        ]}
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing to pay"
          hint="A purchase lands here once the agent has sent the PO and uploaded the supplier invoice."
        />
      ) : (
        <TableShell>
          <TableHeader>
            <TableRow>
              <TableHead>PO</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Invoiced</TableHead>
              <TableHead>State</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs font-medium">
                  {r.po_number ?? r.ref}
                  <div className="text-[11px] text-muted-foreground">
                    {r.po_sent_at ? `Sent ${formatDate(r.po_sent_at)}` : "Not sent"}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{r.supplier_name ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.client_name ?? r.workspace_name ?? "—"}
                </TableCell>
                <TableCell className="max-w-56 text-sm">
                  {r.product_name}
                  {r.variant_label ? (
                    <span className="text-muted-foreground"> — {r.variant_label}</span>
                  ) : null}
                  <div className="text-[11px] text-muted-foreground">{r.quantity} units</div>
                </TableCell>
                <TableCell className="text-right tnum text-sm">
                  {r.expected_total != null ? formatUSD(r.expected_total) : "—"}
                </TableCell>
                <TableCell className="text-right tnum text-sm">
                  {r.invoiced_total != null ? formatUSD(r.invoiced_total) : "—"}
                </TableCell>
                <TableCell>
                  {r.invoice_state === "verified" ? (
                    <Chip tone="success">Verified</Chip>
                  ) : r.invoice_state === "discrepancy" ? (
                    <Chip tone="danger">Discrepancy</Chip>
                  ) : r.invoice_state ? (
                    <Chip tone="warning">Unreadable</Chip>
                  ) : (
                    <Chip tone="neutral">Awaiting invoice</Chip>
                  )}
                  {r.invoice_note ? (
                    <div className="mt-1 max-w-56 text-[11px] text-muted-foreground">
                      Agent: {r.invoice_note}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openDoc.mutate({ id: r.id, kind: "po" })}
                    >
                      PO
                    </Button>
                    {r.has_invoice_document ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDoc.mutate({ id: r.id, kind: "invoice" })}
                      >
                        Invoice
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      disabled={!r.has_invoice_document}
                      onClick={() => setTarget(r)}
                    >
                      Mark paid
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableShell>
      )}

      <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record the supplier payment</DialogTitle>
            <DialogDescription>
              {target
                ? `${target.supplier_name ?? "Supplier"} · ${
                    target.invoiced_total != null ? formatUSD(target.invoiced_total) : "—"
                  } invoiced against ${
                    target.expected_total != null ? formatUSD(target.expected_total) : "—"
                  } agreed.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="paid-on">Payment date</Label>
              <Input
                id="paid-on"
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="method">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wire">Bank wire</SelectItem>
                  <SelectItem value="alibaba">Alibaba</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="reference">Reference (optional)</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="proof">Proof of payment (optional)</Label>
              <input
                id="proof"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="block text-sm"
                onChange={(e) => setProof(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button className="w-full" onClick={() => pay.mutate()} disabled={pay.isPending}>
              {pay.isPending ? "Saving…" : "Mark paid to supplier"}
            </Button>
            <p className="text-xs text-muted-foreground">
              This starts production for the client and confirms the agent's commission.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
