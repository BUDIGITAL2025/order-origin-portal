import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { completeSignup, getMyContext } from "@/lib/profiles.functions";
import { completeSignupSchema } from "@/lib/schemas";

export const Route = createFileRoute("/_authenticated/_client")({
  component: ClientLayout,
});

export function useMyContext() {
  const callGetMyContext = useServerFn(getMyContext);
  return useQuery({ queryKey: ["my-context"], queryFn: callGetMyContext });
}

function ClientLayout() {
  const { data: ctx, isPending } = useMyContext();


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

  const firstEntity = ctx?.entities?.[0] ?? null;
  const firstStore = ctx?.entities?.flatMap((e) => e.stores)[0] ?? null;

  return (
    <AppShell
      role="client"
      email={ctx?.email ?? null}
      companyName={firstEntity?.legal_name ?? null}
      onboardingStore={firstStore}
    >
      <Outlet />
    </AppShell>
  );
}

function CompleteProfile() {
  const callCompleteSignup = useServerFn(completeSignup);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  // The signup form already collected these values — they live on the auth
  // user's metadata. If they're all present we complete the profile without
  // asking again; the manual form below is only a fallback for accounts
  // created before that (or via OAuth) where metadata is missing.
  const [phase, setPhase] = useState<"checking" | "form">("checking");
  const attempted = useRef(false);
  const [form, setForm] = useState({ contact_name: "", phone: "", country: "" });

  const setField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [key]: e.target.value }));

  const submit = async (values: typeof form) => {
    setBusy(true);
    try {
      await callCompleteSignup({ data: values });
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
      toast.success("Profile saved — welcome to FlySales.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
      setPhase("form");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void supabase.auth.getUser().then(({ data }) => {
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const fromMeta = {
        contact_name: typeof meta["contact_name"] === "string" ? (meta["contact_name"] as string) : "",
        phone: typeof meta["phone"] === "string" ? (meta["phone"] as string) : "",
        country: typeof meta["country"] === "string" ? (meta["country"] as string) : "",
      };
      setForm(fromMeta);
      const parsed = completeSignupSchema.safeParse(fromMeta);
      if (parsed.success) {
        void submit(parsed.data);
      } else {
        setPhase("form");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = completeSignupSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your input");
      return;
    }
    await submit(parsed.data);
  };

  if (phase === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Setting up your account…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Complete your profile</CardTitle>
          <CardDescription>
            Just the basics — you can add a workspace and company details afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cp-contact">Contact name</Label>
              <Input id="cp-contact" required value={form.contact_name} onChange={setField("contact_name")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-phone">Phone</Label>
                <Input id="cp-phone" required value={form.phone} onChange={setField("phone")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-country">Country</Label>
                <Input id="cp-country" required value={form.country} onChange={setField("country")} />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
