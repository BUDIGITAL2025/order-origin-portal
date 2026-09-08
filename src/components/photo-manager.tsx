/**
 * Admin photo manager — add, paste or remove up to five photos on a quote
 * request or a catalogue product. Files go to the private `quote-images`
 * bucket under the uploading admin's own folder; external image URLs are
 * stored verbatim.
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { adminSetPhotos } from "@/lib/media.functions";
import { friendlyError } from "@/lib/errors";
import { useImageUrl } from "@/components/product-thumb";

const MAX = 5;

function Preview({ path, onRemove }: { path: string; onRemove: () => void }) {
  const url = useImageUrl(path);
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-md border border-border bg-muted/50">
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-muted-foreground hover:text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function PhotoManagerDialog({
  open,
  onOpenChange,
  target,
  id,
  name,
  initial,
  invalidateKeys = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: "quote" | "product";
  id: string;
  name: string;
  initial: string[];
  invalidateKeys?: readonly (readonly unknown[])[];
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(adminSetPhotos);
  const [paths, setPaths] = React.useState<string[]>(initial);
  const [url, setUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setPaths(initial.slice(0, MAX));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX - paths.length;
    if (room <= 0) {
      toast.error(`Up to ${MAX} photos.`);
      return;
    }
    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sign in again to upload.");
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const key = `${uid}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("quote-images").upload(key, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (error) throw new Error(error.message);
        added.push(key);
      }
      setPaths((p) => [...p, ...added].slice(0, MAX));
    } catch (e) {
      toast.error(friendlyError(e, "The photo was not uploaded."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const persist = useMutation({
    mutationFn: () => save({ data: { target, id, image_urls: paths } }),
    onSuccess: async () => {
      toast.success("Photos updated.");
      for (const key of invalidateKeys) {
        await queryClient.invalidateQueries({ queryKey: key as unknown[] });
      }
      onOpenChange(false);
    },
    onError: (e) => toast.error(friendlyError(e, "The photos were not saved.")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Photos — {name}</DialogTitle>
          <DialogDescription>
            Up to {MAX} photos. Upload files or paste an image address from a supplier page.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {paths.map((p) => (
            <Preview
              key={p}
              path={p}
              onRemove={() => setPaths((list) => list.filter((x) => x !== p))}
            />
          ))}
          {paths.length === 0 && <p className="text-sm text-muted-foreground">No photos yet.</p>}
        </div>

        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void upload(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading || paths.length >= MAX}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-1.5 h-4 w-4" />
            )}
            Upload photo
          </Button>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/photo.jpg"
            />
            <Button
              type="button"
              variant="outline"
              disabled={paths.length >= MAX}
              onClick={() => {
                const v = url.trim();
                if (!/^https?:\/\//i.test(v)) {
                  toast.error("Paste a full image address.");
                  return;
                }
                setPaths((p) => [...p, v].slice(0, MAX));
                setUrl("");
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={persist.isPending} onClick={() => persist.mutate()}>
            {persist.isPending ? "Saving…" : "Save photos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
