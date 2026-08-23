import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addMyStore } from "@/lib/profiles.functions";
import { addStoreSchema } from "@/lib/schemas";

export const Route = createFileRoute("/_authenticated/_client/workspaces/new")({
  component: NewStorePage,
});

function NewStorePage() {
  const callAddMyStore = useServerFn(addMyStore);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{
    platform: "shopify" | "woocommerce" | "other";
    store_url: string;
    store_name: string;
  }>({ platform: "shopify", store_url: "", store_name: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = addStoreSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your input");
      return;
    }
    setBusy(true);
    try {
      await callAddMyStore({ data: parsed.data });
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
      toast.success("Workspace added — our team will review it.");
      await navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add workspace");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a workspace</CardTitle>
          <CardDescription>
            Each store gets its own catalogue, quotes, orders and subscription. Your wallet
            stays shared across the whole entity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ns-platform">Platform</Label>
              <Select
                value={form.platform}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, platform: v as typeof s.platform }))
                }
              >
                <SelectTrigger id="ns-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shopify">Shopify</SelectItem>
                  <SelectItem value="woocommerce">WooCommerce</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ns-url">
                {form.platform === "shopify" ? "Shopify domain" : "Shop URL"}
              </Label>
              <Input
                id="ns-url"
                required
                placeholder={
                  form.platform === "shopify" ? "your-store.myshopify.com" : "https://your-store.com"
                }
                value={form.store_url}
                onChange={(e) => setForm((s) => ({ ...s, store_url: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ns-name">Workspace name (optional)</Label>
              <Input
                id="ns-name"
                placeholder="My shop"
                value={form.store_name}
                onChange={(e) => setForm((s) => ({ ...s, store_name: e.target.value }))}
              />
            </div>
            {form.platform !== "shopify" && (
              <p className="text-xs text-muted-foreground">
                Non-Shopify stores operate in manual mode for now — orders are synced by our
                team instead of automatically.
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Adding…" : "Add workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
