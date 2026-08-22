import { z } from "zod";

export const storePlatformSchema = z.enum(["shopify", "woocommerce", "other"]);

const SHOPIFY_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const companyDetailsBase = z.object({
  company_name: z.string().trim().min(2, "Company name is required").max(120),
  contact_name: z.string().trim().min(2, "Contact name is required").max(120),
  phone: z.string().trim().min(5, "Phone is required").max(40),
  country: z.string().trim().min(2, "Country is required").max(80),
  vat_number: z.string().trim().min(4, "VAT number is required").max(40),
  platform: storePlatformSchema,
  store_url: z.string().trim().min(3, "Store URL is required").max(500),
});

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

export const companyDetailsSchema = companyDetailsBase.superRefine(storeUrlMatchesPlatform);

export const signupSchema = companyDetailsBase
  .extend({
    email: z.string().trim().email("Invalid email address").max(255),
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
  })
  .superRefine(storeUrlMatchesPlatform);

export const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255),
  password: z.string().min(1, "Password is required").max(128),
});

export const profileUpdateSchema = companyDetailsSchema;

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
  lines: z.array(quoteLineInputSchema).min(1, "Add at least one variant line").max(50),
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

export const subscriptionPlanSchema = z.object({
  client_id: z.string().uuid(),
  subscription_plan: z.enum(["basic", "unlimited"]),
});

export const feeWaivedSchema = z.object({
  client_id: z.string().uuid(),
  fee_waived: z.boolean(),
});

export const integrationModeSchema = z.object({
  client_id: z.string().uuid(),
  integration_mode: z.enum(["automatic", "manual"]),
});

export const tierOverrideSchema = z.object({
  client_id: z.string().uuid(),
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

export const adminDocumentsFilterSchema = z.object({
  type: documentTypeSchema.optional(),
  clientId: z.string().uuid().optional(),
});
