import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { adminListSpyMarketInterest } from "@/lib/spymarket.functions";

export const Route = createFileRoute("/_authenticated/admin/spymarket")({
  head: () => ({
    meta: [
      { title: "SpyMarket waitlist — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSpyMarketPage,
});

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  plus: "Plus",
  max: "Max",
};

function AdminSpyMarketPage() {
  const fetchWaitlist = useServerFn(adminListSpyMarketInterest);
  const { data, isPending } = useQuery({
    queryKey: ["admin-spymarket-interest"],
    queryFn: fetchWaitlist,
  });

  return (
    <div>
      <PageHeader
        title="SpyMarket waitlist"
        description="Interest registrations for the upcoming SpyMarket product. Counts per plan are negotiation material."
      />

      {/* Count per plan */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {isPending || !data ? (
          <>
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="mt-1 text-2xl font-semibold tnum">{data.total}</p>
            </div>
            {(["starter", "plus", "max"] as const).map((plan) => (
              <div key={plan} className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">{PLAN_LABEL[plan]}</p>
                <p className="mt-1 text-2xl font-semibold tnum">{data.counts[plan]}</p>
              </div>
            ))}
          </>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !data || data.entries.length === 0 ? (
        <EmptyState
          title="No waitlist registrations yet"
          hint="Entries appear here when clients join the SpyMarket waitlist from the portal."
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.contact_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.entity_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{PLAN_LABEL[entry.plan_interest] ?? entry.plan_interest}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(entry.created_at)}
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
