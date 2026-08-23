/**
 * Terms of Service — single source of truth for the current version and the
 * rendered content. Bump TERMS_VERSION when the terms change materially:
 * every profile whose terms_version differs sees the one-time acceptance
 * banner on their next login.
 */
import { LEGAL_ENTITY_NAME } from "./legal-entity";

export const TERMS_VERSION = "2026-08-23";
export const TERMS_LAST_UPDATED = "August 23, 2026";

export interface TermsSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    id: "what-flysales-is",
    title: "1. What FlySales is",
    paragraphs: [
      "FlySales is a B2B sourcing and fulfilment platform for e-commerce merchants. We source products on your request, quote prices, and arrange production and shipping to your end customers. You sell to your customers; we supply you. We are a supplier to your business, not a party to your sales.",
    ],
  },
  {
    id: "accounts-entities-workspaces",
    title: "2. Accounts, entities and workspaces",
    paragraphs: [
      "You register an account and operate through one or more legal entities. Each entity may hold up to three workspaces (limit adjustable by us). You are responsible for the accuracy of your entity's legal and tax details and for keeping your credentials secure. Accounts are for businesses; you confirm you are acting in a commercial capacity.",
    ],
  },
  {
    id: "subscriptions-quotas",
    title: "3. Subscriptions and quotas",
    paragraphs: [
      "Each workspace requires a subscription: Basic ($49/month, 5 quote requests per month) or Unlimited ($99/month, unlimited requests). Quotas reset on the first of each calendar month and do not roll over. Fees are charged in advance and are non-refundable for the current period. Downgrades take effect at the end of the billing period. We may change pricing with 30 days' notice; changes apply from your next billing period.",
    ],
  },
  {
    id: "quotes",
    title: "4. Quotes",
    paragraphs: [
      "You submit a product URL and target countries; we return prices per variant and destination country. We target a response within 48 hours but this is a service goal, not a guarantee. Quotes are valid until the stated expiry date. Prices are quoted in USD and include product cost, shipping and, where applicable, import taxes for the stated destination. A quote is only valid for the destination countries it names. Accepting a quote creates products in your workspace catalogue at the accepted price.",
    ],
  },
  {
    id: "orders-payment",
    title: "5. Orders and payment",
    paragraphs: [
      "Orders are placed automatically (connected store) or manually (portal or CSV). No order enters production or ships before it is paid. Payment is taken from your entity's wallet balance or by card. Order prices are fixed at the accepted quote; requotes do not affect orders already placed.",
      "Unpaid orders are cancelled automatically 7 days after creation, with reminders at 24, 48 and 72 hours.",
      "You are responsible for the accuracy of the end-customer shipping details you provide (directly or through your store). Parcels lost due to an incorrect address supplied by you or your customer are not covered.",
    ],
  },
  {
    id: "wallet",
    title: "6. Wallet",
    paragraphs: [
      "The wallet belongs to your entity and is shared across its workspaces. Top-ups are prepayments for future orders, held in USD. Wallet balances are not interest-bearing. On account closure, we will refund any unused balance on request, less payment-processing costs, within 30 days. Wallet credits issued as dispute resolutions are usable for orders but follow the same refund rule.",
    ],
  },
  {
    id: "shipping-delivery",
    title: "7. Shipping and delivery",
    paragraphs: [
      "Delivery estimates are estimates. Customs procedures, carrier delays and force majeure are outside our control. Where import tax (e.g. EU IOSS) is included in your quote, we arrange its declaration through our logistics partners; where it is not included, your end customer may be charged import fees on delivery, and this is not a covered failure.",
    ],
  },
  {
    id: "claims-disputes",
    title: "8. Claims and disputes",
    paragraphs: ["We cover failures between our supplier and delivery:"],
    bullets: [
      "Order not delivered — claim within 30 days of the estimated delivery date. Tracking history is the evidence.",
      "Damaged on arrival / wrong product shipped — claim within 7 days of delivery, with photos showing the product and the shipping label.",
      "Approved claims are resolved by wallet credit or reshipment, at our reasonable choice.",
    ],
  },
  {
    id: "claims-exclusions",
    title: "8.1 What we do not cover",
    paragraphs: [
      "We do not cover: end-customer returns or change of mind, incorrect addresses supplied by you or your customer, import charges where no import-tax arrangement was included, or any matter between you and your end customer. Your store's policies with your customers are your responsibility.",
      "Claims are submitted through the portal. One open claim per order. Abusive or fraudulent claiming is grounds for account suspension.",
    ],
  },
  {
    id: "cancellation",
    title: "9. Cancellation",
    paragraphs: [
      "You may cancel a workspace subscription at any time; it remains active until the period ends. After that, you can no longer submit quote requests on that workspace, but your catalogue remains, orders already placed complete normally, tracking continues, and your wallet balance remains yours per Section 6.",
    ],
  },
  {
    id: "acceptable-use",
    title: "10. Acceptable use",
    paragraphs: [
      "You may not use FlySales to source or sell illegal, counterfeit, or intellectual-property-infringing products. You are responsible for the legality of the products you sell in your target markets, including product compliance, labelling and consumer law. We may refuse to quote or fulfil any product at our discretion.",
    ],
  },
  {
    id: "data",
    title: "11. Your data and your customers' data",
    paragraphs: [
      "We process your end customers' shipping details solely to fulfil your orders, as your service provider. You warrant you have the right to share that data with us. Details in our Privacy Policy.",
    ],
  },
  {
    id: "liability",
    title: "12. Liability",
    paragraphs: [
      "Our total liability for any claim is limited to the amount you paid us for the order giving rise to the claim, or, for claims not tied to an order, the subscription fees paid in the preceding 3 months. We are not liable for your lost profits, lost sales, or your obligations to your end customers. Nothing in these Terms excludes liability that cannot be excluded by law.",
    ],
  },
  {
    id: "changes-termination",
    title: "13. Changes and termination",
    paragraphs: [
      "We may update these Terms with 30 days' notice for material changes. We may suspend or terminate accounts that breach these Terms, with wallet balances handled per Section 6. Fraud or abusive claiming may result in immediate suspension.",
    ],
  },
  {
    id: "governing-law",
    title: "14. Governing law",
    paragraphs: [
      "These Terms are governed by the laws of the United Arab Emirates as applicable in the Emirate of Dubai. Disputes shall be subject to the exclusive jurisdiction of the courts of Dubai.",
    ],
  },
];

export const TERMS_INTRO =
  'These Terms govern your use of FlySales, operated by BUDIGITAL SCALE MANAGEMENT - FZCO, a Free Zone Company registered in the Dubai Integrated Economic Zone (DIEZ) – Dubai Silicon Oasis, United Arab Emirates, with registered office at IFZA Business Park, DDP, PO Box 342001, Dubai, UAE, licence no. 61814, TRN 105110431100001 ("FlySales", "we", "us"). By creating an account you agree to these Terms.';
