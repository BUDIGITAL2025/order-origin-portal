import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, ADMIN_FULFILMENT_TABS } from "@/components/section-tabs";
import { OperationsToday } from "@/components/operations-today";
import { AdminSearch, ToolBar } from "@/components/admin-ui";
import { FulfilmentCatalog, type CatalogRow } from "@/components/fulfilment-catalog";
import {
  ALL_WORKSPACES,
  WorkspacePicker,
  useFulfilmentIsAdmin,
  useWorkspaceScope,
} from "@/components/workspace-scope";
import { adminListFulfilmentCatalog } from "@/lib/fulfilment.functions";

export const Route = createFileRoute("/_authenticated/admin/fulfilment/products")({
  head: () => ({
    meta: [
      { title: "Fulfilment products — FlySales Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminFulfilmentProductsPage,
});

function AdminFulfilmentProductsPage() {
  const fetchCatalog = useServerFn(adminListFulfilmentCatalog);
  const [search, setSearch] = useState("");
  const [workspace] = useWorkspaceScope();
  const isAdmin = useFulfilmentIsAdmin();

  const { data, isPending } = useQuery({
    queryKey: ["admin-fulfilment-catalog"],
    staleTime: 60_000,
    queryFn: () => fetchCatalog(),
  });

  const all = (data?.rows ?? []) as CatalogRow[];
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (workspace !== ALL_WORKSPACES && r.store_id !== workspace) return false;
    if (!term) return true;
    return [r.sku, r.product_name, r.variant_label ?? "", r.store_name ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  return (
    <div>
      <PageHeader
        title="Fulfilment products"
        description="Every fulfilment-managed SKU across all workspaces. Direct-to-client purchases never appear here."
      />
      <WorkspacePicker />
      <SectionTabs tabs={ADMIN_FULFILMENT_TABS} />
      {isAdmin ? <OperationsToday /> : null}
      <ToolBar>
        <AdminSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by SKU, product or workspace"
        />
      </ToolBar>
      <FulfilmentCatalog
        rows={rows}
        isPending={isPending}
        isAdmin={isAdmin}
        showWorkspace
        invalidateKeys={[["admin-fulfilment-catalog"]]}
      />
    </div>
  );
}
