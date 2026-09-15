/**
 * The client selector shared by the Fulfilment section (Products / Orders /
 * Inventory / Inbound) in the admin console and the sourcing desk.
 *
 * The choice is kept in sessionStorage, so it survives moving between the
 * sub-tabs and a reload, and resets to "All" in a new session. Admin sees
 * every workspace; a sourcing collaborator only the ones assigned to them —
 * the server returns nothing else either way.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listFulfilmentWorkspaces } from "@/lib/fulfilment-scope.functions";

const STORAGE_KEY = "flysales:fulfilment-workspace";
const CHANGED_EVENT = "flysales:fulfilment-workspace-changed";

export const ALL_WORKSPACES = "all";

function read(): string {
  if (typeof window === "undefined") return ALL_WORKSPACES;
  return window.sessionStorage.getItem(STORAGE_KEY) ?? ALL_WORKSPACES;
}

/**
 * The workspace currently selected in the Fulfilment section — `"all"` means
 * no filter. Every sub-tab reads the same value.
 */
export function useWorkspaceScope(): [string, (id: string) => void] {
  const [value, setValue] = useState<string>(ALL_WORKSPACES);

  useEffect(() => {
    setValue(read());
    const sync = () => setValue(read());
    window.addEventListener(CHANGED_EVENT, sync);
    return () => window.removeEventListener(CHANGED_EVENT, sync);
  }, []);

  const set = (id: string) => {
    window.sessionStorage.setItem(STORAGE_KEY, id);
    window.dispatchEvent(new Event(CHANGED_EVENT));
    setValue(id);
  };

  return [value, set];
}

/** The workspaces the caller may see, plus whether they are staff. */
function useFulfilmentWorkspaces() {
  const fetchWorkspaces = useServerFn(listFulfilmentWorkspaces);
  return useQuery({
    queryKey: ["fulfilment-workspaces"],
    staleTime: 60_000,
    queryFn: () => fetchWorkspaces(),
  });
}

/**
 * True for internal staff. Sourcing collaborators share these pages read-only,
 * so admin-only actions are hidden for them (and refused server-side anyway).
 */
export function useFulfilmentIsAdmin(): boolean {
  const { data } = useFulfilmentWorkspaces();
  return data?.isAdmin ?? false;
}

/** Dropdown placed above the Fulfilment sub-tabs. */
export function WorkspacePicker() {
  const [value, setValue] = useWorkspaceScope();
  const { data } = useFulfilmentWorkspaces();

  const workspaces = data?.workspaces ?? [];
  const isAdmin = data?.isAdmin ?? true;

  // A stale selection (workspace no longer listed) falls back to "All".
  useEffect(() => {
    if (!data) return;
    if (value !== ALL_WORKSPACES && !workspaces.some((w) => w.id === value)) {
      setValue(ALL_WORKSPACES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Client
      </span>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-8 w-64 bg-background text-xs">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_WORKSPACES} className="text-xs">
            {isAdmin ? "All clients" : "All my clients"}
          </SelectItem>
          {workspaces.map((w) => (
            <SelectItem key={w.id} value={w.id} className="text-xs">
              {w.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
