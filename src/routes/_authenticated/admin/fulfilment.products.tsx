import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, ADMIN_FULFILMENT_TABS } from "@/components/section-tabs";
import { AdminSearch, ToolBar } from "@/components/admin-ui";
import { FulfilmentCatalog, type CatalogRow } from "@/components/fulfilment-catalog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [workspace, setWorkspace] = useState("all");

  const { data, isPending } = useQuery({
    queryKey: ["admin-fulfilment-catalog"],
    staleTime: 60_000,
    queryFn: () => fetchCatalog(),
  });

  const all = (data?.rows ?? []) as CatalogRow[];
  const workspaces = Array.from(
    new Map(all.map((r) => [r.store_id, r.store_name ?? r.store_id])).entries(),
  );
  const term = search.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (workspace !== "all" && r.store_id !== workspace) return false;
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
      <SectionTabs tabs={ADMIN_FULFILMENT_TABS} />
      <ToolBar>
        <Select value={workspace} onValueChange={setWorkspace}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue placeholder="All workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workspaces</SelectItem>
            {workspaces.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AdminSearch
          value={search}
          onChange={setSearch}
          placeholder="Search by SKU, product or workspace"
        />
      </ToolBar>
      <FulfilmentCatalog
        rows={rows}
        isPending={isPending}
        isAdmin
        showWorkspace
        invalidateKeys={[["admin-fulfilment-catalog"]]}
      />
    </div>
  );
}
