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
import { listMyDocuments } from "@/lib/documents.functions";
import { DocumentDownloadButton } from "@/components/documents-ui";

export const Route = createFileRoute("/_authenticated/_client/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — FlySales" },
      { name: "description", content: "Your prepaid balance and transaction history." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WalletPage,
});

function WalletPage() {
  const fetchWallet = useServerFn(getMyWallet);
  const fetchDocuments = useServerFn(listMyDocuments);
  const { data, isPending } = useQuery({ queryKey: ["my-wallet"], queryFn: fetchWallet });
  const { data: documents } = useQuery({ queryKey: ["my-documents"], queryFn: fetchDocuments });

  const transactions = data?.transactions ?? [];
  // wallet_transaction_id → receipt document, for the per-row download link.
  const receiptByTxn = new Map(
    (documents ?? [])
      .filter((d) => d.wallet_transaction_id)
      .map((d) => [d.wallet_transaction_id as string, d.id] as const),
  );

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
          <div className="tnum text-3xl font-semibold">
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
                <TableHead className="text-right">Receipt</TableHead>
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
                  <TableCell className="tnum text-xs text-muted-foreground">
                    {t.reference ?? "—"}
                  </TableCell>
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
                  <TableCell className="text-right">
                    {receiptByTxn.get(t.id) ? (
                      <DocumentDownloadButton id={receiptByTxn.get(t.id)!} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
