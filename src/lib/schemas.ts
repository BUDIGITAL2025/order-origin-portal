import { z } from "zod";

export const storePlatformSchema = z.enum(["shopify", "woocommerce", "other"]);

const SHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const storeUrlMatchesPlatform = (
  val: { platform: "shopify" | "woocommerce" | "other"; store_url: string },
  ctx: z.RefinementCtx,
) => {
  if (val.platform === "shopify" && !SHOPIFY_DOMAIN_RE.test(val.store_url.toLowerCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["store_url"],
      message: "Must be a valid *.myshopify.com domain (e.g. your-store.myshopify.com)",
    });
  }
};

// Password rule, deliberately simple: 8+ characters with at least one
// uppercase letter and one symbol. Used by signup and password reset.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Z]/, "Password needs at least one uppercase letter")
  .regex(/[^A-Za-z0-9]/, "Password needs at least one symbol (e.g. ! @ # $)");

// Signup collects the account and the entity's basics only — no store at
// this step. The entity's legal name defaults to the contact name; fiscal
// fields are completed later from the billing page.
export const signupSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255),
  password: passwordSchema,
  contact_name: z.string().trim().min(2, "Contact name is required").max(120),
  phone: z.string().trim().min(5, "Phone is required").max(40),
  country: z.string().trim().min(2, "Country is required").max(80),
});

export const completeSignupSchema = signupSchema.omit({ email: true, password: true });

// Stores are added after signup — the *.myshopify.com rule applies here,
// not at signup.
const addStoreBase = z.object({
  platform: storePlatformSchema,
  store_url: z.string().trim().min(3, "Store URL is required").max(500),
  store_name: z.string().trim().max(120).optional().or(z.literal("")),
});
export const addStoreSchema = addStoreBase.superRefine(storeUrlMatchesPlatform);

// Connecting a draft store is Shopify-only: the *.myshopify.com rule applies.
export const connectDraftStoreSchema = z.object({
  store_id: z.string().uuid(),
  store_url: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SHOPIFY_DOMAIN_RE, "Must be a valid *.myshopify.com domain (e.g. your-store.myshopify.com)"),
  store_name: z.string().trim().max(120).optional().or(z.literal("")),
});

// Entity fiscal details — completed by the client after signup.
export const entityDetailsSchema = z.object({
  entity_id: z.string().uuid(),
  legal_name: z.string().trim().min(2, "Legal name is required").max(160),
  country: z.string().trim().min(2, "Country is required").max(80),
  vat_number: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255),
  password: z.string().min(1, "Password is required").max(128),
});

// Account-level profile edits only — company/store details live on
// entities/stores and are managed by the admin team.
export const profileUpdateSchema = z.object({
  contact_name: z.string().trim().min(2, "Contact name is required").max(120),
  phone: z.string().trim().min(5, "Phone is required").max(40),
});

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter country code (e.g. US)");

export const quoteRequestSchema = z.object({
  product_url: z.string().trim().url("Must be a valid URL").max(2000),
  product_name: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  target_monthly_volume: z.number().int().min(1).max(1_000_000).nullable().optional(),
  image_urls: z.array(z.string().max(500)).max(10).optional(),
  target_countries: z.array(countryCodeSchema).min(1, "Pick at least one target country").max(30),
});

export const quoteLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  variant_label: z.string().trim().min(1, "Every variant needs a label").max(120),
  country_code: countryCodeSchema,
  supplier_cogs: z.number().min(0).max(1_000_000),
  supplier_shipping: z.number().min(0).max(1_000_000),
  supplier_tax: z.number().min(0).max(1_000_000),
  markup_product: z.number().min(0).max(1_000_000),
  markup_shipping: z.number().min(0).max(1_000_000),
  moq: z.number().int().min(1).max(1_000_000).nullable().optional(),
  lead_time_days: z.number().int().min(0).max(365).nullable().optional(),
});

export const adminQuoteLinesSchema = z.object({
  quote_id: z.string().uuid(),
  lines: z.array(quoteLineInputSchema).min(1, "Add at least one variant line").max(200),
  internal_reference: z.string().trim().max(120).optional().or(z.literal("")),
  quote_valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable()
    .optional(),
  admin_notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const respondLinesSchema = z.object({
  quote_id: z.string().uuid(),
  product_name: z.string().trim().max(200).optional().or(z.literal("")),
  decisions: z
    .array(
      z.object({
        line_id: z.string().uuid(),
        accept: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

export const requoteSchema = z.object({
  quote_id: z.string().uuid(),
});

export const adminQuoteStatusSchema = z.object({
  quote_id: z.string().uuid(),
  status: z.enum(["submitted", "sourcing", "expired"]),
});

export const bundleComponentSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10_000),
});

export const createBundleSchema = z.object({
  name: z.string().trim().min(2, "Bundle name is required").max(200),
  components: z
    .array(bundleComponentSchema)
    .min(1, "Add at least one component")
    .max(50),
});

export const updateBundleSchema = createBundleSchema.extend({
  bundle_id: z.string().uuid(),
});

export const productIdSchema = z.object({
  product_id: z.string().uuid(),
});

export const priceOverrideSchema = z.object({
  product_id: z.string().uuid(),
  price_override: z.number().min(0).max(1_000_000).nullable(),
});

export const adminProductStatusSchema = z.object({
  product_id: z.string().uuid(),
  status: z.enum(["active", "discontinued"]),
});

export const walletAdjustmentSchema = z.object({
  client_id: z.string().uuid(),
  type: z.enum(["credit", "debit"]),
  amount: z.number().positive("Amount must be greater than zero").max(1_000_000),
  description: z.string().trim().min(2, "Description is required").max(500),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
});

export const clientIdSchema = z.object({
  client_id: z.string().uuid(),
});

export const storeIdSchema = z.object({
  store_id: z.string().uuid(),
});

export const subscriptionPlanSchema = z.object({
  store_id: z.string().uuid(),
  subscription_plan: z.enum(["basic", "unlimited"]),
});

export const feeWaivedSchema = z.object({
  store_id: z.string().uuid(),
  fee_waived: z.boolean(),
});

export const integrationModeSchema = z.object({
  store_id: z.string().uuid(),
  integration_mode: z.enum(["automatic", "manual"]),
});

export const tierOverrideSchema = z.object({
  store_id: z.string().uuid(),
  tier_override: z.enum(["starter", "growth", "scale"]).nullable(),
});

export const clientStatusSchema = z.object({
  client_id: z.string().uuid(),
  status: z.enum(["active", "suspended"]),
});

export const signedUrlsSchema = z.object({
  paths: z.array(z.string().min(1).max(500)).max(20),
});

// ============= Billing (Stripe) =============

export const stripeEnvSchema = z.enum(["sandbox", "live"]);

export const subscriptionCheckoutSchema = z.object({
  plan: z.enum(["basic", "unlimited"]),
  returnUrl: z.string().trim().url("Invalid return URL").max(500),
  environment: stripeEnvSchema,
});

export const topUpCheckoutSchema = z.object({
  amountUsd: z.number().min(50, "Minimum top-up is $50").max(100_000),
  returnUrl: z.string().trim().url("Invalid return URL").max(500),
  environment: stripeEnvSchema,
});

export const changePlanSchema = z.object({
  plan: z.enum(["basic", "unlimited"]),
  environment: stripeEnvSchema,
});

export const autoTopupSettingsSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().min(0).max(1_000_000).nullable(),
  amount: z.number().min(50, "Minimum auto top-up is $50").max(100_000).nullable(),
});

export const notificationIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

// ============= Payment receipts (documents) =============

export const documentTypeSchema = z.enum(["order_receipt", "wallet_topup", "subscription"]);

export const documentIdSchema = z.object({
  id: z.string().uuid(),
});

// ============= Batch order payment =============

export const batchOrderIdsSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1, "Select at least one order").max(100),
});

export const batchOrderCheckoutSchema = batchOrderIdsSchema.extend({
  returnUrl: z.string().trim().url("Invalid return URL").max(500),
  environment: stripeEnvSchema,
});

// ============= Disputes =============

export const disputeReasonSchema = z.enum(["not_delivered", "damaged", "wrong_product"]);

export const openDisputeSchema = z.object({
  order_id: z.string().uuid(),
  reason: disputeReasonSchema,
  description: z.string().trim().min(10, "Describe what happened").max(2000),
  evidence_urls: z.array(z.string().min(1).max(500)).max(10).optional(),
});

export const disputeMessageSchema = z.object({
  dispute_id: z.string().uuid(),
  body: z.string().trim().min(1, "Message is required").max(2000),
});

export const disputeIdSchema = z.object({
  dispute_id: z.string().uuid(),
});

export const resolveDisputeSchema = z.object({
  dispute_id: z.string().uuid(),
  resolution: z.enum(["wallet_credit", "reshipped", "rejected"]),
  credit_amount: z.number().positive().max(1_000_000).nullable().optional(),
  admin_notes: z.string().trim().max(2000).optional(),
  client_message: z.string().trim().max(2000).optional(),
});

export const adminDisputeFilterSchema = z.object({
  status: z.enum(["open", "investigating", "approved", "rejected", "closed"]).optional(),
});

export const adminDocumentsFilterSchema = z.object({
  type: documentTypeSchema.optional(),
  clientId: z.string().uuid().optional(),
});
