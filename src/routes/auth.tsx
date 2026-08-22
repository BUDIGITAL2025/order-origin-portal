import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Boxes } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
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

  const [signup, setSignup] = useState({
    email: "",
    password: "",
    company_name: "",
    contact_name: "",
    phone: "",
    country: "",
    vat_number: "",
    shopify_domain: "",
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
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!data.session) {
        toast.success(
          "Account created. Please confirm your email address, then sign in to finish your company profile.",
        );
        return;
      }
      await callCompleteSignup({
        data: {
          company_name: parsed.data.company_name,
          contact_name: parsed.data.contact_name,
          phone: parsed.data.phone,
          country: parsed.data.country,
          vat_number: parsed.data.vat_number,
          shopify_domain: parsed.data.shopify_domain,
        },
      });
      toast.success("Account created — your application is pending review.");
      await navigate({ to: "/pending" });
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
      <Link to="/" className="mb-6 flex items-center gap-2">
        <Boxes className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">FlySales</span>
      </Link>

      <Card className="w-full max-w-md">
        <Tabs defaultValue="login">
          <CardHeader className="pb-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Request access</TabsTrigger>
            </TabsList>
          </CardHeader>

          <TabsContent value="login">
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
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
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
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignup}>
              <CardContent className="space-y-3">
                <CardTitle className="text-lg">Request access</CardTitle>
                <CardDescription>
                  New accounts are reviewed by our team before activation.
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
                    <Label htmlFor="su-password">Password (min. 8 characters)</Label>
                    <Input
                      id="su-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={signup.password}
                      onChange={setField("password")}
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="su-company">Company name</Label>
                    <Input id="su-company" required value={signup.company_name} onChange={setField("company_name")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-contact">Contact name</Label>
                    <Input id="su-contact" required value={signup.contact_name} onChange={setField("contact_name")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-phone">Phone</Label>
                    <Input id="su-phone" required value={signup.phone} onChange={setField("phone")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-country">Country</Label>
                    <Input id="su-country" required value={signup.country} onChange={setField("country")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-vat">VAT number</Label>
                    <Input id="su-vat" required value={signup.vat_number} onChange={setField("vat_number")} />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="su-shopify">Shopify domain</Label>
                    <Input
                      id="su-shopify"
                      required
                      placeholder="your-store.myshopify.com"
                      value={signup.shopify_domain}
                      onChange={setField("shopify_domain")}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
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
    </div>
  );
}
