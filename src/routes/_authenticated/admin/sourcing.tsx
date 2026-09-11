import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { SectionTabs, ADMIN_SOURCING_TABS } from "@/components/section-tabs";
import { Chip, FilterTabs, PanelHeader, SummaryBar, TableShell } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatUSD } from "@/lib/format";
import { collaboratorInviteSchema } from "@/lib/schemas";
import { DEFAULT_FEE_TIERS, pct, tierTermsSentence, type FeeTier } from "@/lib/fee-tiers";
import {
  adminEarningsReport,
  adminInviteCollaborator,
  adminListCollaborators,
  adminResendCollaboratorInvite,
  adminSettleEarnings,
  adminUpdateCollaborator,
} from "@/lib/sourcing.functions";

/** "invited 3d ago" — makes stale pending invites obvious at a glance. */
function invitedAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "invited today";
  return `invited ${days}d ago`;
}

export const Route = createFileRoute("/_authenticated/admin/sourcing")({
  head: () => ({
    meta: [{ title: "Sourcing team — FlySales admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminSourcingPage,
});

function AdminSourcingPage() {
  const queryClient = useQueryClient();
  const fetchCollaborators = useServerFn(adminListCollaborators);
  const fetchEarnings = useServerFn(adminEarningsReport);
  const callUpdate = useServerFn(adminUpdateCollaborator);
  const callSettle = useServerFn(adminSettleEarnings);
  const callResend = useServerFn(adminResendCollaboratorInvite);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; tiers: FeeTier[] } | null>(
    null,
  );
  const [filter, setFilter] = useState<"all" | "pending" | "settled">("pending");

  const { data: collaborators } = useQuery({
    queryKey: ["admin-collaborators"],
    queryFn: fetchCollaborators,
  });
  const { data: earnings } = useQuery({
    queryKey: ["admin-earnings", filter],
    queryFn: () => fetchEarnings({ data: { settled: filter } }),
  });

  const rows = collaborators?.collaborators ?? [];
  const earningRows = earnings?.rows ?? [];
  const pendingTotal = rows.reduce((s, c) => s + c.pending, 0);
  const settledTotal = rows.reduce((s, c) => s + c.settled_total, 0);

  const toggleActive = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => callUpdate({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-collaborators"] });
    },
    onError: (e) => toast.error(friendlyError(e, "The collaborator was not updated.")),
  });

  const settle = useMutation({
    mutationFn: (ids: string[]) => callSettle({ data: { ids } }),
    onSuccess: async (r) => {
      toast.success(`${r.settled} entries marked as paid.`);
      await queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e, "The payout was not recorded.")),
  });

  const resendInvite = useMutation({
    mutationFn: (id: string) => callResend({ data: { id } }),
    onSuccess: async () => {
      toast.success("Invitation sent again.");
      await queryClient.invalidateQueries({ queryKey: ["admin-collaborators"] });
    },
    onError: (e) => toast.error(friendlyError(e, "The invitation was not sent.")),
  });

  const pendingIds = earningRows.filter((r) => !r.settled).map((r) => r.id);

  return (
    <div>
      <PageHeader
        title="Sourcing team"
        description="Collaborators source suppliers and enter supplier prices. Their fee is added to the cost automatically; they never see the client price."
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            Invite collaborator
          </Button>
        }
      />
      <SectionTabs tabs={ADMIN_SOURCING_TABS} />

      <SummaryBar
        items={[
          { key: "people", label: "Collaborators", value: String(rows.length) },
          {
            key: "active",
            label: "Active",
            value: String(rows.filter((c) => c.active).length),
            tone: "success",
          },
          { key: "pending", label: "Owed", value: formatUSD(pendingTotal), tone: "warning" },
          { key: "paid", label: "Paid out", value: formatUSD(settledTotal) },
        ]}
      />

      <TableShell className="mb-6">
        <TableHeader>
          <TableRow>
            <TableHead>Collaborator</TableHead>
            <TableHead>Fee tier</TableHead>
            <TableHead className="text-right">Owed</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Active</TableHead>
            <TableHead className="text-right">Invite</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{c.display_name || c.email}</span>
                  {c.invite_pending && <Chip tone="warning">Pending</Chip>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.email}
                  {c.invite_pending && invitedAgo(c.invite_last_sent_at ?? c.invited_at)
                    ? ` · ${invitedAgo(c.invite_last_sent_at ?? c.invited_at)}`
                    : ""}
                </div>
              </TableCell>
              <TableCell>
                <button
                  type="button"
                  className="text-left"
                  onClick={() =>
                    setEditing({ id: c.id, name: c.display_name || c.email, tiers: c.fee_tiers })
                  }
                >
                  <span className="text-sm font-medium">{pct(c.tier.rate)}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    {c.tier.nextAt != null
                      ? `· ${c.tier.count} / ${c.tier.nextAt}${
                          c.tier.nextRate != null ? ` → ${pct(c.tier.nextRate)}` : ""
                        }`
                      : `· ${c.tier.count} transactions · final rate`}
                  </span>
                  <div className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                    {tierTermsSentence(c.fee_tiers)}
                  </div>
                </button>
              </TableCell>
              <TableCell className="text-right tnum text-sm">{formatUSD(c.pending)}</TableCell>
              <TableCell className="text-right tnum text-sm text-muted-foreground">
                {formatUSD(c.settled_total)}
              </TableCell>
              <TableCell>
                <Switch
                  checked={c.active}
                  onCheckedChange={(v) => toggleActive.mutate({ id: c.id, active: v })}
                />
              </TableCell>
              <TableCell className="text-right">
                {c.invite_pending && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resendInvite.isPending}
                    onClick={() => resendInvite.mutate(c.id)}
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    Resend invite
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                No collaborators yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </TableShell>

      <PanelHeader title="Commission ledger" />
      <div className="mb-3 flex items-center gap-2">
        <FilterTabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: "pending", label: "Owed" },
            { id: "settled", label: "Paid" },
            { id: "all", label: "All" },
          ]}
        />
        {pendingIds.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={settle.isPending}
            onClick={() => settle.mutate(pendingIds)}
          >
            Mark {pendingIds.length} as paid
          </Button>
        )}
      </div>

      <TableShell>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Collaborator</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Units</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {earningRows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {formatDate(r.accrued_at)}
              </TableCell>
              <TableCell className="text-sm">{r.collaborator}</TableCell>
              <TableCell className="text-sm">{r.description}</TableCell>
              <TableCell className="text-right tnum text-sm">{r.units}</TableCell>
              <TableCell className="text-right tnum text-sm font-medium">
                {formatUSD(Number(r.amount))}
              </TableCell>
              <TableCell>
                {r.settled ? <Chip tone="success">Paid</Chip> : <Chip tone="warning">Owed</Chip>}
              </TableCell>
            </TableRow>
          ))}
          {earningRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                Nothing to show for this filter.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </TableShell>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <TiersDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const callInvite = useServerFn(adminInviteCollaborator);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const invite = useMutation({
    mutationFn: async () => {
      const parsed = collaboratorInviteSchema.safeParse({
        email,
        display_name: name,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your input");
      return callInvite({ data: parsed.data });
    },
    onSuccess: async (r) => {
      if (r.emailSent) toast.success("Invitation email sent.");
      else
        toast.warning(
          `Collaborator added, but the email was not sent: ${r.emailError ?? "unknown reason"}`,
        );
      onOpenChange(false);
      setEmail("");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["admin-collaborators"] });
    },
    onError: (e) => toast.error(friendlyError(e, "The invitation was not sent.")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a collaborator</DialogTitle>
          <DialogDescription>
            They get their own desk with the sourcing queue and their earnings — nothing else.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Standard terms: {tierTermsSentence(DEFAULT_FEE_TIERS)}. The invitation email states
            these terms. You can negotiate an exception after they join.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={invite.isPending} onClick={() => invite.mutate()}>
            {invite.isPending ? "Sending…" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Negotiated exceptions: the tier table is per agent. Editing it only affects
 * quotes priced from now on — every quote already carries its frozen rate.
 */
function TiersDialog({
  editing,
  onClose,
}: {
  editing: { id: string; name: string; tiers: FeeTier[] } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const callUpdate = useServerFn(adminUpdateCollaborator);
  const [rows, setRows] = useState<{ upto: string; rate: string }[]>([]);

  useEffect(() => {
    if (!editing) return;
    setRows(
      editing.tiers.map((t) => ({
        upto: t.upto == null ? "" : String(t.upto),
        rate: String(Math.round(t.rate * 1000) / 10),
      })),
    );
  }, [editing]);

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const tiers = rows.map((r) => ({
        upto: r.upto.trim() === "" ? null : Number(r.upto),
        rate_pct: Number(r.rate),
      }));
      return callUpdate({ data: { id: editing.id, fee_tiers: tiers } });
    },
    onSuccess: async () => {
      toast.success("Tier terms updated. Quotes already priced keep their rate.");
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["admin-collaborators"] });
    },
    onError: (e) => toast.error(friendlyError(e, "The tiers were not saved.")),
  });

  return (
    <Dialog open={!!editing} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fee tiers — {editing?.name}</DialogTitle>
          <DialogDescription>
            Each row is a rate up to a cumulative number of paid transactions. Leave the last row's
            count empty so it runs forever.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Up to transaction</Label>
                <Input
                  inputMode="numeric"
                  placeholder="forever"
                  value={r.upto}
                  onChange={(e) =>
                    setRows((p) => p.map((x, j) => (j === i ? { ...x, upto: e.target.value } : x)))
                  }
                />
              </div>
              <div className="w-24 space-y-1.5">
                <Label className="text-xs">Rate %</Label>
                <Input
                  inputMode="decimal"
                  value={r.rate}
                  onChange={(e) =>
                    setRows((p) => p.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((p) => [...p, { upto: "", rate: "3" }])}
          >
            Add tier
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save tiers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
