import logoBlack from "@/assets/flysales-logo-black.svg.asset.json";
import logoGreen from "@/assets/flysales-logo-green.svg.asset.json";
import { cn } from "@/lib/utils";

/**
 * FlySales wordmark. Black on light/grey surfaces, electric green on dark ones.
 * The dark-mode swap is done with paired <img> elements so it works without JS.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <img src={logoBlack.url} alt="FlySales" className={cn("dark:hidden", className)} />
      <img src={logoGreen.url} alt="FlySales" className={cn("hidden dark:block", className)} />
    </>
  );
}
