import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
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
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  adminIntegrationOverview,
  adminReplayIntegrationEvent,
} from "@/lib/integration.functions";

export const Route = createFileRoute("/_authenticated/admin/integration")({
  head: () => ({
    meta: [
      { title: "Integration — FlySales Admin" },
      { name: "description", content: "Middleware connection status, inbound events and outbound calls." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminIntegrationPage,
});

function AdminIntegrationPage() {
  const fetchOverview = useServerFn(adminIntegrationOverview);
  const replayEvent = useServerFn(adminReplayIntegrationEvent);
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["admin-integration"],
    queryFn: () => fetchOverview({}),
  });

  async function replay(eventId: string) {
    setBusy(eventId);
    try {
      const result = await replayEvent({ data: { event_id: eventId } });
      if (result.ok) toast.success("Event processed");
      else toast.error(result.error ?? "Replay failed");
      await queryClient.invalidateQueries({ queryKey: ["admin-integration"] });
    } catch (err) {
      toast.error(friendlyError(err, "Could not replay event"));
    } finally {
      setBusy(null);
    }
  }

  const status = data?.status;

  return (
    <div>
      <PageHeader
        title="Integration"
        description="Middleware (fulfilment engine) connection. Inbound events create shadow orders; the payment gate and emails are unchanged."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatusCard label="Middleware base URL" ok={status?.base_url_set} />
        <StatusCard label="Service token" ok={status?.service_token_set} />
        <StatusCard label="Webhook secret" ok={status?.webhook_secret_set} />
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Inbound events (last 50)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (data?.events ?? []).length === 0 ? (
            <EmptyState
              title="No events yet"
              hint="Signed middleware events will appear here as soon as they arrive."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.events ?? []).map((event) => {
                  const failed = !!event.error;
                  return (
                    <TableRow key={event.id} className="text-[13px]">
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(event.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {event.event_type}
                        <div className="text-xs text-muted-foreground">{event.event_id}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.tenant_id ?? "—"}
                      </TableCell>
                      <TableCell>
                        {failed ? (
                          <div>
                            <Badge variant="destructive">Failed</Badge>
                            <div className="mt-1 max-w-md text-xs text-muted-foreground">
                              {event.error}
                            </div>
                          </div>
                        ) : event.processed_at ? (
                          <Badge variant="outline">Processed</Badge>
                        ) : (
                          <Badge variant="secondary">Stored</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {failed || !event.processed_at ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === event.event_id}
                            onClick={() => replay(event.event_id)}
                          >
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            {busy === event.event_id ? "Replaying…" : "Replay"}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Integration calls (last 50)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(data?.calls ?? []).length === 0 ? (
            <EmptyState title="No calls yet" hint="Inbound and outbound traffic is audited here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.calls ?? []).map((call) => (
                  <TableRow key={call.id} className="text-[13px]">
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(call.created_at)}
                    </TableCell>
                    <TableCell>{call.direction}</TableCell>
                    <TableCell className="font-mono text-xs">{call.endpoint}</TableCell>
                    <TableCell>
                      {call.ok ? (
                        <Badge variant="outline">OK {call.status_code ?? ""}</Badge>
                      ) : (
                        <div>
                          <Badge variant="destructive">Error {call.status_code ?? ""}</Badge>
                          <div className="mt-1 max-w-md text-xs text-muted-foreground">
                            {call.error}
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({ label, ok }: { label: string; ok?: boolean | undefined }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        {ok ? (
          <CheckCircle2 className="h-5 w-5 text-primary" />
        ) : (
          <XCircle className="h-5 w-5 text-muted-foreground" />
        )}
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{ok ? "Configured" : "Not set"}</div>
        </div>
      </CardContent>
    </Card>
  );
}
