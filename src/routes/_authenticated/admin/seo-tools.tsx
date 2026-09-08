/**
 * /admin/seo-tools — FlySales SEO research module (admin-only), Phase 1.
 * Powered by the DataForSEO live API through the server-side gateway with
 * cache + usage log. The active tab lives in the query string so a view can
 * be shared or restored on refresh.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SeoTools } from "@/components/seo-tools";

const str = (search: Record<string, unknown>, key: string): string | undefined => {
  const v = search[key];
  return typeof v === "string" && v !== "" ? v : undefined;
};

export const Route = createFileRoute("/_authenticated/admin/seo-tools")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: str(search, "tab") ?? "domain",
  }),
  head: () => ({
    meta: [
      { title: "FlySales SEO research — admin" },
      {
        name: "description",
        content:
          "Internal SEO research: domain overview, keyword volumes and live SERP checks with per-call cost tracking.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSeoToolsPage,
});

function AdminSeoToolsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="p-6">
      <SeoTools
        tab={search.tab}
        go={(patch) =>
          void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
        }
      />
    </div>
  );
}
