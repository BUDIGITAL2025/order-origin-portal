import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Chip, PanelHeader, TableShell } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { inviteStaff, listStaff, setStaffLevel, setStaffStatus } from "@/lib/staff.functions";

const LEVELS = [
  { value: "owner", label: "Owner", hint: "Everything, including the team and pricing config." },
  {
    value: "collaborator",
    label: "Collaborator",
    hint: "Day-to-day operations. No team, deletes, modules or pricing.",
  },
  { value: "reader", label: "Reader", hint: "Read-only across the whole console." },
] as const;

export const Route = createFileRoute("/_authenticated/admin/team")({
  head: () => ({
    meta: [{ title: "Team — FlySales admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminTeamPage,
});

function AdminTeamPage() {
  const queryClient = useQueryClient();
  const fetchStaff = useServerFn(listStaff);
  const callLevel = useServerFn(setStaffLevel);
  const callStatus = useServerFn(setStaffStatus);
  const callInvite = useServerFn(inviteStaff);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteLevel, setInviteLevel] = useState<"owner" | "collaborator" | "reader">("reader");

  const { data, error, isLoading } = useQuery({ queryKey: ["admin-staff"], queryFn: fetchStaff });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-staff"] });

  const changeLevel = useMutation({
    mutationFn: (input: { user_id: string; level: "owner" | "collaborator" | "reader" }) =>
      callLevel({ data: input }),
    onSuccess: async () => {
      toast.success("Level updated.");
      await refresh();
    },
    onError: (e) => toast.error(friendlyError(e, "The level was not changed.")),
  });

  const changeStatus = useMutation({
    mutationFn: (input: { user_id: string; status: "active" | "inactive" }) =>
      callStatus({ data: input }),
    onSuccess: async () => {
      toast.success("Status updated.");
      await refresh();
    },
    onError: (e) => toast.error(friendlyError(e, "The status was not changed.")),
  });

  // Platform default margin — owners only, prefills every new quote variant.
  const fetchMargin = useServerFn(getDefaultMarginPct);
  const callSetMargin = useServerFn(setDefaultMarginPct);
  const { data: marginData } = useQuery({
    queryKey: ["default-margin-pct"],
    queryFn: fetchMargin,
  });
  const [marginInput, setMarginInput] = useState<string>("");
  useEffect(() => {
    if (marginData && marginInput === "") setMarginInput(String(marginData.margin_pct));
  }, [marginData, marginInput]);

  const saveMargin = useMutation({
    mutationFn: (margin_pct: number) => callSetMargin({ data: { margin_pct } }),
    onSuccess: async (r) => {
      toast.success(`Default margin set to ${r.margin_pct}%.`);
      await queryClient.invalidateQueries({ queryKey: ["default-margin-pct"] });
    },
    onError: (e) => toast.error(friendlyError(e, "The default margin was not changed.")),
  });

  const invite = useMutation({
    mutationFn: () =>
      callInvite({ data: { email: email.trim().toLowerCase(), level: inviteLevel } }),
    onSuccess: async (r) => {
      toast.success(`Invitation sent to ${r.email}.`);
      setInviteOpen(false);
      setEmail("");
      setInviteLevel("reader");
      await refresh();
    },
    onError: (e) => toast.error(friendlyError(e, "The invitation was not sent.")),
  });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Team" description="Internal staff and their access levels." />
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Lock className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{friendlyError(error, "Owners only.")}</p>
        </div>
      </div>
    );
  }

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Internal staff for @budigital.org and what each of them may do."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> Invite member
          </Button>
        }
      />

      <PanelHeader
        title="Pricing defaults"
        description="Applies to new quotes and variants. Existing published quotes are untouched."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="default-margin">Default FlySales margin %</Label>
          <Input
            id="default-margin"
            type="number"
            step="0.01"
            min="0"
            className="w-40 tnum"
            value={marginInput}
            onChange={(e) => setMarginInput(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={saveMargin.isPending || marginInput === ""}
          onClick={() => saveMargin.mutate(Number(marginInput))}
        >
          {saveMargin.isPending ? "Saving…" : "Save default"}
        </Button>
      </div>

      <PanelHeader title="Staff" description={`${rows.length} members`} />
      <TableShell>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Level</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={row.user_id}>
              <TableCell className="font-medium">
                {row.email}
                {row.perpetual && (
                  <span className="ml-2 text-xs text-muted-foreground">permanent owner</span>
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={row.level}
                  disabled={row.perpetual || changeLevel.isPending}
                  onValueChange={(value) =>
                    changeLevel.mutate({
                      user_id: row.user_id,
                      level: value as "owner" | "collaborator" | "reader",
                    })
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Chip tone={row.status === "active" ? "success" : "neutral"}>
                  {row.status === "active" ? "Active" : "Deactivated"}
                </Chip>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.last_active_at ? formatDate(row.last_active_at) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={row.perpetual || changeStatus.isPending}
                  onClick={() =>
                    changeStatus.mutate({
                      user_id: row.user_id,
                      status: row.status === "active" ? "inactive" : "active",
                    })
                  }
                >
                  {row.status === "active" ? "Deactivate" : "Reactivate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                No staff yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </TableShell>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>
              Only @budigital.org addresses can join the internal team. They receive a branded email
              to set their password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                type="email"
                placeholder="name@budigital.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Level</Label>
              <Select
                value={inviteLevel}
                onValueChange={(v) => setInviteLevel(v as "owner" | "collaborator" | "reader")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {LEVELS.find((l) => l.value === inviteLevel)?.hint}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!email.trim() || invite.isPending} onClick={() => invite.mutate()}>
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
