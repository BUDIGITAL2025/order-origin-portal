import { createFileRoute, Link } from "@tanstack/react-router";
import { useHydrated } from "@tanstack/react-router";
import { Boxes, ClipboardList, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Relay Sourcing — B2B Dropshipping Supplier Portal" },
      {
        name: "description",
        content:
          "Source products through Relay Sourcing: request quotes with transparent pricing, MOQ and lead times, and manage your prepaid wallet — built for professional dropshippers.",
      },
      { property: "og:title", content: "Relay Sourcing — B2B Dropshipping Supplier Portal" },
      {
        property: "og:description",
        content:
          "Source products through Relay Sourcing: request quotes with transparent pricing, MOQ and lead times, and manage your prepaid wallet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const hydrated = useHydrated();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
    });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold tracking-tight">Relay Sourcing</span>
          </div>
          {hydrated && signedIn ? (
            <Button asChild size="sm">
              <Link to="/dashboard">Open portal</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant={hydrated ? "default" : "outline"}>
              <Link to="/auth">Client sign in</Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-20">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Supplier portal
          </p>
          <h1 className="mt-3 max-w-2xl text-4xl font-bold tracking-tight">
            Product sourcing and fulfilment for professional dropshippers.
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground">
            Send us a product link, receive a firm quote with price, MOQ and lead time,
            and fulfil orders from your prepaid wallet. One portal, no spreadsheets.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Request access</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Quote requests</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Submit any product URL. We source it and reply with a final price, minimum
              order quantity and lead time — valid for a fixed period.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <Wallet className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Prepaid wallet</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A transparent USD ledger of every credit and debit, so your balance is
              always auditable down to the cent.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Vetted accounts</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Every client is reviewed and approved before ordering. Your storefront
              domain and company details are verified up front.
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="border-t border-border py-6">
        <div className="mx-auto max-w-5xl px-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Relay Sourcing. Prices in USD, quotes in writing.
        </div>
      </footer>
    </div>
  );
}
