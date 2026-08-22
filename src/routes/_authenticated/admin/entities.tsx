import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@/components/app-shell";
import {
  IntegrationModeBadge,
  ProvisioningBadge,
  ProfileStatusBadge,
} from "@/components/status-badges";
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
      { title: "Entities & Stores — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminEntitiesPage,
});

/**
 * Read-only overview of the Account → Entity → Store hierarchy introduced in
 * step 1 of the refactor. Editing stays on the Clients page until step 2.
 */
function AdminEntitiesPage() {
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
        .select("id, company_name")
        .in("id", accountIds);
      const companyById = new Map((profiles ?? []).map((p) => [p.id, p.company_name]));
      return data.map((e) => ({
        ...e,
        account_company: companyById.get(e.account_id) ?? null,
      }));
    },
  });

  return (
    <div>
      <PageHeader
        title="Entities & stores"
        description="Legal entities and the shops attached to them. Wallet lives on the entity; subscriptions, quotas and catalogues live on each store."
      />
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !entities || entities.length === 0 ? (
        <EmptyState
          title="No entities yet"
          hint="Entities are created automatically for each client account."
        />
      ) : (
        <div className="space-y-4">
          {entities.map((entity) => (
            <Card key={entity.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{entity.legal_name}</CardTitle>
                  <ProfileStatusBadge status={entity.status} />
                  {entity.account_company && entity.account_company !== entity.legal_name && (
                    <span className="text-xs text-muted-foreground">
                      account: {entity.account_company}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {entity.stores.length}/{entity.max_stores} stores · since{" "}
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
                  <p className="text-xs text-muted-foreground">No stores under this entity.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Store</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Subscription</TableHead>
                        <TableHead>Integration</TableHead>
                        <TableHead>Middleware tenant</TableHead>
                        <TableHead>Provisioning</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entity.stores.map((store) => (
                        <TableRow key={store.id}>
                          <TableCell>
                            <div className="text-sm font-medium">
                              {store.store_name ?? store.store_url}
                            </div>
                            <div className="text-xs text-muted-foreground">{store.store_url}</div>
                          </TableCell>
                          <TableCell className="capitalize">{store.platform}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-normal capitalize">
                              {store.subscription_plan}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs capitalize">
                            {store.subscription_status.replace("_", " ")}
                          </TableCell>
                          <TableCell>
                            <IntegrationModeBadge mode={store.integration_mode} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {store.middleware_tenant_id ?? "—"}
                          </TableCell>
                          <TableCell>
                            <ProvisioningBadge status={store.provisioning_status} />
                          </TableCell>
                          <TableCell>
                            <ProfileStatusBadge status={store.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
