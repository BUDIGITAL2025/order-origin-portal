import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientIdSchema, walletAdjustmentSchema } from "./schemas";

/** Client: my balance (latest ledger row) + transaction history. RLS scopes to the caller's entity. */
export const getMyWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("wallet_transactions")
      .select("id, type, amount, balance_after, description, reference, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const transactions = data ?? [];
    const latest = transactions[0];
    return {
      balance: latest ? Number(latest.balance_after) : 0,
      transactions,
    };
  });

/**
 * Admin: credit or debit an entity's wallet. All writes go through the
 * apply_wallet_transaction Postgres function — it locks the entity's ledger,
 * computes balance_after, enforces non-negative balance and reference
 * idempotency inside one transaction. The app never inserts ledger rows.
 *
 * NOTE: `client_id` in walletAdjustmentSchema now identifies the *entity*
 * (the wallet lives on the entity, not the account) — the admin picker on
 * /admin/wallet lists entities directly.
 */
export const adminAdjustWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => walletAdjustmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    // The wallet ledger function is no longer executable by signed-in users;
    // admin adjustments go through the service role, which the function allows.
    const admin = await getAdminClient();
    const { data: result, error } = await admin.rpc(
      "apply_wallet_transaction",
      {
        p_entity_id: data.client_id,
        p_type: data.type,
        p_amount: data.amount,
        p_description: data.description,
        ...(data.reference ? { p_reference: data.reference } : {}),
      },
    );
    if (error) throw new Error(error.message);
    return { ok: true, entry: result };
  });

/** Admin: an entity's balance + recent ledger entries. */
export const adminGetWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => clientIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data: rows, error } = await admin
      .from("wallet_transactions")
      .select("id, type, amount, balance_after, description, reference, created_at")
      .eq("entity_id", data.client_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const transactions = rows ?? [];
    const latest = transactions[0];
    return {
      balance: latest ? Number(latest.balance_after) : 0,
      transactions,
    };
  });
