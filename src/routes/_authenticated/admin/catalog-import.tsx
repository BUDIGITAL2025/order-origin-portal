import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { CatalogImportPanel } from "@/components/catalog-import";

const searchSchema = z.object({ import: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/admin/catalog-import")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Catalog import — FlySales admin" },
      {
        name: "description",
        content:
          "Read a supplier catalogue with AI, review every extracted row by hand, then convert the rows you approve into draft quote requests or products.",
      },
      { property: "og:title", content: "Catalog import — FlySales admin" },
      {
        property: "og:description",
        content: "AI-assisted supplier catalogue extraction with mandatory human review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CatalogImportPage,
});

function CatalogImportPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalog import"
        description="Upload a supplier catalogue, check every row against the original page, then convert the rows you approve."
      />
      <CatalogImportPanel
        importId={search.import ?? null}
        onOpenImport={(id) =>
          navigate({
            to: "/admin/catalog-import",
            search: id ? { import: id } : {},
            replace: true,
          })
        }
      />
    </div>
  );
}
