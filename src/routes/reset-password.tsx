import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Boxes } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { MARKETING_URL } from "@/lib/config";

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
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
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
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
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
      toast.success("Password updated — sign in with your new password.");
      await supabase.auth.signOut();
      await navigate({ to: "/auth" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <a href={MARKETING_URL} className="mb-6 flex items-center gap-2">
        <Boxes className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">FlySales</span>
      </a>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Choose a new password</CardTitle>
          <CardDescription>
            {ready
              ? "Enter and confirm your new password below."
              : "Validating your reset link…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ready ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="rp-password">New password (min. 8 characters)</Label>
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
          ) : (
            <p className="text-sm text-muted-foreground">
              If nothing happens, your reset link may have expired —{" "}
              <Link to="/auth" className="text-foreground underline underline-offset-4">
                request a new one
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
