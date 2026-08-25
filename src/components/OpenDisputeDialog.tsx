import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { openDispute } from "@/lib/disputes.functions";
import { STILL_STUCK, SUPPORT_EMAIL } from "@/lib/support";
import { friendlyError } from "@/lib/errors";

type DisputeReason = "not_delivered" | "damaged" | "wrong_product";

const REASON_LABELS: Record<DisputeReason, string> = {
  not_delivered: "Order never delivered",
  damaged: "Order arrived damaged",
  wrong_product: "Wrong product shipped",
};

function addDays(iso: string | null, days: number): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d;
}

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/**
 * Open-a-dispute form. Coverage rules are stated before any input; the same
 * rules are enforced again in the database, this dialog only guides.
 */
export function OpenDisputeDialog({
  orderId,
  orderStatus,
  paidAt,
  deliveredAt,
  maxLeadTimeDays,
  open,
  onOpenChange,
  onOpened,
}: {
  orderId: string;
  orderStatus: string;
  paidAt: string | null;
  deliveredAt: string | null;
  maxLeadTimeDays: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: () => void;
}) {
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  // Eligibility windows (the database re-checks these on submit).
  const estimatedDelivery = addDays(paidAt, maxLeadTimeDays ?? 14);
  const notDeliveredUntil = addDays(estimatedDelivery?.toISOString() ?? null, 30);
  const issueUntil = addDays(deliveredAt, 7);

  const availableReasons = useMemo((): DisputeReason[] => {
    if (orderStatus === "delivered") return ["damaged", "wrong_product"];
    return ["not_delivered"];
  }, [orderStatus]);

  const needsEvidence = reason === "damaged" || reason === "wrong_product";
  const windowText =
    reason === "not_delivered"
      ? `Open until ${fmt(notDeliveredUntil)} (30 days after the estimated delivery date of ${fmt(estimatedDelivery)}).`
      : reason
        ? `Open until ${fmt(issueUntil)} (7 days after delivery on ${fmt(deliveredAt ? new Date(deliveredAt) : null)}).`
        : null;

  async function submit() {
    if (!reason) return;
    if (description.trim().length < 10) {
      toast.error("Please describe what happened (at least 10 characters).");
      return;
    }
    if (needsEvidence && files.length === 0) {
      toast.error("Photo evidence is required for this claim reason.");
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const paths: string[] = [];
      for (const file of files) {
        const path = `${auth.user.id}/${crypto.randomUUID()}/${file.name}`;
        const { error } = await supabase.storage
          .from("dispute-evidence")
          .upload(path, file);
        if (error) throw new Error(error.message);
        paths.push(path);
      }
      const result = await openDispute({
        data: {
          order_id: orderId,
          reason,
          description: description.trim(),
          evidence_urls: paths,
        },
      });
      toast.success("Claim opened. Our team reviews it and replies in the claim thread.");
      onOpenChange(false);
      onOpened();
      window.location.href = `/disputes/${result.dispute_id}`;
    } catch (e) {
      toast.error(friendlyError(e, `Your claim was not opened. Try again in a moment. ${STILL_STUCK}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a claim</DialogTitle>
          <DialogDescription>
            Claims cover what happens between our supplier and delivery to your
            customer. We resolve an approved claim with a wallet credit or a
            reshipment.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
          <p className="font-semibold">Covered</p>
          <ul className="mb-2 list-disc pl-4 text-muted-foreground">
            <li>Order never delivered</li>
            <li>Order delivered damaged</li>
            <li>Wrong product shipped by the supplier</li>
          </ul>
          <p className="font-semibold">Not covered (your commercial risk)</p>
          <ul className="list-disc pl-4 text-muted-foreground">
            <li>End-customer change of mind or returns</li>
            <li>Wrong address supplied by the end customer</li>
            <li>Customs charges on delivery</li>
          </ul>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select
              value={reason ?? ""}
              onValueChange={(v) => setReason(v as DisputeReason)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {availableReasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {windowText && (
              <p className="text-xs text-muted-foreground">{windowText}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispute-description">Description</Label>
            <Textarea
              id="dispute-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe what happened. Include tracking details if relevant."
            />
          </div>

          {needsEvidence && (
            <div className="space-y-1.5">
              <Label htmlFor="dispute-evidence">Photo evidence (required)</Label>
              <input
                id="dispute-evidence"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) =>
                  setFiles(Array.from(e.target.files ?? []).slice(0, 5))
                }
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border file:border-border file:bg-background file:px-4 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Up to 5 photos showing the damage or the wrong item.
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Claims run through the portal, so the thread keeps every message and decision. For
            anything that is not a claim, write to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!reason || busy}>
              {busy ? "Submitting…" : "Open claim"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
