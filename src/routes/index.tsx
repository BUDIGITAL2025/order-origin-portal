import { createFileRoute, Link } from "@tanstack/react-router";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LegalFooter } from "@/components/legal";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { MARKETING_URL } from "@/lib/config";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FlySales Portal — Sign in" },
      {
        name: "description",
        content:
          "Sign in to the FlySales supplier portal: request quotes, manage orders and top up your prepaid wallet.",
      },
      { property: "og:title", content: "FlySales Portal — Sign in" },
      {
        property: "og:description",
        content:
          "Sign in to the FlySales supplier portal: request quotes, manage orders and top up your prepaid wallet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

/**
 * Public door to the portal. flysales.io is the marketing site — this page only
 * needs the brand mark, one line and the two ways in.
 */
function LandingPage() {
  const hydrated = useHydrated();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <a href={MARKETING_URL} aria-label="FlySales">
          <BrandLogo className="h-8 w-auto sm:h-10" />
        </a>

        <h1 className="mt-8 max-w-md text-lg font-medium tracking-tight text-foreground">
          Product sourcing and fulfilment for professional dropshippers.
        </h1>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {hydrated && signedIn ? (
            <Button asChild size="lg">
              <Link to="/dashboard">Open portal</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg">
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth" search={{ mode: "signup" } as never}>
                  Create account
                </Link>
              </Button>
            </>
          )}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          New to FlySales?{" "}
          <a
            href="https://flysales.io"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Learn more at flysales.io
          </a>
        </p>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} FlySales. Prices in USD, quotes in writing.
        </div>
        <LegalFooter className="" />
      </footer>
    </div>
  );
}
