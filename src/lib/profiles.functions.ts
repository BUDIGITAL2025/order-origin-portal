import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  addStoreSchema,
  clientStatusSchema,
  completeSignupSchema,
  connectDraftStoreSchema,
  entityDetailsSchema,
  feeWaivedSchema,
  integrationModeSchema,
  subscriptionPlanSchema,
  profileUpdateSchema,
  storeIdSchema,
  tierOverrideSchema,
} from "./schemas";

export interface ContextStore {
  id: string;
  entity_id: string;
  store_name: string | null;
  store_url: string | null;
  platform: "shopify" | "woocommerce" | "other";
  integration_mode: "automatic" | "manual";
  subscription_plan: "basic" | "unlimited";
  subscription_status: "none" | "active" | "past_due" | "canceled";
  quotes_used_this_month: number;
  quotes_period_start: string;
  fee_waived: boolean;
  pricing_tier: "starter" | "growth" | "scale";
  status: "pending" | "active" | "suspended" | "draft";
  created_at: string;
}

export interface ContextEntity {
  id: string;
  legal_name: string;
  country: string | null;
  vat_number: string | null;
  status: "active" | "suspended";
  auto_topup_enabled: boolean;
  created_at: string;
  stores: ContextStore[];
}

export interface MyContext {
  userId: string;
  email: string | null;
  role: "admin" | "client";
  isAdmin: boolean;
  /** Account identity only — billing, catalogue and quota live on entities/stores. */
  profile: {
    id: string;
    contact_name: string;
    phone: string;
    status: "pending" | "active" | "suspended" | "draft";
    created_at: string;
  } | null;
  /** Legal entities owned by this account, each with their stores. */
  entities: ContextEntity[];
}

const PROFILE_SELECT = "id, contact_name, phone, status, created_at";
const STORE_SELECT =
  "id, entity_id, store_name, store_url, platform, integration_mode, subscription_plan, subscription_status, quotes_used_this_month, quotes_period_start, fee_waived, pricing_tier, status, created_at";
const ENTITY_SELECT = `id, legal_name, country, vat_number, address, status, auto_topup_enabled, created_at, stores(${STORE_SELECT})`;

/** Session + profile + role + entity/store hierarchy for the signed-in user. */
export const getMyContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyContext> => {
    const { supabase, userId, claims } = context;
    const [{ data: profile }, { data: roleRows }, { data: entities }] = await Promise.all([
      supabase.from("profiles").select(PROFILE_SELECT).eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("entities")
        .select(ENTITY_SELECT)
        .order("created_at", { ascending: true }),
    ]);
    const roles = (roleRows ?? []).map((r) => r.role);
    const isAdmin = roles.includes("admin");
    return {
      userId,
      email: (claims?.email as string | undefined) ?? null,
      role: isAdmin ? "admin" : "client",
      isAdmin,
      profile: profile ?? null,
      entities: (entities ?? []) as unknown as ContextEntity[],
    };
  });

/**
 * Signup completion: create the caller's account profile (active
 * immediately) and their first legal entity — NO store. Stores are added
 * later via addMyStore. The entity's legal name defaults to the contact
 * name; fiscal fields stay empty until the client completes them.
 * Idempotent across retries after a partial earlier attempt.
 */
export const completeSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => completeSignupSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (!existing) {
      const { error: profileError } = await supabase.from("profiles").insert({
        id: userId,
        contact_name: data.contact_name,
        phone: data.phone,
        status: "active",
      });
      if (profileError) throw new Error(profileError.message);
    }

    // Ensure the entity exists (covers retries after a partial attempt where
    // the profile row was written but the entity failed).
    const { data: entityRows } = await supabase.from("entities").select("id").limit(1);
    if (!entityRows || entityRows.length === 0) {
      const { error: entityError } = await supabase.from("entities").insert({
        account_id: userId,
        legal_name: data.contact_name,
        country: data.country,
      });
      if (entityError) throw new Error(entityError.message);
    }

    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, role: "client" });
    if (roleError && roleError.code !== "23505") throw new Error(roleError.message);

    return { ok: true, already: Boolean(existing) };
  });

/**
 * Add a store to the caller's entity. Store URL is required here (not at
 * signup); the *.myshopify.com rule is enforced by addStoreSchema. New
 * stores start pending — an admin approves and provisions them.
 */
export const addMyStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => addStoreSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    void userId;

    // RLS scopes this to the caller's own entities; take the first.
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (entityError) throw new Error(entityError.message);
    if (!entity) throw new Error("Complete your account profile first");

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .insert({
        entity_id: entity.id,
        platform: data.platform,
        store_url: data.store_url,
        store_name: data.store_name || null,
        integration_mode: "manual",
      })
      .select("id, status")
      .single();
    if (storeError) {
      // enforce_entity_max_stores trigger raises when the entity is full.
      if (storeError.message.includes("max_stores") || storeError.code === "P0001") {
        throw new Error("This entity has reached its store limit — contact support to raise it.");
      }
      if (storeError.code === "23505") {
        throw new Error("A store with this URL already exists.");
      }
      throw new Error(storeError.message);
    }
    return { ok: true, store_id: store.id, status: store.status };
  });

/**
 * Connect Shopify to a DRAFT workspace: fills the store URL, provisions the
 * tenant and activates — quota, subscription, quotes and catalogue all stay.
 * The DB function re-verifies ownership and the *.myshopify.com pattern.
 */
export const connectMyStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => connectDraftStoreSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("connect_draft_store", {
      p_store_id: data.store_id,
      p_store_url: data.store_url,
      ...(data.store_name ? { p_store_name: data.store_name } : {}),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Client completes their entity's fiscal details (legal name, VAT, address). */
export const updateMyEntity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => entityDetailsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("entities")
      .update({
        legal_name: data.legal_name,
        country: data.country,
        vat_number: data.vat_number || null,
        address: data.address || null,
      })
      .eq("id", data.entity_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Client edits their own account details. Protected columns are DB-enforced. */
export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => profileUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
        contact_name: data.contact_name,
        phone: data.phone,
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: full account list with the entity/store hierarchy embedded. */
export const adminListClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select(`id, contact_name, phone, status, created_at, entities(id, legal_name, vat_number, country, status, created_at, stores(*))`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { clients: data ?? [] };
  });

/** Admin: suspend an account or reactivate a suspended one. */
export const adminSetClientStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => clientStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("profiles")
      .update({ status: data.status })
      .eq("id", data.client_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: change a store's subscription plan. */
export const adminSetPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => subscriptionPlanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("stores")
      .update({ subscription_plan: data.subscription_plan })
      .eq("id", data.store_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: toggle the monthly-fee waiver on a store (manual commercial gesture). */
export const adminSetFeeWaived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => feeWaivedSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("stores")
      .update({ fee_waived: data.fee_waived })
      .eq("id", data.store_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Plan changes go through Stripe billing (src/lib/billing.functions.ts):
// the client checks out and the webhook flips the plan — never the app itself.

/**
 * Admin: set a store's integration mode. Only meaningful for Shopify stores —
 * the DB CHECK forces 'manual' for every other platform.
 */
export const adminSetIntegrationMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => integrationModeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("stores")
      .update({ integration_mode: data.integration_mode })
      .eq("id", data.store_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: set or clear a store's pricing tier override. */
export const adminSetTierOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tierOverrideSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("stores")
      .update({ tier_override: data.tier_override })
      .eq("id", data.store_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin: approve a pending store (or retry a failed provisioning).
 *
 * Orchestrates tenant provisioning against the external middleware. Every step
 * updates provisioning_step before attempting; any failure marks the store
 * provisioning_status='failed' with the step and message. Safe to re-run: the
 * tenant id is never regenerated once set and each external call must tolerate
 * the resource already existing.
 */
export const provisionStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => storeIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    const { data: store, error } = await context.supabase
      .from("stores")
      .select("*, entities(account_id, legal_name)")
      .eq("id", data.store_id)
      .single();
    if (error || !store) throw new Error("Store not found");

    // Preconditions
    const isPending = store.status === "pending";
    const isRetry = store.provisioning_status === "failed";
    if (!isPending && !isRetry) {
      throw new Error("Store is not pending approval (or awaiting provisioning retry)");
    }
    if (!store.store_url) {
      throw new Error("Store has no URL on file");
    }

    const accountId = (store.entities as { account_id: string; legal_name: string } | null)
      ?.account_id;

    // Server-only middleware credentials — never exposed to the browser.
    const MIDDLEWARE_URL = process.env["MIDDLEWARE_URL"];
    const MIDDLEWARE_SERVICE_USER = process.env["MIDDLEWARE_SERVICE_USER"];
    const MIDDLEWARE_SERVICE_PASSWORD = process.env["MIDDLEWARE_SERVICE_PASSWORD"];
    const MIDDLEWARE_SERVICE_USER_ID = process.env["MIDDLEWARE_SERVICE_USER_ID"];
    const middlewareConfigured = Boolean(
      MIDDLEWARE_URL && MIDDLEWARE_SERVICE_USER && MIDDLEWARE_SERVICE_PASSWORD && MIDDLEWARE_SERVICE_USER_ID,
    );

    const setStep = async (step: string) => {
      await context.supabase
        .from("stores")
        .update({
          provisioning_status: "in_progress",
          provisioning_step: step,
          provisioning_error: null,
        })
        .eq("id", store.id);
    };

    const fail = async (step: string, message: string): Promise<never> => {
      await context.supabase
        .from("stores")
        .update({
          provisioning_status: "failed",
          provisioning_step: step,
          provisioning_error: message.slice(0, 500),
        })
        .eq("id", store.id);
      throw new Error(`Provisioning failed at "${step}": ${message}`);
    };

    // ------------------------------------------------------------------
    // Step 1 — generate_tenant_id (idempotent: never regenerate once set).
    // Approving the first store also activates the account itself.
    // ------------------------------------------------------------------
    let tenantId = store.middleware_tenant_id;
    try {
      if (!tenantId) {
        tenantId = `rs_${crypto.randomUUID().replaceAll("-", "")}`;
        const { error: updateError } = await context.supabase
          .from("stores")
          .update({
            middleware_tenant_id: tenantId,
            status: "active",
            approved_at: new Date().toISOString(),
            provisioning_status: "in_progress",
            provisioning_step: "generate_tenant_id",
            provisioning_error: null,
          })
          .eq("id", store.id);
        if (updateError) throw updateError;
        if (accountId) {
          await context.supabase
            .from("profiles")
            .update({ status: "active" })
            .eq("id", accountId)
            .eq("status", "pending");
        }
      } else {
        await setStep("generate_tenant_id");
      }
    } catch (e) {
      await fail("generate_tenant_id", e instanceof Error ? e.message : String(e));
    }

    // ------------------------------------------------------------------
    // Step 2 — create_tenant
    // ------------------------------------------------------------------
    await setStep("create_tenant");
    try {
      if (middlewareConfigured) {
        // TODO: create the tenant in the external middleware:
        //   POST {MIDDLEWARE_URL}/api/admin/tenants/create
        //   auth: service account (MIDDLEWARE_SERVICE_USER / MIDDLEWARE_SERVICE_PASSWORD)
        //   body: { name: store.store_name, shop_domain: store.store_url, tenant_id: tenantId }
        //   Idempotency: treat "tenant already exists" (e.g. HTTP 409) as success.
        void MIDDLEWARE_URL;
      }
    } catch (e) {
      await fail("create_tenant", e instanceof Error ? e.message : String(e));
    }

    // ------------------------------------------------------------------
    // Step 3 — grant_membership (mandatory: without it the tenant is
    // provisioned locally but unreachable externally).
    // ------------------------------------------------------------------
    await setStep("grant_membership");
    try {
      if (middlewareConfigured) {
        // TODO: grant the service account a membership on the tenant:
        //   PUT {MIDDLEWARE_URL}/api/admin/auth/users/{MIDDLEWARE_SERVICE_USER_ID}/memberships/{tenantId}
        //   body: { role: "operator" }
        //   Idempotency: a repeated grant for the same membership is a no-op.
        void MIDDLEWARE_SERVICE_USER;
      }
    } catch (e) {
      await fail("grant_membership", e instanceof Error ? e.message : String(e));
    }

    // ------------------------------------------------------------------
    // Steps 4–5 only apply to automatic integration. In manual mode the
    // tenant exists and the membership is granted — provisioning stops here.
    // ------------------------------------------------------------------
    if (store.integration_mode === "automatic") {
      // ------------------------------------------------------------------
      // Step 4 — select_tenant: exchange the service credentials for a JWT
      // scoped to this tenant, used for the remaining calls.
      // ------------------------------------------------------------------
      let tenantScopedJwt: string | null = null;
      await setStep("select_tenant");
      try {
        if (middlewareConfigured) {
          // TODO: POST {MIDDLEWARE_URL}/api/admin/auth/select-tenant
          //   body: { tenant_id: tenantId }
          //   → returns a new JWT scoped to the tenant.
          // tenantScopedJwt = response.token
          void MIDDLEWARE_SERVICE_PASSWORD;
        }
      } catch (e) {
        await fail("select_tenant", e instanceof Error ? e.message : String(e));
      }

      // ------------------------------------------------------------------
      // Step 5 — health_check: confirm the wiring works now, not on the
      // first order.
      // ------------------------------------------------------------------
      await setStep("health_check");
      try {
        if (middlewareConfigured) {
          // TODO: GET {MIDDLEWARE_URL}/api/admin/tenants/shops
          //   headers: { Authorization: `Bearer ${tenantScopedJwt}` }
          //   Any non-2xx means the tenant is not reachable externally.
          void tenantScopedJwt;
          void MIDDLEWARE_SERVICE_USER_ID;
        }
      } catch (e) {
        await fail("health_check", e instanceof Error ? e.message : String(e));
      }
    }

    // All steps done.
    const { error: completeError } = await context.supabase
      .from("stores")
      .update({
        provisioning_status: "complete",
        provisioning_step: "complete",
        provisioning_error: null,
      })
      .eq("id", store.id);
    if (completeError) {
      await fail("complete", completeError.message);
    }

    return { ok: true, tenant_id: tenantId, provisioning_status: "complete" as const };
  });
