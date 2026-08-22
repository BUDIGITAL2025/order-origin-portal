import { createFileRoute, Navigate, Outlet, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
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
import { completeSignup, getMyContext } from "@/lib/profiles.functions";
import { companyDetailsSchema } from "@/lib/schemas";

export const Route = createFileRoute("/_authenticated/_client")({
  component: ClientLayout,
});

export function useMyContext() {
  const callGetMyContext = useServerFn(getMyContext);
  return useQuery({ queryKey: ["my-context"], queryFn: callGetMyContext });
}

function ClientLayout() {
  const { data: ctx, isPending } = useMyContext();
  const navigate = useNavigate();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your account…
      </div>
    );
  }

  // Admins never see the client area.
  if (ctx?.isAdmin) return <Navigate to="/admin/quotes" />;

  // Signed in but no profile row yet → complete company details first.
  if (ctx && !ctx.profile) return <CompleteProfile />;

  if (ctx?.profile && ctx.profile.status !== "active") return <Navigate to="/pending" />;

  return (
    <AppShell
      role="client"
      email={ctx?.email ?? null}
      companyName={ctx?.profile?.company_name ?? null}
      onboardingProfile={ctx?.profile ?? null}
    >
      <Outlet />
    </AppShell>
  );
}

function CompleteProfile() {
  const callCompleteSignup = useServerFn(completeSignup);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{
    company_name: string;
    contact_name: string;
    phone: string;
    country: string;
    vat_number: string;
    platform: "shopify" | "woocommerce" | "other";
    store_url: string;
  }>({
    company_name: "",
    contact_name: "",
    phone: "",
    country: "",
    vat_number: "",
    platform: "shopify",
    store_url: "",
  });

  const setField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = companyDetailsSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your input");
      return;
    }
    setBusy(true);
    try {
      await callCompleteSignup({ data: parsed.data });
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
      toast.success("Profile saved — your application is pending review.");
      await navigate({ to: "/pending" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Complete your company profile</CardTitle>
          <CardDescription>
            We need these details to review your account. All fields are required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cp-company">Company name</Label>
              <Input id="cp-company" required value={form.company_name} onChange={setField("company_name")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-contact">Contact name</Label>
                <Input id="cp-contact" required value={form.contact_name} onChange={setField("contact_name")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-phone">Phone</Label>
                <Input id="cp-phone" required value={form.phone} onChange={setField("phone")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-country">Country</Label>
                <Input id="cp-country" required value={form.country} onChange={setField("country")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-vat">VAT number</Label>
                <Input id="cp-vat" required value={form.vat_number} onChange={setField("vat_number")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-platform">Platform</Label>
                <Select
                  value={form.platform}
                  onValueChange={(v) =>
                    setForm((s) => ({
                      ...s,
                      platform: v as "shopify" | "woocommerce" | "other",
                    }))
                  }
                >
                  <SelectTrigger id="cp-platform">
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
                <Label htmlFor="cp-store-url">
                  {form.platform === "shopify" ? "Shopify domain" : "Store URL"}
                </Label>
                <Input
                  id="cp-store-url"
                  required
                  placeholder={
                    form.platform === "shopify"
                      ? "your-store.myshopify.com"
                      : "https://your-store.com"
                  }
                  value={form.store_url}
                  onChange={setField("store_url")}
                />
              </div>
            </div>
            {form.platform !== "shopify" && (
              <p className="text-xs text-muted-foreground">
                Non-Shopify stores operate in manual mode for now — orders are synced by our
                team instead of automatically.
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Submit for review"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
