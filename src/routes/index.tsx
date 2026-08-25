import { createFileRoute, Link } from "@tanstack/react-router";
import { SUPPORT_EMAIL } from "@/lib/support";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";

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
    <div className="entry-canvas relative flex min-h-screen flex-col overflow-hidden">
      <div
        aria-hidden
        className="entry-glow pointer-events-none absolute inset-x-0 top-0 h-[70vh]"
      />

      <main className="relative flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <a href={MARKETING_URL} aria-label="FlySales">
          <BrandLogo forceDark className="h-9 w-auto sm:h-11" />
        </a>

        <h1 className="mt-12 max-w-xl text-3xl font-semibold leading-[1.1] tracking-tight text-entry-fg sm:text-4xl">
          Product sourcing and fulfilment for{" "}
          <span className="text-entry-accent">professional dropshippers</span>.
        </h1>

        <p className="mt-5 max-w-md text-sm leading-relaxed text-entry-muted">
          Request quotes, manage orders and top up your wallet — one portal for your whole
          supply chain.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {hydrated && signedIn ? (
            <Button
              asChild
              size="lg"
              className="rounded-full bg-entry-accent px-7 text-entry-accent-fg hover:bg-entry-accent/90"
            >
              <Link to="/dashboard">Open portal</Link>
            </Button>
          ) : (
            <>
              <Button
                asChild
                size="lg"
                className="rounded-full bg-entry-accent px-7 text-entry-accent-fg hover:bg-entry-accent/90"
              >
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-entry-line bg-transparent px-7 text-entry-fg hover:bg-white/5 hover:text-entry-fg"
              >
                <Link to="/auth">Create account</Link>
              </Button>
            </>
          )}
        </div>

        <p className="mt-8 text-xs text-entry-muted">
          New to FlySales?{" "}
          <a
            href="https://flysales.io"
            className="text-entry-fg underline underline-offset-4 hover:text-entry-accent"
          >
            Learn more at flysales.io
          </a>
        </p>
      </main>

      <footer className="relative border-t border-entry-line">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 py-6 text-xs text-entry-muted">
          <div>© {new Date().getFullYear()} FlySales. Prices in USD, quotes in writing.</div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="underline-offset-4 hover:text-entry-fg hover:underline">
              Terms of Service
            </Link>
            <span aria-hidden>·</span>
            <Link to="/privacy" className="underline-offset-4 hover:text-entry-fg hover:underline">
              Privacy Policy
            </Link>
            <span aria-hidden>·</span>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline-offset-4 hover:text-entry-fg hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
