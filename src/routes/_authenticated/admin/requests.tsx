import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { countryName } from "@/lib/countries";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { adminListQuoteIntents, adminResolveQuoteIntent } from "@/lib/quote-intents.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/requests")({
  head: () => ({
    meta: [
      { title: "Client requests — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminRequestsPage,
});

function AdminRequestsPage() {
  const queryClient = useQueryClient();
  const fetchIntents = useServerFn(adminListQuoteIntents);
  const callResolve = useServerFn(adminResolveQuoteIntent);
  const [status, setStatus] = useState<"open" | "handled">("open");

  const { data, isPending } = useQuery({
    queryKey: ["admin-quote-intents", status],
    queryFn: () => fetchIntents({ data: { status } }),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => callResolve({ data: { intent_id: id } }),
    onSuccess: () => {
      toast.success("Request closed");
      void queryClient.invalidateQueries({ queryKey: ["admin-quote-intents"] });
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const intents = data?.intents ?? [];

  return (
    <div>
      <PageHeader
        title="Client requests"
        description="Structured requests raised by clients on their quotes — each one names exactly what they need."
      />

      <div className="mb-4 flex gap-1.5">
        {(["open", "handled"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full border border-border px-3 py-1 text-xs font-medium capitalize",
              status === s ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : intents.length === 0 ? (
        <EmptyState
          title={status === "open" ? "No open requests" : "Nothing handled yet"}
          hint="Requests raised from a published quote land here with their full context."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {intents.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(i.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={i.type === "stop_quoting" ? "destructive" : "secondary"}>
                      {i.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">
                    {i.product_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{i.workspace ?? "—"}</TableCell>
                  <TableCell className="max-w-72 text-xs text-muted-foreground">
                    {(i.payload.countries ?? []).length > 0 && (
                      <div>{(i.payload.countries ?? []).map((c) => countryName(c)).join(", ")}</div>
                    )}
                    {i.payload.note ? <div className="whitespace-pre-wrap">{i.payload.note}</div> : null}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/quotes/$id" params={{ id: i.quote_request_id }}>
                        Open quote
                      </Link>
                    </Button>
                    {i.status === "open" && (
                      <Button
                        size="sm"
                        className="gap-1"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate(i.id)}
                      >
                        <Check className="h-3.5 w-3.5" /> Done
                      </Button>
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
