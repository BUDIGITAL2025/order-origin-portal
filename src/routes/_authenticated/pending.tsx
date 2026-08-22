import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Boxes, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useMyContext } from "./_client";

export const Route = createFileRoute("/_authenticated/pending")({
  head: () => ({
    meta: [
      { title: "Account pending — FlySales" },
      { name: "description", content: "Your FlySales account is awaiting approval." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PendingPage,
});

function PendingPage() {
  const { data: ctx, isPending } = useMyContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your account…
      </div>
    );
  }

  if (ctx?.isAdmin) return <Navigate to="/admin/quotes" />;
  if (ctx?.profile?.status === "active") return <Navigate to="/dashboard" />;

  const suspended = ctx?.profile?.status === "suspended";

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-6 flex items-center gap-2">
        <Boxes className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">FlySales</span>
      </div>
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-warning/10">
            <Clock className="h-5 w-5 text-warning" />
          </div>
          <CardTitle className="text-lg">
            {suspended ? "Account suspended" : "Application under review"}
          </CardTitle>
          <CardDescription>
            {suspended
              ? "Your account has been suspended. Please contact your account manager for details."
              : `Thanks${ctx?.profile?.contact_name ? `, ${ctx.profile.contact_name}` : ""} — we're reviewing your company details. You'll get access to quotes and your wallet as soon as your account is approved.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ctx?.profile && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-left text-sm">
              <div className="font-medium">{ctx.profile.company_name}</div>
              <div className="text-muted-foreground">{ctx.profile.shopify_domain}</div>
            </div>
          )}
          <Button variant="outline" className="w-full" onClick={() => void handleSignOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
