import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import {
  IntegrationModeBadge,
  ProvisioningBadge,
  ProfileStatusBadge,
} from "@/components/status-badges";
import {
  AdminSearch,
  SummaryBar,
  TableShell,
  ToolBar,
  Value,
} from "@/components/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/entities")({
  head: () => ({
    meta: [
      { title: "Entities & Workspaces — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminEntitiesPage,
});

/**
 * Read-only overview of the Account → Entity → Workspace hierarchy.
 * Editing stays on the Clients page.
 */
function AdminEntitiesPage() {
  const [search, setSearch] = useState("");
  const { data: entities, isPending } = useQuery({
    queryKey: ["admin-entities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entities")
        .select("*, stores(*)")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const accountIds = [...new Set(data.map((e) => e.account_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, contact_name")
        .in("id", accountIds);
      const contactById = new Map((profiles ?? []).map((p) => [p.id, p.contact_name]));
      return data.map((e) => ({
        ...e,
        account_contact: contactById.get(e.account_id) ?? null,
      }));
    },
  });

  const all = entities ?? [];
  const workspaceCount = all.reduce((acc, e) => acc + e.stores.length, 0);
  const connectedCount = all.reduce(
    (acc, e) => acc + e.stores.filter((s) => s.integration_mode === "connected").length,
    0,
  );
  const suspendedCount = all.filter((e) => e.status === "suspended").length;

  const term = search.trim().toLowerCase();
  const rows = all.filter((e) => {
    if (!term) return true;
    return [
      e.legal_name,
      e.account_contact ?? "",
      e.country ?? "",
      ...e.stores.map((s) => `${s.store_name ?? ""} ${s.store_url ?? ""}`),
    ]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  return (
    <div>
      <PageHeader
        title="Entities & workspaces"
        description="Legal entities and the shops attached to them. Wallet lives on the entity; subscriptions, quotas and catalogues live on each workspace."
      />

      <SummaryBar
        className="lg:grid-cols-4"
        items={[
          { key: "entities", label: "Entities", value: all.length, tone: "primary" },
          { key: "workspaces", label: "Workspaces", value: workspaceCount },
          { key: "connected", label: "Connected", value: connectedCount, tone: "success" },
          { key: "suspended", label: "Suspended", value: suspendedCount, tone: "danger" },
        ]}
      />

      <ToolBar>
        <div />
        <AdminSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by entity, contact or workspace"
        />
      </ToolBar>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No entities yet"
          hint="Entities are created automatically for each client account."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((entity) => (
            <Card key={entity.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{entity.legal_name}</CardTitle>
                  <ProfileStatusBadge status={entity.status} />
                  {entity.account_contact && (
                    <span className="text-xs text-muted-foreground">
                      account: {entity.account_contact}
                    </span>
                  )}
                  <span className="tnum ml-auto text-xs text-muted-foreground">
                    {entity.stores.length}/{entity.max_stores} workspaces · since{" "}
                    {formatDate(entity.created_at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {[entity.country, entity.vat_number ? `VAT ${entity.vat_number}` : null]
                    .filter(Boolean)
                    .join(" · ") || "No fiscal details"}
                </p>
              </CardHeader>
              <CardContent>
                {entity.stores.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No workspaces under this entity.</p>
                ) : (
                  <TableShell>
                    <Table className="text-[13px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-9">Workspace</TableHead>
                          <TableHead className="h-9">Platform</TableHead>
                          <TableHead className="h-9">Plan</TableHead>
                          <TableHead className="h-9">Subscription</TableHead>
                          <TableHead className="h-9">Integration</TableHead>
                          <TableHead className="h-9">Tenant</TableHead>
                          <TableHead className="h-9">Provisioning</TableHead>
                          <TableHead className="h-9">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entity.stores.map((store) => (
                          <TableRow key={store.id} className="hover:bg-accent/60">
                            <TableCell className="max-w-56 py-2.5">
                              <div className="truncate font-medium">
                                {store.store_name ?? store.store_url}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {store.store_url}
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5 capitalize">{store.platform}</TableCell>
                            <TableCell className="py-2.5">
                              <Badge variant="outline" className="font-normal capitalize">
                                {store.subscription_plan}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2.5 text-xs capitalize">
                              {store.subscription_status.replace("_", " ")}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <IntegrationModeBadge mode={store.integration_mode} />
                            </TableCell>
                            <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">
                              <Value>{store.middleware_tenant_id}</Value>
                            </TableCell>
                            <TableCell className="py-2.5">
                              <ProvisioningBadge status={store.provisioning_status} />
                            </TableCell>
                            <TableCell className="py-2.5">
                              <ProfileStatusBadge status={store.status} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableShell>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
