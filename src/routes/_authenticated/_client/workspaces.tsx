import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Plug, Store } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planLabel } from "@/lib/plans";
import { connectMyStore } from "@/lib/profiles.functions";
import { connectDraftStoreSchema } from "@/lib/schemas";
import { useMyContext } from "../_client";

export const Route = createFileRoute("/_authenticated/_client/workspaces")({
  head: () => ({
    meta: [
      { title: "Workspaces — FlySales" },
      { name: "description", content: "Your workspaces: catalogues, quotes, orders and subscriptions." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkspacesPage,
});

/**
 * Workspaces (stores) list. A workspace works in manual mode from day one;
 * connecting Shopify later flips it to automatic sync without losing
 * quotes, catalogue or subscription.
 */
function WorkspacesPage() {
  const { data: ctx } = useMyContext();
  const entities = ctx?.entities ?? [];

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description="Each workspace has its own catalogue, quotes, orders and subscription. Your wallet is shared across all of them."
        actions={
          <Button asChild size="sm">
            <Link to="/stores/new">Add workspace</Link>
          </Button>
        }
      />
      {entities.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            Finish setting up your account first.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {entities.map((entity) => (
            <section key={entity.id}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {entity.legal_name}
              </h2>
              {entity.stores.length === 0 ? (
                <Card>
                  <CardContent className="flex items-center justify-between gap-3 p-5 text-sm text-muted-foreground">
                    <span>No workspaces yet.</span>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/stores/new">Add workspace</Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {entity.stores.map((store) => (
                    <WorkspaceCard key={store.id} store={store} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type CtxStore = NonNullable<
  ReturnType<typeof useMyContext>["data"]
>["entities"][number]["stores"][number];

function WorkspaceCard({ store }: { store: CtxStore }) {
  const isDraft = store.status === "draft";
  const subscribed =
    store.subscription_status === "active" || store.subscription_status === "past_due";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
              <Store className="h-4 w-4 text-muted-foreground" />
            </span>
            <div>
              <CardTitle className="text-base">
                {store.store_name ?? store.store_url ?? "Workspace"}
              </CardTitle>
              <CardDescription className="text-xs">
                {store.store_url ?? "Manual mode — no shop connected"}
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Badge variant={isDraft ? "outline" : "default"}>
              {isDraft ? "Draft" : store.status}
            </Badge>
            <Badge variant="outline">
              {store.integration_mode === "automatic" ? "Shopify sync" : "Manual"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="font-medium">
              {planLabel(store.subscription_plan)}
              {subscribed ? "" : " (not subscribed)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Quotes this month</dt>
            <dd className="tnum font-medium">{store.quotes_used_this_month}</dd>
          </div>
        </dl>

        {isDraft && <ConnectShopifyForm storeId={store.id} />}
        {!subscribed && (
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link to="/billing">
              <ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" />
              Subscribe to unlock quotes
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Upgrade path: connect Shopify to a draft workspace from here. */
function ConnectShopifyForm({ storeId }: { storeId: string }) {
  const callConnect = useServerFn(connectMyStore);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const parsed = connectDraftStoreSchema.safeParse({
      store_id: storeId,
      store_url: url,
      store_name: name,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the domain");
      return;
    }
    setBusy(true);
    try {
      await callConnect({ data: parsed.data });
      toast.success("Shopify connected — this workspace is now active.");
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" className="w-full" onClick={() => setOpen(true)}>
        <Plug className="mr-1.5 h-3.5 w-3.5" />
        Connect Shopify
      </Button>
    );
  }

  return (
    <form onSubmit={connect} className="space-y-2 rounded-xl border border-border p-3">
      <div className="space-y-1.5">
        <Label htmlFor={`ws-url-${storeId}`} className="text-xs">
          Shopify domain
        </Label>
        <Input
          id={`ws-url-${storeId}`}
          placeholder="your-store.myshopify.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`ws-name-${storeId}`} className="text-xs">
          Workspace name (optional)
        </Label>
        <Input
          id={`ws-name-${storeId}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
