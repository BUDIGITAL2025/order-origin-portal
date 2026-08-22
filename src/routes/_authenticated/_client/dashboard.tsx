import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, CreditCard, Wallet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { QuoteStatusBadge, TxnTypeBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
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
import { PLANS, planLabel, planQuota, quotaResetDate } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { getMyContext } from "@/lib/profiles.functions";
import { listMyQuotes } from "@/lib/quotes.functions";
import { getMyWallet } from "@/lib/wallet.functions";

export const Route = createFileRoute("/_authenticated/_client/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — FlySales" },
      { name: "description", content: "Your FlySales client dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const fetchContext = useServerFn(getMyContext);
  const fetchQuotes = useServerFn(listMyQuotes);
  const fetchWallet = useServerFn(getMyWallet);

  const { data: context } = useQuery({
    queryKey: ["my-context"],
    queryFn: fetchContext,
  });
  const { data: quotesData } = useQuery({
    queryKey: ["my-quotes"],
    queryFn: fetchQuotes,
  });
  const { data: walletData } = useQuery({
    queryKey: ["my-wallet"],
    queryFn: fetchWallet,
  });

  const profile = context?.profile ?? null;
  const quotes = quotesData?.quotes ?? [];
  const counts = quotes.reduce<Record<string, number>>((acc, q) => {
    const key = q.status ?? "submitted";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const transactions = walletData?.transactions ?? [];

  const plan = profile?.subscription_plan ?? "basic";
  const quota = planQuota(plan); // null = unlimited
  const quotesUsed = profile?.quotes_used_this_month ?? 0;
  const usagePercent =
    quota == null ? 0 : Math.min(100, Math.round((quotesUsed / quota) * 100));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Your sourcing activity at a glance."
        actions={
          <Button asChild size="sm">
            <Link to="/quotes/new">Request a quote</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" /> Wallet balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-semibold">
              {formatUSD(walletData?.balance ?? 0)}
            </div>
          </CardContent>
        </Card>
        {(["submitted", "quoted", "accepted"] as const).map((status) => (
          <Card key={status}>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <ClipboardList className="h-3.5 w-3.5" /> {status} quotes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold">{counts[status] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" /> Subscription
          </CardTitle>
          <div className="flex items-center gap-2">
            {profile?.fee_waived && <Badge variant="secondary">Fee waived</Badge>}
            <span className="text-xs font-medium text-muted-foreground">
              {planLabel(plan)} plan — {formatUSD(PLANS[plan].priceUsd)}/month
              {profile?.fee_waived ? " · not billed" : ""}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <div className="font-mono text-xl font-semibold">
                {quotesUsed}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {quota == null ? "unlimited" : `${quota} quotes`}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                used this month
                {profile?.quotes_period_start
                  ? ` · resets ${quotaResetDate(profile.quotes_period_start)}`
                  : ""}
              </div>
            </div>
            {quota != null && (
              <div className="min-w-40 flex-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      "h-full rounded-full transition-all " +
                      (usagePercent >= 100
                        ? "bg-destructive"
                        : usagePercent >= 80
                          ? "bg-warning"
                          : "bg-success")
                    }
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>
            )}
            {quota != null && quotesUsed >= quota && (
              <p className="text-xs font-medium text-warning-foreground">
                Monthly allowance reached — upgrade to Unlimited ($
                {PLANS.unlimited.priceUsd}/month) for uncapped quote requests from the{" "}
                <Link to="/quotes/new" className="underline">
                  quote form
                </Link>
                .
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold">Recent quote requests</CardTitle>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link to="/quotes">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {quotes.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No quote requests yet" hint="Submit your first product link to get a price." />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.slice(0, 5).map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="max-w-48 truncate text-sm">
                        {q.product_name || q.product_url || "—"}
                      </TableCell>
                      <TableCell>
                        <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {q.quoted_price_total != null ? formatUSD(q.quoted_price_total) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold">Recent wallet activity</CardTitle>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link to="/wallet">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {transactions.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No transactions yet" hint="Credits and debits will appear here." />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.slice(0, 5).map((t) => (
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
                          "text-right font-mono text-sm " +
                          (t.type === "debit" ? "text-destructive" : "text-success")
                        }
                      >
                        {t.type === "debit" ? "−" : "+"}
                        {formatUSD(t.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
