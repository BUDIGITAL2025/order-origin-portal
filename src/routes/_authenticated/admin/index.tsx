/**
 * Admin home — the command centre. Action-first: what needs me now, then the
 * heartbeat feed of everything that happened across the platform.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminActivityFeed, adminCommandCounters } from "@/lib/command-center.functions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Command centre — FlySales Admin" },
      {
        name: "description",
        content: "What needs attention right now and everything that just happened.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminHome,
});

function AdminHome() {
  const fetchCounters = useServerFn(adminCommandCounters);
  const fetchFeed = useServerFn(adminActivityFeed);

  const { data: counters } = useQuery({
    queryKey: ["admin-command-counters"],
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchCounters(),
  });
  const { data: feed, isPending: feedPending } = useQuery({
    queryKey: ["admin-activity-feed"],
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchFeed(),
  });

  const cards = [
    {
      key: "messages",
      label: "Unread client messages",
      value: counters?.unread_messages ?? 0,
      hint:
        counters?.unread_message_quotes
          ? `${counters.unread_message_quotes} conversation${counters.unread_message_quotes === 1 ? "" : "s"}`
          : undefined,
      to: "/admin/quotes",
      search: { unread: true },
    },
    {
      key: "pricing",
      label: "Awaiting my pricing",
      value: counters?.awaiting_pricing ?? 0,
      to: "/admin/quotes",
      search: { status: "sourcing" },
    },
    {
      key: "awaiting-payment",
      label: "Awaiting payment",
      value: counters?.awaiting_payment ?? 0,
      hint:
        counters?.awaiting_payment_days != null
          ? `oldest ${counters.awaiting_payment_days}d waiting`
          : undefined,
      to: "/admin/stock-purchases",
      search: {},
    },
    {
      key: "supplier",
      label: "Supplier payments due",
      value: counters?.supplier_payments_due ?? 0,
      to: "/admin/supplier-payments",
      search: {},
    },
    {
      key: "receive",
      label: "Inbounds to receive",
      value: counters?.to_receive ?? 0,
      to: "/admin/inbound",
      search: { tab: "queue" },
    },
    {
      key: "discrepancies",
      label: "Discrepancies open",
      value: counters?.discrepancies_open ?? 0,
      to: "/admin/inbound",
      search: { tab: "discrepancies" },
    },
    {
      key: "claims",
      label: "Claims open",
      value: counters?.claims_open ?? 0,
      to: "/admin/disputes",
      search: {},
    },
    {
      key: "review",
      label: "Orders needs review",
      value: counters?.needs_review ?? 0,
      to: "/admin/orders",
      search: { stage: "needs_review" },
    },
  ] as const;

  return (
    <>
      <PageHeader
        title="Command centre"
        description="What needs you now, and everything that just happened."
      />

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.key}
            to={c.to}
            search={c.search as never}
            className="bg-card px-3 py-3 transition-colors hover:bg-accent"
          >
            <span className="metric-label block truncate">{c.label}</span>
            <span
              className={cn(
                "tnum mt-1 block text-2xl font-semibold leading-none",
                c.value > 0 && "text-destructive",
              )}
            >
              {c.value}
            </span>
            {"hint" in c && c.hint ? (
              <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                {c.hint}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {feedPending ? (
            <p className="py-4 text-sm text-muted-foreground">Loading…</p>
          ) : (feed?.items.length ?? 0) === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nothing has happened yet today.</p>
          ) : (
            <ol className="divide-y divide-border">
              {feed!.items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    params={item.params as never}
                    className="flex items-baseline justify-between gap-4 py-2 text-sm transition-colors hover:text-primary"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.text}</span>
                    <span className="tnum shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(item.at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
