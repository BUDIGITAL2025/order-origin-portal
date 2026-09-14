import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { MARKETING_URL } from "@/lib/config";
import { getMyContext } from "@/lib/profiles.functions";
import { passwordSchema } from "@/lib/schemas";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — FlySales" },
      { name: "description", content: "Choose a new password for your FlySales account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const fetchContext = useServerFn(getMyContext);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [newLinkEmail, setNewLinkEmail] = useState("");

  useEffect(() => {
    // Supabase reports a dead link through the URL (hash or query) before any
    // session exists — surface it instead of spinning on "Validating…".
    const params = new URLSearchParams(
      (window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "") ||
        window.location.search.replace(/^\?/, ""),
    );
    const code = params.get("error_code");
    const description = params.get("error_description");
    if (code || params.get("error")) {
      setLinkError(
        code === "otp_expired"
          ? "This link has expired or was already used. Request a new one below."
          : (description ?? "").replace(/\+/g, " ") ||
              "This link is no longer valid. Request a new one below.",
      );
    }

    // The recovery link carries its token in the URL hash; the Supabase client
    // exchanges it and fires PASSWORD_RECOVERY once the session is established.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    // No session and no error after the exchange window: the link was invalid.
    const timer = window.setTimeout(() => {
      setReady((isReady) => {
        if (!isReady) {
          setLinkError(
            (current) =>
              current ?? "We couldn't validate this link — it may have expired or been used.",
          );
        }
        return isReady;
      });
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const requestNewLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(newLinkEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("New link sent — check your inbox.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your password");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(error.message);
        return;
      }
      const account = await fetchContext();
      if (account.isSourcing && !account.isAdmin) {
        toast.success("Password set — welcome to your sourcing desk.");
        await navigate({ to: "/desk/queue" });
      } else {
        toast.success("Password updated — sign in with your new password.");
        await supabase.auth.signOut();
        await navigate({ to: "/auth" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <a href={MARKETING_URL} className="mb-6">
        <BrandLogo className="h-8 w-auto sm:h-10" />
      </a>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Choose a new password</CardTitle>
          <CardDescription>
            {ready
              ? "Enter and confirm your new password below."
              : linkError
                ? "We couldn't open that link."
                : "Validating your reset link…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ready ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rp-password">
                  New password (min. 8 characters, 1 uppercase, 1 symbol)
                </Label>
                <PasswordInput
                  id="rp-password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-confirm">Confirm new password</Label>
                <PasswordInput
                  id="rp-confirm"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          ) : linkError ? (
            <form onSubmit={requestNewLink} className="space-y-3">
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
                {linkError}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="rp-email">Your email</Label>
                <Input
                  id="rp-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={newLinkEmail}
                  onChange={(e) => setNewLinkEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending…" : "Send me a new link"}
              </Button>
              <Link
                to="/auth"
                className="block text-center text-xs text-muted-foreground underline underline-offset-4"
              >
                Back to sign in
              </Link>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Validating your link…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
