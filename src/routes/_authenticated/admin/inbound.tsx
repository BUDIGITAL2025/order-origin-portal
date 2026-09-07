import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, ADMIN_FULFILMENT_TABS } from "@/components/section-tabs";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/inbound")({
  head: () => ({
    meta: [
      { title: "Inbound — FlySales admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminInboundPage,
});

function AdminInboundPage() {
  return (
    <div>
      <PageHeader title="Inbound" description="Shipments on their way into client warehouses." />
      <SectionTabs tabs={ADMIN_FULFILMENT_TABS} />
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm font-medium">Inbound shipments are coming soon</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Restocks from production to arrival will be tracked here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
