import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import {
  DisputeReasonLabel,
  DisputeResolutionNote,
  DisputeStatusBadge,
  DisputeThread,
} from "@/components/DisputeThread";
import { formatDateTime, formatUSD } from "@/lib/format";
import { getMyDispute } from "@/lib/disputes.functions";

export const Route = createFileRoute("/_authenticated/_client/disputes/$id")({
  head: () => ({
    meta: [
      { title: "Dispute — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DisputeDetailPage,
});

function DisputeDetailPage() {
  const { id } = Route.useParams();
  const fetchDispute = useServerFn(getMyDispute);
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["my-dispute", id],
    queryFn: () => fetchDispute({ data: { dispute_id: id } }),
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Dispute not found."}
      </p>
    );
  }

  const { dispute, messages, evidence } = data;
  const order = dispute.orders as {
    external_order_number: string | null;
    status: string;
    total_amount: number | null;
    destination_country: string | null;
  } | null;

  return (
    <div>
      <Link
        to="/disputes"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All disputes
      </Link>
      <PageHeader
        title={`Dispute — order ${order?.external_order_number ?? dispute.order_id.slice(0, 8)}`}
        description={`Opened ${formatDateTime(dispute.created_at)}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <DisputeStatusBadge status={dispute.status} />
              <span className="text-sm font-medium">
                <DisputeReasonLabel reason={dispute.reason} />
              </span>
              {order?.total_amount != null && (
                <span className="tnum text-sm text-muted-foreground">
                  order total {formatUSD(order.total_amount)}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm">{dispute.description}</p>
            {dispute.resolution && (
              <div className="mt-4 border-t border-border pt-3">
                <DisputeResolutionNote
                  resolution={dispute.resolution}
                  creditAmount={dispute.credit_amount}
                />
                {dispute.resolved_at && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Resolved {formatDateTime(dispute.resolved_at)}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-3 text-base font-semibold">Messages</h2>
            <DisputeThread
              disputeId={dispute.id}
              messages={messages}
              onPosted={() => queryClient.invalidateQueries({ queryKey: ["my-dispute", id] })}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="mb-3 text-base font-semibold">Evidence</h2>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No photos attached. Tracking is used as evidence for undelivered orders.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {evidence.map((e) => (
                <a key={e.path} href={e.url} target="_blank" rel="noreferrer">
                  <img
                    src={e.url}
                    alt="Dispute evidence"
                    className="aspect-square w-full rounded-lg border border-border object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
