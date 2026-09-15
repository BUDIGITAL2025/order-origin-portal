import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { SectionTabs, DESK_TABS } from "@/components/section-tabs";
import { Chip, SummaryBar } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { deskListClients } from "@/lib/desk-clients.functions";

export const Route = createFileRoute("/_authenticated/desk/clients")({
  head: () => ({
    meta: [
      { title: "My clients — FlySales sourcing desk" },
      {
        name: "description",
        content:
          "The clients you source for: open quotes, purchases in progress, unread messages and your fee tier with each one.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DeskClientsPage,
});

function DeskClientsPage() {
  const fetchClients = useServerFn(deskListClients);
  const { data, isPending } = useQuery({ queryKey: ["desk-clients"], queryFn: fetchClients });

  const clients = data?.clients ?? [];
  const unread = clients.reduce((s, c) => s + c.unread_messages, 0);
  const openQuotes = clients.reduce((s, c) => s + c.open_quotes, 0);
  const purchases = clients.reduce((s, c) => s + c.purchases_in_progress, 0);

  return (
    <div>
      <PageHeader
        title="My clients"
        description="The companies you source for. You see who they are and what they need — never their contact details, prices or billing."
      />
      <SectionTabs tabs={DESK_TABS} />

      <SummaryBar
        items={[
          { key: "clients", label: "Clients", value: String(clients.length) },
          { key: "quotes", label: "Open quotes", value: String(openQuotes), tone: "primary" },
          { key: "purchases", label: "Purchases running", value: String(purchases) },
          {
            key: "unread",
            label: "Unread messages",
            value: String(unread),
            ...(unread > 0 ? { tone: "warning" as const } : {}),
          },
        ]}
      />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          hint="A client appears here as soon as one of their requests is assigned to you."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {clients.map((c) => (
            <article
              key={c.entity_id ?? c.company}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">{c.company}</h2>
                  <p className="text-xs text-muted-foreground">
                    {c.contact_first_name ? `Contact: ${c.contact_first_name}` : "Contact: —"}
                  </p>
                </div>
                {c.unread_messages > 0 ? (
                  <Chip tone="warning">{c.unread_messages} unread</Chip>
                ) : null}
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 p-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Open quotes
                  </dt>
                  <dd className="tnum text-lg font-semibold">{c.open_quotes}</dd>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Purchases
                  </dt>
                  <dd className="tnum text-lg font-semibold">{c.purchases_in_progress}</dd>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Paid units
                  </dt>
                  <dd className="tnum text-lg font-semibold">{c.paid_units}</dd>
                </div>
              </dl>

              <p className="mt-3 text-xs text-muted-foreground">
                {c.fee_rate != null ? `Your rate here: ${(c.fee_rate * 100).toFixed(1)}%` : null}
                {c.fee_rate != null && c.next_at != null
                  ? ` · ${Math.max(0, c.next_at - c.paid_units)} units to ${
                      c.next_rate != null ? `${(c.next_rate * 100).toFixed(1)}%` : "the next rate"
                    }`
                  : c.fee_rate != null
                    ? " · final rate"
                    : "No paid units yet with this client."}
              </p>

              {c.quotes.length ? (
                <ul className="mt-3 space-y-1 border-t border-border pt-3">
                  {c.quotes.map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{q.product_name || "Product request"}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {q.unread > 0 ? <Chip tone="warning">{q.unread}</Chip> : null}
                        <Button asChild size="sm" variant="outline">
                          <Link to="/desk/quote/$id" params={{ id: q.id }}>
                            Open
                          </Link>
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {c.purchases_in_progress > 0 ? (
                <div className="mt-3">
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/desk/purchases">View purchases</Link>
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
