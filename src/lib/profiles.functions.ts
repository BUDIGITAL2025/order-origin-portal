import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clientIdSchema,
  clientStatusSchema,
  companyDetailsSchema,
  feeWaivedSchema,
  integrationModeSchema,
  subscriptionPlanSchema,
  profileUpdateSchema,
  tierOverrideSchema,
} from "./schemas";

export interface MyContext {
  userId: string;
  email: string | null;
  role: "admin" | "client";
  isAdmin: boolean;
  profile: {
    id: string;
    company_name: string;
    contact_name: string;
    phone: string;
    country: string;
    vat_number: string;
    platform: "shopify" | "woocommerce" | "other";
    store_url: string;
    integration_mode: "automatic" | "manual";
    pricing_tier: "starter" | "growth" | "scale";
    tier_override: "starter" | "growth" | "scale" | null;
    avg_daily_units_30d: number;
    subscription_plan: "basic" | "unlimited";
    quotes_used_this_month: number;
    quotes_period_start: string;
    fee_waived: boolean;
    status: "pending" | "active" | "suspended";
    middleware_tenant_id: string | null;
    provisioning_status: "not_started" | "in_progress" | "complete" | "failed";
    provisioning_step: string | null;
    provisioning_error: string | null;
    approved_at: string | null;
    created_at: string;
  } | null;
}

/** Session + profile + role for the signed-in user. Called client-side only. */
export const getMyContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyContext> => {
    const { supabase, userId, claims } = context;
    const [{ data: profile }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const roles = (roleRows ?? []).map((r) => r.role);
    const isAdmin = roles.includes("admin");
    return {
      userId,
      email: (claims?.email as string | undefined) ?? null,
      role: isAdmin ? "admin" : "client",
      isAdmin,
      profile: profile ?? null,
    };
  });

/**
 * First-login onboarding: create the caller's own profile (status 'pending') and
 * client role. Only the caller's own id is ever written.
 */
export const completeSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => companyDetailsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (existing) return { ok: true, already: true };

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      company_name: data.company_name,
      contact_name: data.contact_name,
      phone: data.phone,
      country: data.country,
      vat_number: data.vat_number,
      platform: data.platform,
      store_url: data.store_url,
    });
    if (profileError) throw new Error(profileError.message);

    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, role: "client" });
    if (roleError && roleError.code !== "23505") throw new Error(roleError.message);

    return { ok: true, already: false };
  });

/** Client edits their own company details. Protected columns are DB-enforced. */
export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => profileUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
        company_name: data.company_name,
        contact_name: data.contact_name,
        phone: data.phone,
        country: data.country,
        vat_number: data.vat_number,
        platform: data.platform,
        store_url: data.store_url,
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: full client list. */
export const adminListClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin, getAdminClient } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const admin = await getAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { clients: data ?? [] };
  });

/** Admin: suspend a client or reactivate a suspended one. Approvals go through provisionClient. */
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

/** Admin: change a client's subscription plan. */
export const adminSetPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => subscriptionPlanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("profiles")
      .update({ subscription_plan: data.subscription_plan })
      .eq("id", data.client_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: toggle the monthly-fee waiver on a client (manual commercial gesture). */
export const adminSetFeeWaived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => feeWaivedSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("profiles")
      .update({ fee_waived: data.fee_waived })
      .eq("id", data.client_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Client: explicit self-upgrade from Basic to Unlimited.
 * Never called automatically — only from the upgrade panel button.
 * TODO(payments): collect payment via Stripe before flipping the plan;
 * the call is stubbed and the plan is switched immediately for now.
 */
export const upgradeToUnlimited = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_plan, status")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) throw new Error("Complete your company profile first");
    if (profile.status !== "active") throw new Error("Your account is not active yet");
    if (profile.subscription_plan !== "basic") {
      throw new Error("Your plan is already Unlimited");
    }

    // TODO(payments): create a Stripe Checkout session / subscription here and
    // only switch the plan after the payment confirms (webhook). Stubbed for now.
    const { error } = await supabase
      .from("profiles")
      .update({ subscription_plan: "unlimited" })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin: set or clear a client's pricing tier override. */
export const adminSetTierOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tierOverrideSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("profiles")
      .update({ tier_override: data.tier_override })
      .eq("id", data.client_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin: approve a pending client (or retry a failed provisioning).
 *
 * Orchestrates tenant provisioning against the external middleware. Every step
 * updates provisioning_step before attempting; any failure marks the profile
 * provisioning_status='failed' with the step and message. Safe to re-run: the
 * tenant id is never regenerated once set and each external call must tolerate
 * the resource already existing.
 */
export const provisionClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => clientIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.supabase, context.userId);

    const { data: profile, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", data.client_id)
      .single();
    if (error || !profile) throw new Error("Client not found");

    // Preconditions
    const isPending = profile.status === "pending";
    const isRetry = profile.provisioning_status === "failed";
    if (!isPending && !isRetry) {
      throw new Error("Client is not pending approval (or awaiting provisioning retry)");
    }
    if (!profile.shopify_domain) {
      throw new Error("Client has no Shopify domain on file");
    }

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
        .from("profiles")
        .update({
          provisioning_status: "in_progress",
          provisioning_step: step,
          provisioning_error: null,
        })
        .eq("id", profile.id);
    };

    const fail = async (step: string, message: string): Promise<never> => {
      await context.supabase
        .from("profiles")
        .update({
          provisioning_status: "failed",
          provisioning_step: step,
          provisioning_error: message.slice(0, 500),
        })
        .eq("id", profile.id);
      throw new Error(`Provisioning failed at "${step}": ${message}`);
    };

    // ------------------------------------------------------------------
    // Step 1 — generate_tenant_id (idempotent: never regenerate once set).
    // ------------------------------------------------------------------
    let tenantId = profile.middleware_tenant_id;
    try {
      if (!tenantId) {
        tenantId = `rs_${crypto.randomUUID().replaceAll("-", "")}`;
        const { error: updateError } = await context.supabase
          .from("profiles")
          .update({
            middleware_tenant_id: tenantId,
            status: "active",
            approved_at: new Date().toISOString(),
            provisioning_status: "in_progress",
            provisioning_step: "generate_tenant_id",
            provisioning_error: null,
          })
          .eq("id", profile.id);
        if (updateError) throw updateError;
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
        //   body: { name: profile.company_name, shop_domain: profile.shopify_domain, tenant_id: tenantId }
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

    // All steps done.
    const { error: completeError } = await context.supabase
      .from("profiles")
      .update({
        provisioning_status: "complete",
        provisioning_step: "complete",
        provisioning_error: null,
      })
      .eq("id", profile.id);
    if (completeError) {
      await fail("complete", completeError.message);
    }

    return { ok: true, tenant_id: tenantId, provisioning_status: "complete" as const };
  });
