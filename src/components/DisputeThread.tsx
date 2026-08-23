import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatUSD } from "@/lib/format";
import { postDisputeMessage } from "@/lib/disputes.functions";
import { cn } from "@/lib/utils";

export type DisputeStatus =
  | "open"
  | "investigating"
  | "approved"
  | "rejected"
  | "closed";

const STATUS_STYLES: Record<DisputeStatus, string> = {
  open: "bg-warning/10 text-warning border-warning/25",
  investigating: "bg-info/10 text-info border-info/25",
  approved: "bg-success/10 text-success border-success/25",
  rejected: "bg-danger/10 text-danger border-danger/25",
  closed: "bg-muted text-muted-foreground border-border",
};

export function DisputeStatusBadge({ status }: { status: string }) {
  const key = (status in STATUS_STYLES ? status : "closed") as DisputeStatus;
  return (
    <Badge variant="outline" className={cn("font-normal capitalize", STATUS_STYLES[key])}>
      {status}
    </Badge>
  );
}

export function DisputeReasonLabel({ reason }: { reason: string }) {
  const labels: Record<string, string> = {
    not_delivered: "Never delivered",
    damaged: "Delivered damaged",
    wrong_product: "Wrong product shipped",
  };
  return <span>{labels[reason] ?? reason}</span>;
}

export function DisputeResolutionNote({
  resolution,
  creditAmount,
}: {
  resolution: string | null;
  creditAmount: number | string | null;
}) {
  if (!resolution) return null;
  const text =
    resolution === "wallet_credit"
      ? `Resolved — ${formatUSD(Number(creditAmount ?? 0))} credited to your wallet`
      : resolution === "reshipped"
        ? "Resolved — a reshipment is on the way"
        : "Resolved — rejected";
  return <p className="text-sm font-medium">{text}</p>;
}

type Message = {
  id: string;
  author_role: string;
  body: string;
  created_at: string;
};

/** Shared message thread for client and admin dispute pages. */
export function DisputeThread({
  disputeId,
  messages,
  onPosted,
}: {
  disputeId: string;
  messages: Message[];
  onPosted: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await postDisputeMessage({
        data: { dispute_id: disputeId, body: body.trim() },
      });
      setBody("");
      onPosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Message failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "rounded-lg border p-3 text-sm",
                m.author_role === "admin"
                  ? "border-info/25 bg-info/5"
                  : "border-border bg-card",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {m.author_role === "admin" ? "FlySales" : "You"}
                </span>
                <span>{formatDateTime(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Write a message…"
          className="flex-1"
        />
        <Button onClick={send} disabled={!body.trim() || busy} className="self-end">
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
