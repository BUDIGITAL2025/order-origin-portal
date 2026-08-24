import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import logoLightAsset from "@/assets/flysales-logo-black.svg.asset.json";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LegalFooter } from "@/components/legal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getAppBaseUrl, MARKETING_URL } from "@/lib/config";
import { loginSchema, signupSchema } from "@/lib/schemas";
import { completeSignup, getMyContext } from "@/lib/profiles.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — FlySales" },
      {
        name: "description",
        content: "Sign in or request access to the FlySales supplier portal.",
      },
      { property: "og:title", content: "Sign in — FlySales" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const callGetMyContext = useServerFn(getMyContext);
  const callCompleteSignup = useServerFn(completeSignup);
  const [busy, setBusy] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  const [signup, setSignup] = useState({
    email: "",
    password: "",
    contact_name: "",
    phone: "",
    country: "",
    terms: false,
  });

  const routeAfterSignIn = async () => {
    const ctx = await callGetMyContext();
    if (ctx.isAdmin) {
      await navigate({ to: "/admin/quotes" });
    } else if (ctx.profile && ctx.profile.status !== "active") {
      await navigate({ to: "/pending" });
    } else {
      await navigate({ to: "/dashboard" });
    }
  };

  // Landing here with a live session (e.g. after clicking the email
  // confirmation link) routes straight into the portal.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void routeAfterSignIn();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email: loginEmail, password: loginPassword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your input");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      await routeAfterSignIn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.shape.email.safeParse(resetEmail);
    if (!parsed.success) {
      toast.error("Enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${getAppBaseUrl()}/reset-password`,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Password reset email sent — check your inbox.");
      setShowReset(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse(signup);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your input");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: `${getAppBaseUrl()}/auth`,
          // Persisted on the auth user so the profile can be completed
          // automatically after email confirmation — no re-asking.
          data: {
            contact_name: parsed.data.contact_name,
            phone: parsed.data.phone,
            country: parsed.data.country,
          },
        },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!data.session) {
        toast.success("Account created. Please confirm your email address, then sign in.");
        return;
      }
      await callCompleteSignup({
        data: {
          contact_name: parsed.data.contact_name,
          phone: parsed.data.phone,
          country: parsed.data.country,
          terms_accepted: true,
        },
      });
      toast.success("Account created — welcome to FlySales.");
      await navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  const setField = (key: keyof typeof signup) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSignup((s) => ({ ...s, [key]: e.target.value }));

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <a href={MARKETING_URL} className="mb-6">
        <img
          src={logoLightAsset.url}
          alt="FlySales"
          className="h-7 w-auto"
        />
      </a>

      <Card className="w-full max-w-md">
        <Tabs defaultValue="login">
          <CardHeader className="pb-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Request access</TabsTrigger>
            </TabsList>
          </CardHeader>

          <TabsContent value="login">
            {showReset ? (
              <form onSubmit={handleReset}>
                <CardContent className="space-y-4">
                  <CardTitle className="text-lg">Reset your password</CardTitle>
                  <CardDescription>
                    We'll email you a link to choose a new password.
                  </CardDescription>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Sending…" : "Send reset link"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setShowReset(false)}
                  >
                    Back to sign in
                  </Button>
                </CardContent>
              </form>
            ) : (
              <form onSubmit={handleLogin}>
                <CardContent className="space-y-4">
                  <CardTitle className="text-lg">Welcome back</CardTitle>
                  <CardDescription>Sign in with your client account.</CardDescription>
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="login-password">Password</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        onClick={() => {
                          setResetEmail(loginEmail);
                          setShowReset(true);
                        }}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <PasswordInput
                      id="login-password"
                      autoComplete="current-password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                </CardContent>
              </form>
            )}
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignup}>
              <CardContent className="space-y-3">
                <CardTitle className="text-lg">Create your account</CardTitle>
                <CardDescription>
                  Just the basics — you'll add your workspace and company details from the dashboard.
                </CardDescription>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="su-email">Email</Label>
                    <Input
                      id="su-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={signup.email}
                      onChange={setField("email")}
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="su-password">
                      Password (min. 8 characters, 1 uppercase, 1 symbol)
                    </Label>
                    <PasswordInput
                      id="su-password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={signup.password}
                      onChange={setField("password")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-contact">Contact name</Label>
                    <Input id="su-contact" required value={signup.contact_name} onChange={setField("contact_name")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-phone">Phone</Label>
                    <Input id="su-phone" required value={signup.phone} onChange={setField("phone")} />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="su-country">Country</Label>
                    <Input id="su-country" required value={signup.country} onChange={setField("country")} />
                  </div>
                </div>
                <div className="flex items-start gap-2.5 pt-1">
                  <Checkbox
                    id="su-terms"
                    checked={signup.terms}
                    onCheckedChange={(checked) =>
                      setSignup((s) => ({ ...s, terms: checked === true }))
                    }
                    aria-describedby="su-terms-label"
                  />
                  <Label
                    id="su-terms-label"
                    htmlFor="su-terms"
                    className="text-xs font-normal leading-snug text-muted-foreground"
                  >
                    I agree to the{" "}
                    <a
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-foreground underline underline-offset-4"
                    >
                      Terms of Service
                    </a>
                  </Label>
                </div>
                <Button type="submit" className="w-full" disabled={busy || !signup.terms}>
                  {busy ? "Creating account…" : "Create account"}
                </Button>
              </CardContent>
            </form>
          </TabsContent>
        </Tabs>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        Access is granted after manual approval. All prices are quoted in USD.
      </p>
      <LegalFooter className="mt-2" />
    </div>
  );
}
