import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, FULFILMENT_TABS } from "@/components/section-tabs";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/_client/fulfilment/inbound")({
  head: () => ({
    meta: [
      { title: "Inbound shipments — FlySales" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InboundPage,
});

function InboundPage() {
  return (
    <div>
      <PageHeader
        title="Inbound"
        description="Shipments on their way into your warehouses."
      />
      <SectionTabs tabs={FULFILMENT_TABS} />
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm font-medium">Inbound shipments are coming soon</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            You will track restocks from production to arrival here, with expected dates and
            quantities per warehouse. Nothing to do yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
