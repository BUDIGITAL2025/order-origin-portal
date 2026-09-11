import { useEffect } from "react";
import { toast } from "sonner";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
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
import { WalletPaymentSection } from "@/components/WalletPaymentSection";
import { getCurrentStoreId } from "@/components/store-switcher";
import { useMyContext } from "../../_client";
import { listMyDocuments } from "@/lib/documents.functions";
import { DocumentDownloadButton } from "@/components/documents-ui";

export const Route = createFileRoute("/_authenticated/_client/billing/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — FlySales" },
      { name: "description", content: "Your prepaid balance and transaction history." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { topup?: string } =>
    typeof search["topup"] === "string" ? { topup: search["topup"] } : {},
  component: WalletPage,
});

function WalletPage() {
  const navigate = Route.useNavigate();
  const { topup } = Route.useSearch();
  // Coming back from a Stripe top-up: confirm it, then clean the URL.
  useEffect(() => {
    if (topup !== "done") return;
    toast.success("Top-up received. Your balance updates as soon as the payment confirms.");
    void navigate({ to: "/billing/wallet", replace: true, search: {} });
  }, [topup, navigate]);

  const ctx = useMyContext().data;
  const storeId = getCurrentStoreId() ?? ctx?.entities?.[0]?.stores?.[0]?.id ?? null;
  const entityId = ctx?.entities?.[0]?.id ?? null;

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
      <SectionTabs tabs={BILLING_TABS} />

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
            Your prepaid funds in USD, used to pay for orders. Every entry below is final.
          </p>
        </CardContent>
      </Card>

      <WalletPaymentSection
        {...(storeId ? { storeId } : {})}
        {...(!storeId && entityId ? { entityId } : {})}
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : transactions.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          hint="Your wallet ledger lives here. Every top-up, order payment and credit appears in this list."
          action={{ label: "Top up", to: "/billing/subscription" }}
        />
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
