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
import { acceptCurrentTerms, completeSignup, getMyContext } from "@/lib/profiles.functions";
import { completeSignupSchema } from "@/lib/schemas";
import { getSignupSource } from "@/lib/acquisition";
import { TERMS_VERSION } from "@/lib/terms";

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

  // Only unapproved accounts are locked out. Suspended accounts KEEP portal
  // access — their paid orders still deliver and disputes stay available —
  // but every unpaid-work path is gated server-side and a banner explains it.
  if (ctx?.profile && (ctx.profile.status === "pending" || ctx.profile.status === "draft")) {
    return <Navigate to="/pending" />;
  }

  const isSuspended = ctx?.profile?.status === "suspended";
  const firstEntity = ctx?.entities?.[0] ?? null;
  const allStores = ctx?.entities?.flatMap((e) => e.stores) ?? [];

  return (
    <AppShell
      role="client"
      email={ctx?.email ?? null}
      companyName={firstEntity?.legal_name ?? null}
      onboardingStores={allStores}
    >
      {isSuspended ? <SuspendedBanner /> : null}
      <TermsAcceptanceBanner />
      <Outlet />
    </AppShell>
  );
}

/**
 * Persistent banner for suspended accounts: unpaid work (new quotes, orders,
 * payments, top-ups) is frozen, while paid orders keep flowing to delivery
 * and disputes remain available.
 */
function SuspendedBanner() {
  return (
    <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
      <p className="text-sm">
        <span className="font-medium">Your account is suspended.</span>{" "}
        <span className="text-muted-foreground">
          New quotes, orders and payments are paused. Orders already paid continue to fulfilment,
          and you can still track them and open disputes. Contact your account manager to
          reactivate your account.
        </span>
      </p>
    </div>
  );
}

/**
 * One-time Terms acceptance banner. Shows whenever the profile's accepted
 * version lags the current TERMS_VERSION (new users who skipped the signup
 * checkbox, and everyone after a future version bump). Accepting records
 * the new version + timestamp on the profile and the banner never shows
 * again for that version.
 */
function TermsAcceptanceBanner() {
  const { data: ctx } = useMyContext();
  const callAccept = useServerFn(acceptCurrentTerms);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (!ctx?.profile || ctx.profile.terms_version === TERMS_VERSION) return null;

  const handleAccept = async () => {
    setBusy(true);
    try {
      await callAccept({});
      await queryClient.invalidateQueries({ queryKey: ["my-context"] });
      toast.success("Thanks — Terms of Service accepted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record acceptance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">We've updated our Terms of Service.</span>{" "}
        <span className="text-muted-foreground">
          Please{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            review the new terms
          </a>{" "}
          and accept to continue using FlySales.
        </span>
      </p>
      <Button size="sm" onClick={() => void handleAccept()} disabled={busy}>
        {busy ? "Saving…" : "I accept the Terms"}
      </Button>
    </div>
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
      const source = getSignupSource();
      await callCompleteSignup({ data: { ...values, ...(source ? { signup_source: source } : {}) } });
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
