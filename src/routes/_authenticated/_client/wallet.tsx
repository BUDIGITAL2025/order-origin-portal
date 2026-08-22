import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { TxnTypeBadge } from "@/components/status-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatUSD } from "@/lib/format";
import { getMyWallet } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/_client/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Relay Sourcing" },
      { name: "description", content: "Your prepaid balance and transaction history." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WalletPage,
});

function WalletPage() {
  const fetchWallet = useServerFn(getMyWallet);
  const { data, isPending } = useQuery({ queryKey: ["my-wallet"], queryFn: fetchWallet });

  const transactions = data?.transactions ?? [];

  return (
    <div>
      <PageHeader title="Wallet" description="Your prepaid balance and full transaction history." />

      <Card className="mb-6 max-w-sm">
        <CardHeader className="pb-1">
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-3xl font-semibold">
            {isPending ? "…" : formatUSD(data?.balance ?? 0)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Balance is derived from the ledger — every entry below is final.
          </p>
        </CardContent>
      </Card>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : transactions.length === 0 ? (
        <EmptyState title="No transactions yet" hint="Credits and debits will appear here." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance after</TableHead>
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
                  <TableCell className="max-w-64 truncate text-sm">{t.description}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {t.reference ?? "—"}
                  </TableCell>
                  <TableCell
                    className={
                      "text-right font-mono text-sm " +
                      (t.type === "debit" ? "text-destructive" : "text-success")
                    }
                  >
                    {t.type === "debit" ? "−" : "+"}
                    {formatUSD(t.amount)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatUSD(t.balance_after)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
