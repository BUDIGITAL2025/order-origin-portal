import { Link } from "@tanstack/react-router";
import logoLightAsset from "@/assets/flysales-logo-light.png.asset.json";
import { MARKETING_URL } from "@/lib/config";

/** Shared chrome for the public legal pages (/terms, /privacy). */
export function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-6">
          <a href={MARKETING_URL} className="flex items-center gap-2">
            <img src={logoLightAsset.url} alt="FlySales" className="h-6 w-auto dark:hidden" />
            <img src={logoLightAsset.url} alt="FlySales" className="hidden h-6 w-auto dark:block" />
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lastUpdated && (
          <p className="mt-1 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        )}
        <div className="mt-8">{children}</div>
      </main>

      <LegalFooter />
    </div>
  );
}

/** Terms / Privacy links — shared by the legal pages, auth screens and portal. */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={className ?? "border-t border-border"}>
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-4 px-6 py-4 text-xs text-muted-foreground">
        <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
          Terms of Service
        </Link>
        <span aria-hidden>·</span>
        <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
