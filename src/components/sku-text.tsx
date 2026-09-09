/**
 * The FS- SKU, rendered the same way everywhere: mono, with a copy button.
 * One SKU = one product variation, so this is the identifier that ties the
 * fulfilment catalog, order lines, inbound lines and inventory rows together.
 */
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function SkuText({
  sku,
  className,
  copyable = true,
}: {
  sku: string | null | undefined;
  className?: string | undefined;
  copyable?: boolean | undefined;
}) {
  const [copied, setCopied] = React.useState(false);
  if (!sku) return <span className="text-muted-foreground">—</span>;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(sku);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-xs", className)}>
      {sku}
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy SKU ${sku}`}
          title="Copy SKU"
          className="rounded p-0.5 text-muted-foreground opacity-60 transition hover:bg-muted hover:opacity-100"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </span>
  );
}
