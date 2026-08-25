import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { SUPPORT_EMAIL } from "@/lib/support";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { OrderStatusBadge, type OrderStatus } from "@/components/documents-ui";
import {
  DisputeReasonLabel,
  DisputeResolutionNote,
  DisputeStatusBadge,
} from "@/components/DisputeThread";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatUSD } from "@/lib/format";
import { listMyDisputes } from "@/lib/disputes.functions";

export const Route = createFileRoute("/_authenticated/_client/disputes")({
  head: () => ({
    meta: [
      { title: "Claims — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DisputesPage,
});

function DisputesPage() {
  const fetchDisputes = useServerFn(listMyDisputes);
  const { data: disputes, isPending } = useQuery({
    queryKey: ["my-disputes"],
    queryFn: fetchDisputes,
  });

  return (
    <div>
      <PageHeader
        title="Claims"
        description="Claims for orders that never arrived, arrived damaged, or shipped with the wrong product."
      />
      <p className="mb-4 text-xs text-muted-foreground">
        Claims are handled here in the portal, so evidence, decisions and credits stay on one
        thread. For anything else, write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !disputes || disputes.length === 0 ? (
        <EmptyState
          title="No claims"
          hint="If an order arrives damaged, wrong, or never arrives, open a claim here and we resolve it with a wallet credit or reshipment."
          action={{ label: "View orders", to: "/orders" }}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resolution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {disputes.map((d) => {
                const order = d.orders as {
                  external_order_number: string | null;
                  status: string;
                  total_amount: number | null;
                } | null;
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link
                        to="/disputes/$id"
                        params={{ id: d.id }}
                        className="tnum text-xs font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {order?.external_order_number ?? d.order_id.slice(0, 8)}
                      </Link>
                      <div className="mt-0.5">
                        <OrderStatusBadge status={(order?.status ?? "awaiting_payment") as OrderStatus} />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <DisputeReasonLabel reason={d.reason} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(d.created_at)}
                    </TableCell>
                    <TableCell>
                      <DisputeStatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {d.resolution ? (
                        <DisputeResolutionNote
                          resolution={d.resolution}
                          creditAmount={d.credit_amount}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {d.resolution === "wallet_credit" && d.credit_amount != null && (
                        <span className="tnum ml-1 text-xs text-muted-foreground">
                          {formatUSD(Number(d.credit_amount))}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
