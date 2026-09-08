/**
 * Product photo thumbnail used wherever a product name appears in a list.
 *
 * Photos live in a private bucket, so paths are exchanged for short-lived
 * signed URLs through one server function. Each distinct path is fetched once
 * per session (react-query cache key = the path), so a list of 50 rows makes
 * at most 50 tiny cached requests and usually far fewer.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImageIcon } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getImageUrls } from "@/lib/media.functions";
import { cn } from "@/lib/utils";

export function useImageUrl(path: string | null | undefined) {
  const resolve = useServerFn(getImageUrls);
  const { data } = useQuery({
    queryKey: ["image-url", path ?? ""],
    enabled: !!path,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!path) return null;
      if (/^https?:\/\//i.test(path)) return path;
      const res = await resolve({ data: { paths: [path] } });
      return res.urls[0]?.url ?? null;
    },
  });
  return data ?? null;
}

export function ProductThumb({
  imageUrls,
  name,
  size = 36,
  className,
}: {
  imageUrls?: string[] | null | undefined;
  name?: string | undefined;
  size?: number | undefined;
  className?: string | undefined;
}) {
  const first = imageUrls?.find(Boolean) ?? null;
  const url = useImageUrl(first);
  const [open, setOpen] = React.useState(false);

  const box = { width: size, height: size } as React.CSSProperties;

  if (!url) {
    return (
      <span
        style={box}
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border border-border bg-muted/50",
          className,
        )}
      >
        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        style={box}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={name ? `Photo of ${name}` : "Open photo"}
        className={cn(
          "shrink-0 overflow-hidden rounded-md border border-border bg-muted/50 transition-opacity hover:opacity-80",
          className,
        )}
      >
        <img src={url} alt={name ?? ""} loading="lazy" className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-2">
          <img src={url} alt={name ?? ""} className="max-h-[75vh] w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Thumbnail + name in one cell, the standard list presentation. */
export function ProductCell({
  imageUrls,
  name,
  secondary,
  size,
}: {
  imageUrls?: string[] | null | undefined;
  name: React.ReactNode;
  secondary?: React.ReactNode | undefined;
  size?: number | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ProductThumb
        imageUrls={imageUrls ?? []}
        name={typeof name === "string" ? name : undefined}
        {...(size != null ? { size } : {})}
      />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {secondary != null && secondary !== "" && (
          <div className="truncate text-xs text-muted-foreground">{secondary}</div>
        )}
      </div>
    </div>
  );
}
