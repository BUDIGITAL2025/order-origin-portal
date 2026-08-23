import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMyContext } from "@/routes/_authenticated/_client";

const STORAGE_KEY = "flysales:current-store";

/** Persisted store selection — the scope used by the hierarchy rollout. */
export function getCurrentStoreId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

/**
 * Account → Entity → Store switcher. Reads entities and their stores from
 * the shared my-context query. Stores are grouped under their legal entity.
 */
export function StoreSwitcher() {
  const { data: ctx } = useMyContext();
  const entities = ctx?.entities ?? [];

  const [current, setCurrent] = useState<string | null>(null);

  const allStores = entities.flatMap((e) => e.stores);

  // Restore the persisted choice (or fall back to the first store) after
  // hydration — localStorage is not readable during SSR.
  useEffect(() => {
    const first = allStores[0];
    if (!first) return;
    const stored = getCurrentStoreId();
    const valid = stored && allStores.some((s) => s.id === stored) ? stored : first.id;
    if (stored !== valid) window.localStorage.setItem(STORAGE_KEY, valid);
    setCurrent(valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  if (entities.length === 0 || !current) return null;

  return (
    <Select
      value={current}
      onValueChange={(id) => {
        window.localStorage.setItem(STORAGE_KEY, id);
        setCurrent(id);
      }}
    >
      <SelectTrigger className="h-8 w-full bg-background text-xs">
        <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <SelectValue placeholder="Select a workspace" />
      </SelectTrigger>
      <SelectContent>
        {entities.map((entity) => (
          <SelectGroup key={entity.id}>
            <SelectLabel className="text-[10px] font-semibold uppercase tracking-wide">
              {entity.legal_name}
            </SelectLabel>
            {entity.stores.map((store) => (
              <SelectItem key={store.id} value={store.id} className="text-xs">
                {store.store_name ?? store.store_url}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
