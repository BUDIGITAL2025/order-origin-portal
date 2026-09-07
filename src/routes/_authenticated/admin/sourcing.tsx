import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus } from "lucide-react";
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
import {
  adminEarningsReport,
  adminInviteCollaborator,
  adminListCollaborators,
  adminSettleEarnings,
  adminUpdateCollaborator,
} from "@/lib/sourcing.functions";

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

  const [inviteOpen, setInviteOpen] = useState(false);
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
            <TableHead className="text-right">Fee</TableHead>
            <TableHead className="text-right">Owed</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className="text-sm">{c.display_name || c.email}</div>
                <div className="text-xs text-muted-foreground">{c.email}</div>
              </TableCell>
              <TableCell className="text-right tnum text-sm">
                {(Number(c.fee_rate) * 100).toFixed(1)}%
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
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-sm text-muted-foreground">
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
  const [fee, setFee] = useState("8");

  const invite = useMutation({
    mutationFn: async () => {
      const parsed = collaboratorInviteSchema.safeParse({
        email,
        display_name: name,
        fee_rate_pct: Number(fee),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check your input");
      return callInvite({ data: parsed.data });
    },
    onSuccess: async (r) => {
      toast.success(r.invited ? "Invitation sent." : "Existing account added to the desk.");
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
          <div className="space-y-1.5">
            <Label>Fee on supplier price (%)</Label>
            <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
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
