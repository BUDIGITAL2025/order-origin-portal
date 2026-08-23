import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — FlySales" },
      {
        name: "description",
        content:
          "How FlySales collects, uses and protects your data and your customers' data. Full policy coming soon.",
      },
      { property: "og:title", content: "Privacy Policy — FlySales" },
      {
        property: "og:description",
        content:
          "How FlySales collects, uses and protects your data and your customers' data. Full policy coming soon.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
        <p className="text-sm font-medium">Privacy Policy — coming soon</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          We're finalising our full privacy policy. In the meantime, the short version: we process
          your account details to run your workspace, and your end customers' shipping details
          solely to fulfil your orders. We never sell data. Questions? Contact us before signing
          up and we'll happily explain.
        </p>
      </div>
    </LegalLayout>
  );
}
