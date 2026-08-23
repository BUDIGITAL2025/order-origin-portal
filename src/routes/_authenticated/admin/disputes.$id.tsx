import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import {
  DisputeReasonLabel,
  DisputeResolutionNote,
  DisputeStatusBadge,
  DisputeThread,
} from "@/components/DisputeThread";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatUSD } from "@/lib/format";
import {
  adminGetDispute,
  adminMarkInvestigating,
  adminResolveDispute,
} from "@/lib/disputes.functions";

export const Route = createFileRoute("/_authenticated/admin/disputes/$id")({
  head: () => ({
    meta: [
      { title: "Dispute — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminDisputeDetailPage,
});

type Resolution = "wallet_credit" | "reshipped" | "rejected";

function AdminDisputeDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchDispute = useServerFn(adminGetDispute);
  const markInvestigating = useServerFn(adminMarkInvestigating);
  const resolveDispute = useServerFn(adminResolveDispute);

  const { data, isPending, error } = useQuery({
    queryKey: ["admin-dispute", id],
    queryFn: () => fetchDispute({ data: { dispute_id: id } }),
  });

  const [resolution, setResolution] = useState<Resolution>("wallet_credit");
  const [creditAmount, setCreditAmount] = useState("");
  const [clientMessage, setClientMessage] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Dispute not found."}
      </p>
    );
  }

  const { dispute, messages, evidence } = data;
  const order = dispute.orders as {
    external_order_number: string | null;
    status: string;
    total_amount: number | null;
    destination_country: string | null;
    paid_at: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    order_items: Array<{
      sku: string | null;
      quantity: number | null;
      unit_price: number | null;
      line_total: number | null;
    }>;
  } | null;
  const isOpen = dispute.status === "open" || dispute.status === "investigating";

  async function mark() {
    setBusy(true);
    try {
      await markInvestigating({ data: { dispute_id: id } });
      await queryClient.invalidateQueries({ queryKey: ["admin-dispute", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    if (resolution === "wallet_credit" && !(Number(creditAmount) > 0)) {
      toast.error("Enter the credit amount for a wallet credit resolution");
      return;
    }
    if (resolution === "rejected" && clientMessage.trim().length === 0) {
      toast.error("A rejection needs a reason the client can see");
      return;
    }
    setBusy(true);
    try {
      await resolveDispute({
        data: {
          dispute_id: id,
          resolution,
          credit_amount: resolution === "wallet_credit" ? Number(creditAmount) : null,
          client_message: clientMessage.trim() || undefined,
          admin_notes: adminNotes.trim() || undefined,
        },
      });
      toast.success("Dispute resolved");
      await queryClient.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resolution failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link
        to="/admin/disputes"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Dispute queue
      </Link>
      <PageHeader
        title={
          <>
            Dispute — order {order?.external_order_number ?? dispute.order_id.slice(0, 8)}
          </>
        }
        description={`Opened ${formatDateTime(dispute.created_at)} · <DisputeReasonLabel reason={dispute.reason} />`}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <DisputeStatusBadge status={dispute.status} />
        <span className="text-sm font-medium">
          <DisputeReasonLabel reason={dispute.reason} />
        </span>
        {dispute.status === "open" && (
          <Button size="sm" variant="outline" onClick={mark} disabled={busy}>
            Mark investigating
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-2 text-base font-semibold">Claim</h2>
            <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>
            {dispute.resolution && (
              <div className="mt-4 border-t border-border pt-3">
                <DisputeResolutionNote
                  resolution={dispute.resolution}
                  creditAmount={dispute.credit_amount}
                />
                {dispute.resolved_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Resolved {formatDateTime(dispute.resolved_at)}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(order?.order_items ?? []).map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="tnum text-xs font-medium">{item.sku ?? "—"}</TableCell>
                    <TableCell className="tnum text-right text-sm">
                      {Math.max(1, item.quantity ?? 1)}
                    </TableCell>
                    <TableCell className="tnum text-right text-sm">
                      {item.unit_price != null ? formatUSD(item.unit_price) : "—"}
                    </TableCell>
                    <TableCell className="tnum text-right text-sm">
                      {item.line_total != null ? formatUSD(item.line_total) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-3 text-base font-semibold">Messages</h2>
            <DisputeThread
              disputeId={dispute.id}
              messages={messages}
              onPosted={() => queryClient.invalidateQueries({ queryKey: ["admin-dispute", id] })}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-2 text-base font-semibold">Timeline</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Paid</dt>
                <dd>{order?.paid_at ? formatDateTime(order.paid_at) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Shipped</dt>
                <dd>{order?.shipped_at ? formatDateTime(order.shipped_at) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Delivered</dt>
                <dd>{order?.delivered_at ? formatDateTime(order.delivered_at) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Destination</dt>
                <dd>{order?.destination_country ?? "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-3 text-base font-semibold">Evidence</h2>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No photos attached.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {evidence.map((e) => (
                  <a key={e.path} href={e.url} target="_blank" rel="noreferrer">
                    <img
                      src={e.url}
                      alt="Dispute evidence"
                      className="aspect-square w-full rounded-lg border border-border object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>

          {isOpen && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="mb-3 text-base font-semibold">Resolve</h2>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="resolution">Resolution</Label>
                  <Select
                    value={resolution}
                    onValueChange={(v) => setResolution(v as Resolution)}
                  >
                    <SelectTrigger id="resolution">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wallet_credit">Approve — wallet credit</SelectItem>
                      <SelectItem value="reshipped">Approve — reshipped</SelectItem>
                      <SelectItem value="rejected">Reject</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {resolution === "wallet_credit" && (
                  <div>
                    <Label htmlFor="credit">Credit amount (USD)</Label>
                    <Input
                      id="credit"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={creditAmount}
                      onChange={(e) => setCreditAmount(e.target.value)}
                      placeholder="0.00"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Credited to the client's entity wallet. The dispute id is the
                      idempotency reference — it can never be credited twice.
                    </p>
                  </div>
                )}
                <div>
                  <Label htmlFor="clientMessage">
                    Message to client{resolution === "rejected" ? " (required for rejection)" : ""}
                  </Label>
                  <Textarea
                    id="clientMessage"
                    rows={3}
                    value={clientMessage}
                    onChange={(e) => setClientMessage(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="adminNotes">Internal notes (never shown to the client)</Label>
                  <Textarea
                    id="adminNotes"
                    rows={2}
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                  />
                </div>
                <Button onClick={resolve} disabled={busy} className="w-full">
                  {busy ? "Resolving…" : "Resolve dispute"}
                </Button>
              </div>
            </div>
          )}

          {dispute.admin_notes && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="mb-2 text-base font-semibold">Internal notes</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {dispute.admin_notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
