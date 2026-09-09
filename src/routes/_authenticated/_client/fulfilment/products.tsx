import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, FULFILMENT_TABS } from "@/components/section-tabs";
import { AdminSearch, ToolBar } from "@/components/admin-ui";
import { getCurrentStoreId, STORE_CHANGED_EVENT } from "@/components/store-switcher";
import { FulfilmentCatalog, type CatalogRow } from "@/components/fulfilment-catalog";
import { listFulfilmentCatalog } from "@/lib/fulfilment.functions";
import { useMyContext } from "../../_client";

export const Route = createFileRoute("/_authenticated/_client/fulfilment/products")({
  head: () => ({
    meta: [
      { title: "Fulfilment products — FlySales" },
      {
        name: "description",
        content:
          "Every fulfilment-managed SKU in your workspace, variation by variation, with photos, stock and shipment history.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FulfilmentProductsPage,
});

function FulfilmentProductsPage() {
  const { data: ctx } = useMyContext();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const read = () => setStoreId(getCurrentStoreId());
    read();
    window.addEventListener(STORE_CHANGED_EVENT, read);
    return () => window.removeEventListener(STORE_CHANGED_EVENT, read);
  }, []);

  const allStores = ctx?.entities?.flatMap((e) => e.stores) ?? [];
  const currentStore = allStores.find((s) => s.id === storeId) ?? allStores[0] ?? null;

  const fetchCatalog = useServerFn(listFulfilmentCatalog);
  const { data, isPending } = useQuery({
    queryKey: ["fulfilment-catalog", currentStore?.id],
    enabled: currentStore != null,
    staleTime: 60_000,
    queryFn: () => fetchCatalog({ data: { storeId: currentStore!.id } }),
  });

  const term = search.trim().toLowerCase();
  const rows = ((data?.rows ?? []) as CatalogRow[]).filter((r) =>
    term
      ? [r.sku, r.product_name, r.variant_label ?? ""].join(" ").toLowerCase().includes(term)
      : true,
  );

  return (
    <div>
      <PageHeader
        title="Products"
        description="Every SKU we fulfil for you — one row per variation, created when a quote is accepted or when stock you own arrives."
      />
      <SectionTabs tabs={FULFILMENT_TABS} />
      <ToolBar>
        <AdminSearch value={search} onChange={setSearch} placeholder="Search by SKU or product" />
      </ToolBar>
      <FulfilmentCatalog
        rows={rows}
        isPending={isPending && currentStore != null}
        invalidateKeys={[["fulfilment-catalog"]]}
      />
    </div>
  );
}
