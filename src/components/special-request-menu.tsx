/**
 * Structured special requests: typed intents rather than free text, so every
 * ask lands in the admin queue with the context we need to act on it.
 */
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { COUNTRIES } from "@/lib/countries";
import { friendlyError } from "@/lib/errors";
import { createQuoteIntent, INTENT_LABELS } from "@/lib/quote-intents.functions";
import { cn } from "@/lib/utils";

type IntentType = keyof typeof INTENT_LABELS;

const ORDER: IntentType[] = [
  "price_too_high",
  "add_country",
  "size_chart",
  "factory_photos",
  "materials_list",
  "new_variant",
  "stop_quoting",
];

export function SpecialRequestMenu({
  quoteId,
  hasOffers,
}: {
  quoteId: string;
  hasOffers: boolean;
}) {
  const queryClient = useQueryClient();
  const callIntent = useServerFn(createQuoteIntent);
  const [open, setOpen] = useState<IntentType | null>(null);
  const [note, setNote] = useState("");
  const [countries, setCountries] = useState<string[]>([]);

  const submit = useMutation({
    mutationFn: () =>
      callIntent({
        data: {
          quote_id: quoteId,
          type: open as IntentType,
          countries,
          note,
        },
      }),
    onSuccess: () => {
      toast.success("Request sent — you'll see our answer in the conversation.");
      setOpen(null);
      setNote("");
      setCountries([]);
      void queryClient.invalidateQueries({ queryKey: ["quote-thread", quoteId] });
    },
    onError: (err) => toast.error(friendlyError(err)),
  });

  const toggleCountry = (code: string) => {
    setCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : prev.length >= 3 ? prev : [...prev, code],
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <MessageSquarePlus className="h-3.5 w-3.5" /> Special request
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ORDER.map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() => {
                setNote("");
                setCountries([]);
                setOpen(type);
              }}
            >
              {INTENT_LABELS[type]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open != null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{open ? INTENT_LABELS[open] : ""}</DialogTitle>
            <DialogDescription>
              {open === "stop_quoting"
                ? hasOffers
                  ? "We'll stop working on this product. The offers already published stay visible until they expire, but nothing new is sourced."
                  : "We'll stop sourcing this product. Nothing has been published yet, so this request closes it."
                : open === "add_country"
                  ? "Pick up to three extra destinations. We price each one separately."
                  : "Tell us anything that helps — we answer in the quote conversation."}
            </DialogDescription>
          </DialogHeader>

          {open === "add_country" && (
            <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
              {COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleCountry(c.code)}
                  className={cn(
                    "rounded-full border border-border px-2.5 py-1 text-xs",
                    countries.includes(c.code)
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            rows={3}
            maxLength={1000}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                submit.isPending || (open === "add_country" && countries.length === 0)
              }
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Sending…" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
