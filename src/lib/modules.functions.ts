/**
 * Paid module activation — client-callable server functions.
 *
 * Same shape as the SpyMarket module: its own Stripe subscription, its own
 * row, no effect on the workspace plan or quota. The webhook is the only
 * writer of the activation row.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MODULE_PRICE_IDS } from "./price-ids";

const environmentSchema = z.enum(["sandbox", "live"]);
const moduleKeySchema = z.enum(["fulfilment"]);

const listSchema = z.object({
  storeId: z.string().uuid(),
  environment: environmentSchema,
});

const checkoutSchema = z.object({
  storeId: z.string().uuid(),
  moduleKey: moduleKeySchema,
  environment: environmentSchema,
  returnUrl: z.string().url(),
});

/** Which paid modules this workspace currently holds. */
export const getMyWorkspaceModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { listWorkspaceModules } = await import("./modules.server");
    // RLS on workspace_modules already scopes the read to the caller's stores.
    const rows = await listWorkspaceModules(context.supabase, data.storeId, data.environment);
    return {
      modules: rows,
      keys: rows.map((r) => r.module_key),
    };
  });

/** Start Stripe Checkout for one module on one workspace. */
export const createModuleCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => checkoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createStripeClient, getStripeErrorMessage } = await import("./stripe.server");
    try {
      const billing = await import("./billing.server");
      const { getAdminClient } = await import("./admin.server");
      const { hasModule } = await import("./modules.server");
      const admin = await getAdminClient();

      // The workspace must belong to the caller.
      const { data: store } = await admin
        .from("stores")
        .select("id, entity_id, entities!inner(id, account_id, stripe_customer_id)")
        .eq("id", data.storeId)
        .maybeSingle();
      const chain = store as unknown as {
        id: string;
        entity_id: string;
        entities: { id: string; account_id: string; stripe_customer_id: string | null };
      } | null;
      if (!chain || chain.entities.account_id !== context.userId) {
        throw new Error("Workspace not found");
      }

      if (await hasModule(admin, data.storeId, data.moduleKey, data.environment)) {
        throw new Error("This module is already active on this workspace.");
      }

      const stripe = createStripeClient(data.environment);
      const email = (context.claims?.["email"] as string | undefined) ?? undefined;
      const customerId = await billing.resolveOrCreateCustomer(stripe, {
        ...(email ? { email } : {}),
        userId: context.userId,
        existingCustomerId: chain.entities.stripe_customer_id,
      });
      if (chain.entities.stripe_customer_id !== customerId) {
        await admin
          .from("entities")
          .update({ stripe_customer_id: customerId })
          .eq("id", chain.entity_id);
      }

      const lookupKey = MODULE_PRICE_IDS[data.moduleKey];
      const prices = await stripe.prices.list({ lookup_keys: [lookupKey] });
      const price = prices.data[0];
      if (!price) throw new Error("Module price not found");

      const metadata = {
        kind: "module_subscription",
        module_key: data.moduleKey,
        flysales_store_id: data.storeId,
        flysales_user_id: context.userId,
      };
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${data.returnUrl}?module=${data.moduleKey}&status=success`,
        cancel_url: `${data.returnUrl}?module=${data.moduleKey}&status=cancel`,
        metadata,
        subscription_data: { metadata },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { url: session.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
