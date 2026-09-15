/**
 * Named client identity for the sourcing desk — the ONLY place a client name
 * is resolved for an agent.
 *
 * An agent may know WHO they work for (company name + the contact person's
 * first name) so the relationship feels real. They may never know how to
 * reach them: email, phone, addresses, store URL, fiscal/legal details,
 * wallet or billing data are never selected here, so they cannot leak from
 * any desk endpoint, including a direct API call.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export type ClientIdentity = {
  entity_id: string | null;
  /** Legal name of the client company, falling back to the workspace name. */
  company: string;
  /** First name only — never the full contact record. */
  contact_first_name: string | null;
};

function firstName(full: string | null | undefined): string | null {
  const clean = (full ?? "").trim();
  if (!clean) return null;
  return clean.split(/\s+/)[0] ?? null;
}

function fallback(entityId: string | null): ClientIdentity {
  return {
    entity_id: entityId,
    company: entityId ? `Client #${entityId.slice(0, 4).toUpperCase()}` : "Client",
    contact_first_name: null,
  };
}

/** Identity card per store id. Stores we cannot resolve get a neutral handle. */
export async function clientIdentityByStore(
  admin: Admin,
  storeIds: Array<string | null | undefined>,
): Promise<Map<string, ClientIdentity>> {
  const ids = [...new Set(storeIds.filter((s): s is string => !!s))];
  const out = new Map<string, ClientIdentity>();
  if (!ids.length) return out;

  const { data: stores } = await admin
    .from("stores")
    .select("id, store_name, entity_id")
    .in("id", ids);

  const entityIds = [
    ...new Set((stores ?? []).map((s) => s.entity_id).filter(Boolean)),
  ] as string[];
  const { data: entities } = entityIds.length
    ? await admin.from("entities").select("id, legal_name, account_id").in("id", entityIds)
    : { data: [] as Array<{ id: string; legal_name: string | null; account_id: string | null }> };

  const accountIds = [
    ...new Set((entities ?? []).map((e) => e.account_id).filter(Boolean)),
  ] as string[];
  const { data: profiles } = accountIds.length
    ? await admin.from("profiles").select("id, contact_name").in("id", accountIds)
    : { data: [] as Array<{ id: string; contact_name: string | null }> };

  const contactByAccount = new Map((profiles ?? []).map((p) => [p.id, p.contact_name]));
  const entityById = new Map((entities ?? []).map((e) => [e.id, e]));

  for (const s of stores ?? []) {
    const entity = s.entity_id ? entityById.get(s.entity_id) : undefined;
    const company = (entity?.legal_name ?? "").trim() || (s.store_name ?? "").trim();
    out.set(s.id, {
      entity_id: s.entity_id ?? null,
      company: company || fallback(s.entity_id ?? null).company,
      contact_first_name: firstName(
        entity?.account_id ? contactByAccount.get(entity.account_id) : null,
      ),
    });
  }
  return out;
}

/** Identity card for a single store. */
export async function clientIdentityForStore(
  admin: Admin,
  storeId: string | null | undefined,
): Promise<ClientIdentity> {
  if (!storeId) return fallback(null);
  const map = await clientIdentityByStore(admin, [storeId]);
  return map.get(storeId) ?? fallback(null);
}

/** Identity card per entity id (tier rows are keyed by entity, not store). */
export async function clientIdentityByEntity(
  admin: Admin,
  entityIds: Array<string | null | undefined>,
): Promise<Map<string, ClientIdentity>> {
  const ids = [...new Set(entityIds.filter((e): e is string => !!e))];
  const out = new Map<string, ClientIdentity>();
  if (!ids.length) return out;

  const { data: entities } = await admin
    .from("entities")
    .select("id, legal_name, account_id")
    .in("id", ids);
  const accountIds = [
    ...new Set((entities ?? []).map((e) => e.account_id).filter(Boolean)),
  ] as string[];
  const { data: profiles } = accountIds.length
    ? await admin.from("profiles").select("id, contact_name").in("id", accountIds)
    : { data: [] as Array<{ id: string; contact_name: string | null }> };
  const contactByAccount = new Map((profiles ?? []).map((p) => [p.id, p.contact_name]));

  // A company with no legal name yet still needs a label: use its workspace.
  const { data: stores } = await admin
    .from("stores")
    .select("entity_id, store_name")
    .in("entity_id", ids);
  const storeNameByEntity = new Map(
    (stores ?? []).map((s) => [s.entity_id as string, s.store_name as string | null]),
  );

  for (const e of entities ?? []) {
    const company = (e.legal_name ?? "").trim() || (storeNameByEntity.get(e.id) ?? "").trim();
    out.set(e.id, {
      entity_id: e.id,
      company: company || fallback(e.id).company,
      contact_first_name: firstName(e.account_id ? contactByAccount.get(e.account_id) : null),
    });
  }
  for (const id of ids) if (!out.has(id)) out.set(id, fallback(id));
  return out;
}

/** "Gato Preto · Rita" — one line for headers and tables. */
export function clientDisplay(identity: ClientIdentity | null | undefined): string {
  if (!identity) return "Client";
  return identity.contact_first_name
    ? `${identity.company} · ${identity.contact_first_name}`
    : identity.company;
}
