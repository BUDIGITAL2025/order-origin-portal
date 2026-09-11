import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Chip } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatUSD } from "@/lib/format";
import { PURCHASE_CHIPS } from "./purchases";
import {
  deskAnnotateInvoice,
  deskGeneratePo,
  deskGetPurchase,
  deskPurchaseDocumentUrl,
  deskSaveSupplier,
  deskSendPo,
  deskUploadInvoice,
} from "@/lib/po.functions";

export const Route = createFileRoute("/_authenticated/desk/purchase/$id")({
  head: () => ({
    meta: [
      { title: "Purchase order — FlySales sourcing desk" },
      {
        name: "description",
        content: "Confirm the supplier, issue the purchase order and upload the supplier invoice.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PurchaseDetailPage,
});

function Panel({
  title,
  step,
  children,
  hint,
}: {
  title: string;
  step: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {step}
        </p>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function PurchaseDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(deskGetPurchase);
  const saveSupplier = useServerFn(deskSaveSupplier);
  const generatePo = useServerFn(deskGeneratePo);
  const sendPo = useServerFn(deskSendPo);
  const docUrl = useServerFn(deskPurchaseDocumentUrl);
  const uploadInvoice = useServerFn(deskUploadInvoice);
  const annotate = useServerFn(deskAnnotateInvoice);

  const { data, isPending } = useQuery({
    queryKey: ["desk-purchase", id],
    queryFn: () => fetchDetail({ data: { purchase_id: id } }),
  });

  const purchase = data?.purchase;
  const supplier = data?.supplier ?? null;

  const [form, setForm] = React.useState({
    name: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    address: "",
    country: "",
  });
  const [terms, setTerms] = React.useState("");
  const [leadDays, setLeadDays] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (supplier) {
      setForm({
        name: supplier.name ?? "",
        contact_name: supplier.contact_name ?? "",
        contact_email: supplier.contact_email ?? "",
        contact_phone: supplier.contact_phone ?? "",
        address: supplier.address ?? "",
        country: supplier.country ?? "",
      });
    }
  }, [supplier]);

  React.useEffect(() => {
    if (data) {
      setTerms(purchase?.po_payment_terms ?? data.default_payment_terms);
      setLeadDays(purchase?.po_lead_days ? String(purchase.po_lead_days) : "");
      setNote(purchase?.invoice_note ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["desk-purchase", id] });
    void qc.invalidateQueries({ queryKey: ["desk-purchases"] });
  };

  const supplierMutation = useMutation({
    mutationFn: () =>
      saveSupplier({
        data: {
          purchase_id: id,
          name: form.name,
          contact_name: form.contact_name,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          address: form.address,
          country: form.country,
        },
      }),
    onSuccess: () => {
      toast.success("Supplier details saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const poMutation = useMutation({
    mutationFn: () =>
      generatePo({
        data: {
          purchase_id: id,
          payment_terms: terms,
          ...(leadDays ? { lead_days: Number(leadDays) } : {}),
          ...(notes ? { notes } : {}),
        },
      }),
    onSuccess: (r) => {
      toast.success(`Purchase order ${r.po_number} ready`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openDoc = useMutation({
    mutationFn: (kind: "po" | "invoice") => docUrl({ data: { purchase_id: id, kind } }),
    onSuccess: (r) => window.open(r.url, "_blank", "noopener"),
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (channel: "email" | "download") =>
      sendPo({ data: { purchase_id: id, channel, ...(message ? { message } : {}) } }),
    onSuccess: (_r, channel) => {
      toast.success(channel === "email" ? "Purchase order emailed" : "Marked as sent");
      if (channel === "download") openDoc.mutate("po");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invoiceMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fileToBase64(file);
      return uploadInvoice({
        data: {
          purchase_id: id,
          file_name: file.name,
          mime_type: file.type as "application/pdf" | "image/png" | "image/jpeg" | "image/webp",
          base64,
        },
      });
    },
    onSuccess: (r) => {
      if (r.state === "verified") toast.success("Invoice verified against the agreed price");
      else if (r.state === "discrepancy") toast.warning("The invoice total does not match");
      else toast.warning("We could not read the total — add a note for the admin");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noteMutation = useMutation({
    mutationFn: () => annotate({ data: { purchase_id: id, note } }),
    onSuccess: () => {
      toast.success("Note saved");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isPending || !purchase) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const chip = PURCHASE_CHIPS[purchase.status] ?? {
    label: purchase.status,
    tone: "neutral" as const,
  };
  const invoiceGap =
    purchase.invoice_total != null && purchase.expected_total != null
      ? purchase.invoice_total - purchase.expected_total
      : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={purchase.po_number ?? purchase.ref}
        description={`${purchase.product_name}${purchase.variant_label ? ` — ${purchase.variant_label}` : ""} · ${purchase.quantity} units · ${purchase.client_label}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={chip.tone}>{chip.label}</Chip>
        <span className="text-sm text-muted-foreground">
          Agreed supplier price{" "}
          <strong className="text-foreground">
            {purchase.supplier_unit_price != null ? formatUSD(purchase.supplier_unit_price) : "—"}
          </strong>{" "}
          / unit ·{" "}
          <strong className="text-foreground">
            {purchase.expected_total != null ? formatUSD(purchase.expected_total) : "—"}
          </strong>{" "}
          total
        </span>
        <Button asChild size="sm" variant="ghost">
          <Link to="/desk/purchases">Back to purchases</Link>
        </Button>
      </div>

      <Panel
        step="Step 1"
        title="Supplier details"
        hint="These go on the purchase order. The client is never named on any supplier document."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="sup-name">Supplier name</Label>
            <Input
              id="sup-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="sup-contact">Contact person</Label>
            <Input
              id="sup-contact"
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="sup-email">Email</Label>
            <Input
              id="sup-email"
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="sup-phone">Phone</Label>
            <Input
              id="sup-phone"
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="sup-address">Address</Label>
            <Input
              id="sup-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="sup-country">Country</Label>
            <Input
              id="sup-country"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-4">
          <Button
            onClick={() => supplierMutation.mutate()}
            disabled={supplierMutation.isPending || form.name.trim().length < 2}
          >
            {supplierMutation.isPending ? "Saving…" : "Save supplier details"}
          </Button>
        </div>
      </Panel>

      <Panel
        step="Step 2"
        title="Purchase order"
        hint="Issued at the agreed EXW supplier price. No client price, margin or client name appears on it."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="terms">Payment terms</Label>
            <Textarea
              id="terms"
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lead">Production lead time (days)</Label>
            <Input
              id="lead"
              inputMode="numeric"
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes on the PO (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => poMutation.mutate()} disabled={poMutation.isPending}>
            {poMutation.isPending
              ? "Generating…"
              : purchase.has_po_document
                ? "Regenerate PO"
                : "Generate PO"}
          </Button>
          {purchase.has_po_document ? (
            <Button variant="outline" onClick={() => openDoc.mutate("po")}>
              Download PDF
            </Button>
          ) : null}
        </div>

        {purchase.has_po_document ? (
          <div className="mt-5 border-t border-border pt-4">
            <Label htmlFor="msg">Message to the supplier (optional)</Label>
            <Textarea
              id="msg"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Anything you want to add to the email."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={() => sendMutation.mutate("email")}
                disabled={sendMutation.isPending}
              >
                Email to supplier
              </Button>
              <Button
                variant="outline"
                onClick={() => sendMutation.mutate("download")}
                disabled={sendMutation.isPending}
              >
                Download & mark sent
              </Button>
            </div>
            {purchase.po_sent_at ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Sent {formatDate(purchase.po_sent_at)}
                {purchase.po_sent_channel === "email" ? " by email" : " manually"}.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel
        step="Step 3"
        title="Supplier invoice"
        hint="Upload the invoice the supplier sends. We read it and compare the total with what was agreed."
      >
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="block text-sm"
          disabled={invoiceMutation.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) invoiceMutation.mutate(file);
            e.target.value = "";
          }}
        />
        {invoiceMutation.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">Reading the invoice…</p>
        ) : null}

        {purchase.invoice_state ? (
          <div className="mt-4 space-y-2 rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              {purchase.invoice_state === "verified" ? (
                <Chip tone="success">Invoice verified</Chip>
              ) : purchase.invoice_state === "discrepancy" ? (
                <Chip tone="danger">Discrepancy</Chip>
              ) : (
                <Chip tone="warning">Total not readable</Chip>
              )}
              {purchase.has_invoice_document ? (
                <Button size="sm" variant="ghost" onClick={() => openDoc.mutate("invoice")}>
                  Open the invoice
                </Button>
              ) : null}
            </div>
            <p className="text-sm">
              Expected{" "}
              <strong>
                {purchase.expected_total != null ? formatUSD(purchase.expected_total) : "—"}
              </strong>
              , invoice says{" "}
              <strong>
                {purchase.invoice_total != null ? formatUSD(purchase.invoice_total) : "—"}
              </strong>
              {invoiceGap ? ` (${invoiceGap > 0 ? "+" : ""}${formatUSD(invoiceGap)})` : ""}
              {purchase.invoice_number ? ` · invoice ${purchase.invoice_number}` : ""}
            </p>
            {purchase.invoice_state !== "verified" ? (
              <div>
                <Label htmlFor="note">Explain the difference for the admin</Label>
                <Textarea
                  id="note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  className="mt-2"
                  size="sm"
                  onClick={() => noteMutation.mutate()}
                  disabled={noteMutation.isPending || note.trim().length < 2}
                >
                  Save note
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="mt-4 text-xs text-muted-foreground">
          FlySales pays the supplier outside the platform. Once the payment is recorded by an admin,
          production starts and your commission is confirmed.
        </p>
      </Panel>

      <Panel step="History" title="Timeline">
        {data.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.events.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="w-28 shrink-0 text-xs text-muted-foreground">
                  {formatDate(e.created_at)}
                </span>
                <span>
                  <strong className="font-medium">{e.event.replace(/_/g, " ")}</strong>
                  {e.detail ? <span className="text-muted-foreground"> — {e.detail}</span> : null}
                  <span className="text-xs text-muted-foreground"> ({e.actor_role})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
