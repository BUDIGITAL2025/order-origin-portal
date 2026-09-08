/**
 * /ads — the client-facing ads dashboard. Two states: no ad account linked
 * yet (onboarding + "notify us"), or the read-only dashboard scoped to the
 * accounts an admin mapped to their workspaces.
 */
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { getMyAdsContext, requestAdsActivation } from "@/lib/ads.functions";
import { AdsDashboard } from "@/components/ads-dashboard";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/_client/ads")({
  head: () => ({
    meta: [
      { title: "Ads performance — FlySales" },
      {
        name: "description",
        content:
          "Spend, ROAS, purchases and campaign performance from your Meta ad account, inside your FlySales portal.",
      },
      { property: "og:title", content: "Ads performance — FlySales" },
      {
        property: "og:description",
        content: "Track spend, ROAS and campaign results for your store without leaving FlySales.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientAdsPage,
});

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-muted px-2 py-1 font-mono text-sm">{value}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function ClientAdsPage() {
  const contextFn = useServerFn(getMyAdsContext);
  const notifyFn = useServerFn(requestAdsActivation);
  const queryClient = useQueryClient();

  // Free lookup, no provider call — safe to run on render.
  const ctx = useQuery({
    queryKey: ["ads-context"],
    queryFn: () => contextFn(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const notify = useMutation({
    mutationFn: (workspaceId: string) => notifyFn({ data: { workspaceId } }),
    onSuccess: (result) => {
      toast.success(
        result.alreadyRequested
          ? "We already have your request — we'll be in touch."
          : "Thanks — our team has been notified.",
      );
      void queryClient.invalidateQueries({ queryKey: ["ads-context"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send the request"),
  });

  if (ctx.isPending) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your ads setup…
      </div>
    );
  }

  if (ctx.isError) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {ctx.error instanceof Error ? ctx.error.message : "Could not load your ads setup."}
        </div>
      </div>
    );
  }

  const data = ctx.data;

  if (data.accounts.length === 0) {
    const workspace = data.workspaces[0];
    const alreadyRequested = data.pendingRequests.some((r) => r.status === "open");
    return (
      <div className="p-6">
        <div className="mx-auto max-w-2xl rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Megaphone className="h-4 w-4" /> Ads
          </div>
          <h1 className="mt-2 text-xl font-semibold">Connect your ad account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Grant FlySales partner access to your Meta ad account from Business Manager (Business settings →
            Partners → add partner with our Business ID) and we'll activate your dashboard within a day.
          </p>

          <div className="mt-4 rounded-md border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Our Business Manager ID</div>
            <div className="mt-1.5">
              {data.businessManagerId ? (
                <CopyField value={data.businessManagerId} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ask our team for the Business ID — press the button below and we'll send it to you.
                </p>
              )}
            </div>
          </div>

          <ol className="mt-4 space-y-1.5 text-sm text-muted-foreground">
            <li>1. Open Meta Business settings → Partners → Add partner.</li>
            <li>2. Paste our Business ID and give access to the ad account you want us to report on.</li>
            <li>3. Press the button below so we know to look for it.</li>
          </ol>

          <div className="mt-5 flex items-center gap-3">
            <Button
              disabled={!workspace || notify.isPending || alreadyRequested}
              onClick={() => workspace && notify.mutate(workspace.id)}
            >
              {notify.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {alreadyRequested ? "Request sent" : "Notify us"}
            </Button>
            {alreadyRequested ? (
              <span className="text-sm text-muted-foreground">We're on it — you'll hear from us shortly.</span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <AdsDashboard accounts={data.accounts} />
    </div>
  );
}
