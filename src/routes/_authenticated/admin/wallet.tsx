import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { TxnTypeBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatUSD } from "@/lib/format";
import { adminListClients } from "@/lib/profiles.functions";
import { walletAdjustmentSchema } from "@/lib/schemas";
import { adminAdjustWallet, adminGetWallet } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/admin/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet adjustments — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminWalletPage,
});

function AdminWalletPage() {
  const queryClient = useQueryClient();
  const fetchClients = useServerFn(adminListClients);
  const fetchWallet = useServerFn(adminGetWallet);
  const callAdjust = useServerFn(adminAdjustWallet);

  const [entityId, setEntityId] = useState<string>("");
  const [type, setType] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");

  const { data: clientsData } = useQuery({ queryKey: ["admin-clients"], queryFn: fetchClients });
  const entities = (clientsData?.clients ?? []).flatMap((c) =>
    c.entities.map((e) => ({ id: e.id, legal_name: e.legal_name, contact_name: c.contact_name })),
  );
  const { data: walletData } = useQuery({
    queryKey: ["admin-wallet", entityId],
    queryFn: () => fetchWallet({ data: { client_id: entityId } }),
    enabled: Boolean(entityId),
  });

  const adjust = useMutation({
    mutationFn: () => {
      const parsed = walletAdjustmentSchema.safeParse({
        client_id: entityId,
        type,
        amount: Number(amount),
        description,
        reference,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your input");
      return callAdjust({ data: parsed.data });
    },
    onSuccess: (r) => {
      toast.success(`Adjustment applied — new balance ${formatUSD(r.entry.balance_after)}`);
      setAmount("");
      setDescription("");
      setReference("");
      void queryClient.invalidateQueries({ queryKey: ["admin-wallet", entityId] });
    },
    onError: (err) => toast.error(err.message),
  });

  const transactions = walletData?.transactions ?? [];

  return (
    <div>
      <PageHeader
        title="Wallet adjustments"
        description="Manual credits and debits. Every entry is written to the append-only ledger."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New adjustment</CardTitle>
            <CardDescription>
              Debits are rejected if they would take the balance below zero. A duplicate
              reference is ignored (idempotent).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                adjust.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label>Entity</Label>
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an entity" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.legal_name} ({e.contact_name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {entityId && walletData && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  Current balance:{" "}
                  <span className="tnum font-medium">{formatUSD(walletData.balance)}</span>
                </div>
              )}
              {entityId && walletData && walletData.balance > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Manual balance refund: prefill a debit for the full
                    // balance with a clear description; the admin confirms
                    // with "Apply adjustment" below. Never automatic.
                    setType("debit");
                    setAmount(String(walletData.balance));
                    setDescription("Wallet balance refund to client");
                    setReference(`refund-${Date.now()}`);
                  }}
                >
                  Refund full balance
                </Button>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as "credit" | "debit")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">Credit (add)</SelectItem>
                      <SelectItem value="debit">Debit (subtract)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aw-amount">Amount (USD)</Label>
                  <Input
                    id="aw-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aw-desc">Description</Label>
                <Input
                  id="aw-desc"
                  required
                  placeholder="e.g. Bank transfer received"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aw-ref">Reference (optional, unique)</Label>
                <Input
                  id="aw-ref"
                  placeholder="e.g. INV-2026-0042"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={adjust.isPending || !entityId}>
                {adjust.isPending ? "Applying…" : "Apply adjustment"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ledger</CardTitle>
            <CardDescription>
              {entityId ? "Recent entries for the selected entity." : "Select an entity to view their ledger."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {entityId && transactions.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No entries yet" />
              </div>
            ) : (
              entityId && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(t.created_at)}
                        </TableCell>
                        <TableCell>
                          <TxnTypeBadge type={t.type} />
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-sm">{t.description}</TableCell>
                        <TableCell
                          className={
                            "text-right tnum text-sm " +
                            (t.type === "debit" ? "text-destructive" : "text-success")
                          }
                        >
                          {t.type === "debit" ? "−" : "+"}
                          {formatUSD(t.amount)}
                        </TableCell>
                        <TableCell className="text-right tnum text-sm">
                          {formatUSD(t.balance_after)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
