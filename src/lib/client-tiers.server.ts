/**
 * Per-agent, per-client fee tiers.
 *
 * The sourcing fee falls as an agent delivers volume TO ONE CLIENT ACCOUNT:
 * 8% on the first 500 paid units for that client, 5% for units 501–1000, 3%
 * from 1001 on, forever for that client. A new client starts the agent back
 * at 8%. Units of every product and variant the agent sourced for that client
 * feed the same counter.
 *
 * The counter moves when a purchase's payment settles — exactly the same
 * anchor as the earnings ledger — and the rate is frozen onto the quote at
 * quoting time, so an accepted price never moves.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  parseFeeTiers,
  rateForCount,
  tierProgress,
  type FeeTier,
  type TierProgress,
} from "./fee-tiers";

type Admin = SupabaseClient<Database>;

export type ClientTierRow = {
  entity_id: string;
  paid_units: number;
  fee_tiers: unknown;
};

/** Short, client-identity-safe handle an agent can quote on a call. */
export function clientHandle(entityId: string): string {
  return `Client #${entityId.slice(0, 4).toUpperCase()}`;
}

async function readRow(
  admin: Admin,
  agentUserId: string,
  entityId: string,
): Promise<ClientTierRow | null> {
  const { data } = await admin
    .from("sourcing_client_tiers")
    .select("entity_id, paid_units, fee_tiers")
    .eq("collaborator_user_id", agentUserId)
    .eq("entity_id", entityId)
    .maybeSingle();
  return (data as ClientTierRow | null) ?? null;
}

/** Tiers for this pair: the negotiated exception when set, else the agent's own table. */
function tiersFor(row: ClientTierRow | null, agentTiers: unknown): FeeTier[] {
  if (row?.fee_tiers) return parseFeeTiers(row.fee_tiers);
  return parseFeeTiers(agentTiers);
}

/** The rate this agent's NEXT quote for this client carries. */
export async function clientFeeRate(
  admin: Admin,
  agentUserId: string,
  entityId: string,
  agentTiers: unknown,
): Promise<number> {
  const row = await readRow(admin, agentUserId, entityId);
  return rateForCount(tiersFor(row, agentTiers), Number(row?.paid_units ?? 0));
}

export async function clientTierProgress(
  admin: Admin,
  agentUserId: string,
  entityId: string,
  agentTiers: unknown,
): Promise<TierProgress> {
  const row = await readRow(admin, agentUserId, entityId);
  return tierProgress(tiersFor(row, agentTiers), Number(row?.paid_units ?? 0));
}

/** Every client relationship of one agent, richest first. */
export async function listAgentClientTiers(
  admin: Admin,
  agentUserId: string,
  agentTiers: unknown,
): Promise<
  Array<{
    entity_id: string;
    handle: string;
    contact_first_name: string | null;
    units: number;
    tier: TierProgress;
  }>
> {
  const { data } = await admin
    .from("sourcing_client_tiers")
    .select("entity_id, paid_units, fee_tiers")
    .eq("collaborator_user_id", agentUserId)
    .order("paid_units", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as ClientTierRow[];
  // Named clients: company + contact first name only, never a contact channel.
  const { clientIdentityByEntity } = await import("./client-identity.server");
  const identities = await clientIdentityByEntity(
    admin,
    rows.map((r) => r.entity_id),
  );
  return rows.map((row) => {
    const identity = identities.get(row.entity_id);
    return {
      entity_id: row.entity_id,
      handle: identity?.company ?? clientHandle(row.entity_id),
      contact_first_name: identity?.contact_first_name ?? null,
      units: Number(row.paid_units ?? 0),
      tier: tierProgress(tiersFor(row, agentTiers), Number(row.paid_units ?? 0)),
    };
  });
}

/**
 * Add settled units to the pair's counter. Called once per settled payment,
 * right where the commission is accrued, so counter and ledger always agree.
 */
export async function bumpClientUnits(
  admin: Admin,
  agentUserId: string,
  entityId: string,
  units: number,
): Promise<void> {
  if (!Number.isFinite(units) || units <= 0) return;
  const row = await readRow(admin, agentUserId, entityId);
  if (!row) {
    await admin
      .from("sourcing_client_tiers")
      .insert({ collaborator_user_id: agentUserId, entity_id: entityId, paid_units: units });
    return;
  }
  await admin
    .from("sourcing_client_tiers")
    .update({ paid_units: Number(row.paid_units ?? 0) + units })
    .eq("collaborator_user_id", agentUserId)
    .eq("entity_id", entityId);
}

/** The client account behind a quote request, for tier lookups. */
export async function entityForQuote(admin: Admin, quoteId: string): Promise<string | null> {
  const { data } = await admin
    .from("quote_requests")
    .select("store_id, stores(entity_id)")
    .eq("id", quoteId)
    .maybeSingle();
  const chain = data as unknown as { stores?: { entity_id: string } | null } | null;
  return chain?.stores?.entity_id ?? null;
}
