import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, Check, ClipboardList, CreditCard, Plus, RefreshCcw, Store, Wallet } from "lucide-react";
import { CountUp, MiniSparkline, Reveal, balanceSeries, bucketCounts } from "@/components/dashboard-viz";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { getCurrentStoreId } from "@/components/store-switcher";
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
import { formatDate, formatDateTime, formatUSD } from "@/lib/format";
import { PLANS, planLabel, planQuota, quotaResetDate } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { getMyContext } from "@/lib/profiles.functions";
import { listMyOpenQuotes, listMyQuotes } from "@/lib/quotes.functions";
import { getMyWallet } from "@/lib/wallet.functions";
import { OpenQuotesWidget } from "@/components/open-quotes-widget";

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
  const fetchOpenQuotes = useServerFn(listMyOpenQuotes);
  const fetchWallet = useServerFn(getMyWallet);

  const { data: context } = useQuery({
    queryKey: ["my-context"],
    queryFn: fetchContext,
  });
  const { data: quotesData } = useQuery({
    queryKey: ["my-quotes"],
    queryFn: fetchQuotes,
  });
  const { data: openQuotesData } = useQuery({
    queryKey: ["my-open-quotes"],
    queryFn: fetchOpenQuotes,
  });
  const { data: walletData } = useQuery({
    queryKey: ["my-wallet"],
    queryFn: fetchWallet,
  });

  // Current store selection is persisted in localStorage (client-only), so
  // resolve it after hydration and fall back to the first store.
  const entities = context?.entities ?? [];
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null);
  useEffect(() => {
    setCurrentStoreId(getCurrentStoreId());
  }, []);
  const allStores = entities.flatMap((e) => e.stores);
  const store = allStores.find((s) => s.id === currentStoreId) ?? allStores[0] ?? null;
  const entity = entities.find((e) => e.id === store?.entity_id) ?? null;
  const quotes = quotesData?.quotes ?? [];
  const counts = quotes.reduce<Record<string, number>>((acc, q) => {
    const key = q.status ?? "submitted";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const transactions = walletData?.transactions ?? [];

  // One-time auto top-up prompt: shown after the client's first credit while
  // auto top-up is off. Dismissal is remembered — it never enables itself.
  const AUTOTOPUP_PROMPT_KEY = "flysales_autotopup_prompt_dismissed";
  const [promptDismissed, setPromptDismissed] = useState(true);
  useEffect(() => {
    setPromptDismissed(localStorage.getItem(AUTOTOPUP_PROMPT_KEY) === "1");
  }, []);
  const hasCredit = transactions.some((t) => t.type === "credit");
  const showAutoTopupPrompt =
    !promptDismissed && hasCredit && entity != null && !entity.auto_topup_enabled;

  const plan = store?.subscription_plan ?? "basic";
  const quota = planQuota(plan); // null = unlimited
  const quotesUsed = store?.quotes_used_this_month ?? 0;
  const usagePercent =
    quota == null ? 0 : Math.min(100, Math.round((quotesUsed / quota) * 100));

  // Trend series (presentation only): balance sampled over 90 days, quote
  // counts bucketed per week from the rows we already fetched.
  const walletSeries = balanceSeries(transactions, walletData?.balance ?? 0);
  const quoteSeries: Record<string, number[]> = {
    submitted: bucketCounts(quotes.filter((q) => (q.status ?? "submitted") === "submitted").map((q) => q.created_at)),
    quoted: bucketCounts(quotes.filter((q) => q.status === "quoted").map((q) => q.created_at)),
    closed: bucketCounts(quotes.filter((q) => q.status === "closed").map((q) => q.created_at)),
  };

  // Days until the monthly quota resets (first day of next month).
  const daysToReset = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(store?.quotes_period_start ?? "");
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const next = Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1);
    return Math.max(0, Math.ceil((next - Date.now()) / 86_400_000));
  })();


  const openQuotes = openQuotesData?.quotes ?? [];
  const subscribed = store?.subscription_status === "active";

  // Storeless accounts get the onboarding checklist — unless they already
  // have quote activity, in which case the real widgets take over.
  if (context && quotesData && allStores.length === 0 && quotes.length === 0) {
    return <OnboardingCard entity={entities[0] ?? null} hasQuote={false} hasStore={false} />;
  }

  // No real activity yet — show the checklist instead of a row of zeroed
  // metric cards. Only once both queries have resolved, to avoid a flash.
  if (context && quotesData && walletData && quotes.length === 0 && transactions.length === 0) {
    return <OnboardingCard entity={entity} hasQuote={false} hasStore />;
  }

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

      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-1">
          <Card className="group h-full border-primary/30 bg-primary/[0.04] transition-shadow hover:shadow-md">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Wallet className="h-3.5 w-3.5 text-primary" /> Wallet balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-semibold leading-none">
                <CountUp value={walletData?.balance ?? 0} format={formatUSD} />
              </div>
              <div className="mt-3">
                <MiniSparkline values={walletSeries} height={34} className="h-9" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Funds available for orders</p>
                <Button asChild size="sm" className="gap-1">
                  <Link to="/billing">
                    <Plus className="h-3.5 w-3.5" /> Top up
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          {(["submitted", "quoted", "closed"] as const).map((status, i) => (
            <Reveal key={status} delay={80 * (i + 1)}>
              <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardHeader className="pb-1">
                  <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <ClipboardList className="h-3.5 w-3.5" /> {status} quotes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold leading-none">
                    <CountUp value={counts[status] ?? 0} />
                  </div>
                  <div className="mt-3">
                    <MiniSparkline values={quoteSeries[status] ?? []} />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Last 90 days</p>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>

      {store != null && (
      <Reveal delay={320}>
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" /> Subscription
          </CardTitle>
          <div className="flex items-center gap-2">
            {store?.fee_waived && <Badge variant="secondary">Fee waived</Badge>}
            <Badge variant="outline" className="font-medium">
              {planLabel(plan)} — {formatUSD(PLANS[plan].priceUsd)}/mo
              {store?.fee_waived ? " · not billed" : ""}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr] md:items-center">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="tnum text-3xl font-semibold leading-none">{quotesUsed}</span>
                <span className="text-sm text-muted-foreground">
                  / {quota == null ? "unlimited" : quota} quotes used
                </span>
              </div>
              {quota != null && (
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      "h-full rounded-full transition-all duration-700 " +
                      (usagePercent >= 100
                        ? "bg-destructive"
                        : usagePercent >= 80
                          ? "bg-warning"
                          : "bg-primary")
                    }
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Resets on
              </div>
              <div className="tnum text-sm font-medium">
                {quotaResetDate(store.quotes_period_start)}
              </div>
              {daysToReset != null && (
                <div className="text-xs text-muted-foreground">in {daysToReset} days</div>
              )}
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Remaining
              </div>
              <div className="tnum text-sm font-medium">
                {quota == null ? "Unlimited" : `${Math.max(0, quota - quotesUsed)} quotes`}
              </div>
              <div className="text-xs text-muted-foreground">this billing month</div>
            </div>
          </div>
          {quota != null && quotesUsed >= quota && (
            <p className="mt-3 text-xs font-medium text-warning">
              Monthly allowance reached — upgrade to Unlimited (${PLANS.unlimited.priceUsd}/month)
              for uncapped quote requests from the{" "}
              <Link to="/quotes/new" className="underline">
                quote form
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
      </Reveal>
      )}


      {showAutoTopupPrompt && (
        <Card className="mt-4 border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-2.5">
              <RefreshCcw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">Never run out of funds</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your wallet was credited. Auto top-up charges your saved card once
                  your balance drops below a threshold you choose.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild size="sm">
                <Link to="/billing">Set up auto top-up</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  localStorage.setItem(AUTOTOPUP_PROMPT_KEY, "1");
                  setPromptDismissed(true);
                }}
              >
                Not now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <OpenQuotesWidget quotes={openQuotes} subscribed={subscribed} />
      </div>

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
                    <TableHead className="text-right">Valid until</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.slice(0, 5).map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="max-w-48 truncate text-sm">
                        <Link
                          to="/quotes/$id"
                          params={{ id: q.id }}
                          className="underline-offset-2 hover:underline"
                        >
                          {q.product_name || q.product_url || "—"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <QuoteStatusBadge status={q.status} validUntil={q.quote_valid_until} />
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">
                        {q.quote_valid_until ? formatDate(q.quote_valid_until) : "—"}
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
                          "text-right tnum text-sm " +
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

/**
 * Onboarding checklist for storeless accounts: complete company details,
 * add a first store, then request a quote. Quotes stay gated behind a store.
 */
function OnboardingCard({
  entity,
  hasQuote,
  hasStore,
}: {
  entity: { id: string; legal_name: string; vat_number: string | null } | null;
  hasQuote: boolean;
  hasStore: boolean;
}) {
  const steps = [
    {
      title: "Add company details",
      description: "Legal name, country and VAT — they appear on your payment receipts.",
      done: Boolean(entity?.vat_number),
      to: "/billing",
      cta: "Complete details",
    },
    {
      title: "Add your first workspace",
      description: "Manual mode works from day one — connect your Shopify store later, when you are ready.",
      done: hasStore,
      to: "/workspaces/new",
      cta: "Add workspace",
    },
    {
      title: "Request your first quote",
      description: hasQuote
        ? "Quote requested — our sourcing team is on it."
        : "Paste a product URL and we source it for you.",
      done: hasQuote,
      to: "/quotes/new",
      cta: "Request a quote",
    },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Welcome to FlySales"
        description="Three quick steps to start sourcing."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step, i) => (
          <Card key={step.title} className={step.done ? "opacity-70" : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                {step.done ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
                    <Check className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted tnum text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                )}
                {step.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{step.description}</p>
              {!step.done && (
                <Button asChild size="sm" variant={i === 1 ? "default" : "outline"}>
                  <Link to={step.to}>
                    {i === 1 && <Store className="mr-1.5 h-3.5 w-3.5" />}
                    {step.cta}
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
