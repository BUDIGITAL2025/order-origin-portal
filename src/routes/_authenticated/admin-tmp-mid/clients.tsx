import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { ProfileStatusBadge, ProvisioningBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import {
  adminListClients,
  adminSetClientStatus,
  adminSetMarkupTier,
  provisionClient,
} from "@/lib/profiles.functions";

export const Route = createFileRoute("/_authenticated/_admin/clients")({
  head: () => ({
    meta: [
      { title: "Clients — Relay Sourcing Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminClientsPage,
});

function AdminClientsPage() {
  const queryClient = useQueryClient();
  const fetchClients = useServerFn(adminListClients);
  const callSetStatus = useServerFn(adminSetClientStatus);
  const callSetTier = useServerFn(adminSetMarkupTier);
  const callProvision = useServerFn(provisionClient);

  const { data, isPending } = useQuery({ queryKey: ["admin-clients"], queryFn: fetchClients });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-clients"] });

  const provision = useMutation({
    mutationFn: (client_id: string) => callProvision({ data: { client_id } }),
    onSuccess: () => {
      toast.success("Client approved and provisioned");
      void invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
      void invalidate();
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: { client_id: string; status: "active" | "suspended" }) =>
      callSetStatus({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(vars.status === "suspended" ? "Client suspended" : "Client reactivated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const setTier = useMutation({
    mutationFn: (input: { client_id: string; markup_tier: "standard" | "volume" | "partner" }) =>
      callSetTier({ data: input }),
    onSuccess: () => {
      toast.success("Markup tier updated");
      void invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const clients = data?.clients ?? [];

  return (
    <div>
      <PageHeader title="Clients" description="Approve, suspend and manage pricing tiers." />

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clients.length === 0 ? (
        <EmptyState title="No clients yet" hint="New signups appear here for approval." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Shopify</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provisioning</TableHead>
                <TableHead>Tenant ID</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{c.company_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.contact_name} · {c.country} · VAT {c.vat_number}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{c.shopify_domain}</TableCell>
                  <TableCell>
                    <Select
                      value={c.markup_tier}
                      onValueChange={(v) =>
                        setTier.mutate({
                          client_id: c.id,
                          markup_tier: v as "standard" | "volume" | "partner",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard 35%</SelectItem>
                        <SelectItem value="volume">Volume 25%</SelectItem>
                        <SelectItem value="partner">Partner 18%</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <ProfileStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell>
                    <ProvisioningBadge status={c.provisioning_status} />
                    {c.provisioning_status === "failed" && (
                      <div className="mt-1 max-w-48 text-xs text-destructive">
                        {c.provisioning_step}: {c.provisioning_error}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.middleware_tenant_id ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {c.status === "pending" && (
                        <Button
                          size="sm"
                          disabled={provision.isPending}
                          onClick={() => provision.mutate(c.id)}
                        >
                          {provision.isPending ? "Approving…" : "Approve"}
                        </Button>
                      )}
                      {c.provisioning_status === "failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={provision.isPending}
                          onClick={() => provision.mutate(c.id)}
                        >
                          Retry
                        </Button>
                      )}
                      {c.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ client_id: c.id, status: "suspended" })}
                        >
                          Suspend
                        </Button>
                      )}
                      {c.status === "suspended" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ client_id: c.id, status: "active" })}
                        >
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Tenant IDs are assigned once at approval and are immutable. Last signup:{" "}
        {clients[0] ? formatDateTime(clients[0].created_at) : "—"}.
      </p>
    </div>
  );
}
