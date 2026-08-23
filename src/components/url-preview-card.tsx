import { Globe, ImageOff, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface UrlPreviewData {
  title: string | null;
  description: string | null;
  imageUrls: string[];
  priceHint: string | null;
}

export type UrlPreviewState =
  | { status: "loading" }
  | ({ status: "ok" } & UrlPreviewData)
  | { status: "unavailable" };

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function RemoveImageButton({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove image from the request"
      title="Remove image from the request"
      className={`absolute right-1 top-1 rounded-full bg-background/85 text-muted-foreground shadow-sm transition-colors hover:text-foreground ${
        small ? "p-0.5" : "p-1"
      }`}
    >
      <X className={small ? "h-3 w-3" : "h-3.5 w-3.5"} />
    </button>
  );
}

function DomainRow({ domain, url }: { domain: string; url: string }) {
  return (
    <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
      <Globe className="h-3 w-3 shrink-0" />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="truncate underline-offset-2 hover:underline"
      >
        {domain}
      </a>
    </p>
  );
}

/**
 * Product preview card for a scraped URL. Shared by the client quote form
 * (interactive: scraped images can be detached before submitting) and the
 * admin sourcing view (read-only). The listed-price hint is deliberately
 * muted and small so nobody confuses the source-page price with our quote.
 */
export function UrlPreviewCard({
  url,
  preview,
  onRemoveImage,
}: {
  url: string;
  preview: UrlPreviewState;
  onRemoveImage?: (imageUrl: string) => void;
}) {
  const domain = domainOf(url);

  if (preview.status === "loading") {
    return (
      <Card className="overflow-hidden" aria-busy="true" aria-label="Loading product preview">
        <div className="aspect-[16/9] w-full animate-pulse bg-muted" />
        <CardContent className="space-y-2 p-4">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (preview.status === "unavailable") {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Preview unavailable</p>
            <p className="text-xs text-muted-foreground">
              Your request will still be submitted normally.
            </p>
            <DomainRow domain={domain} url={url} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const [main, ...rest] = preview.imageUrls;
  return (
    <Card className="overflow-hidden">
      {main && (
        <div className="relative aspect-[16/9] w-full bg-muted">
          <img
            src={main}
            alt={preview.title ?? "Product image from source page"}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {onRemoveImage && <RemoveImageButton onClick={() => onRemoveImage(main)} />}
        </div>
      )}
      {rest.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3">
          {rest.map((img) => (
            <div
              key={img}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border"
            >
              <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
              {onRemoveImage && <RemoveImageButton small onClick={() => onRemoveImage(img)} />}
            </div>
          ))}
        </div>
      )}
      <CardContent className="space-y-1.5 p-4">
        <p className="text-sm font-medium leading-snug">{preview.title ?? domain}</p>
        {preview.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{preview.description}</p>
        )}
        {preview.priceHint && (
          <p className="text-xs text-muted-foreground">
            Listed price on source page: <span className="tnum">{preview.priceHint}</span> — not our
            quote
          </p>
        )}
        <DomainRow domain={domain} url={url} />
      </CardContent>
    </Card>
  );
}
