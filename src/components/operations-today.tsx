/**
 * One row of clickable stat cards at the top of the admin fulfilment area.
 * Each card opens the matching admin list, already filtered.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminOperationsToday } from "@/lib/operations.functions";
import { cn } from "@/lib/utils";

export function OperationsToday() {
  const fetchOps = useServerFn(adminOperationsToday);
  const { data } = useQuery({
    queryKey: ["admin-operations-today"],
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchOps(),
  });

  const cards = [
    {
      key: "release",
      label: "Orders to release",
      value: data?.orders_to_release ?? 0,
      to: "/admin/orders",
      search: { stage: "processing" },
      critical: false,
    },
    {
      key: "review",
      label: "Needs review",
      value: data?.needs_review ?? 0,
      to: "/admin/orders",
      search: { stage: "needs_review" },
      critical: true,
    },
    {
      key: "arriving",
      label: "Inbounds arriving",
      value: data?.inbounds_arriving ?? 0,
      hint: data?.next_arrival ? `next ${data.next_arrival}` : undefined,
      to: "/admin/inbound",
      search: { tab: "in_transit" },
      critical: false,
    },
    {
      key: "receive",
      label: "To receive",
      value: data?.to_receive ?? 0,
      to: "/admin/inbound",
      search: { tab: "queue" },
      critical: false,
    },
    {
      key: "discrepancies",
      label: "Discrepancies open",
      value: data?.discrepancies_open ?? 0,
      to: "/admin/inbound",
      search: { tab: "discrepancies" },
      critical: true,
    },
    {
      key: "low",
      label: "Low stock",
      value: data?.low_stock ?? 0,
      to: "/admin/inventory",
      search: { state: "red" },
      critical: false,
    },
    {
      key: "claims",
      label: "Claims open",
      value: data?.claims_open ?? 0,
      to: "/admin/disputes",
      search: {},
      critical: true,
    },
  ] as const;

  return (
    <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4 xl:grid-cols-7">
      {cards.map((c) => {
        const alert = c.critical && c.value > 0;
        const warn = !c.critical && c.value > 0 && c.key === "low";
        return (
          <Link
            key={c.key}
            to={c.to}
            search={c.search as never}
            className="bg-card px-3 py-2.5 transition-colors hover:bg-accent"
          >
            <span className="metric-label block truncate">{c.label}</span>
            <span
              className={cn(
                "tnum mt-0.5 block text-lg font-semibold leading-none",
                alert && "text-destructive",
                warn && "text-warning",
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
        );
      })}
    </div>
  );
}
