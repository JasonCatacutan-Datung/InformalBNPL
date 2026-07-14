/**
 * Buyer application — option lists and the JSONB shape. Tailored to informal PH
 * micro-merchants (alternative-data underwriting) with an adaptive personal
 * branch. Shared by the application form and the operator review screen.
 */

import { PH_ID_TYPES } from "@/lib/ids/ph-ids";

// The canonical PH IDs (single source of truth in lib/ids/ph-ids), plus a
// catch-all "Other" for the long tail the form still accepts.
export const ID_TYPES = [...PH_ID_TYPES, "Other"] as const;

export const SELL_CHANNELS = [
  "Facebook",
  "Instagram",
  "TikTok",
  "Shopee",
  "Lazada",
  "Physical stall / palengke",
  "Word of mouth",
  "Other",
] as const;

export const SOURCING = [
  "Divisoria / Baclaran",
  "Direct supplier / distributor",
  "Online marketplace",
  "Importer / abroad",
  "Own production",
  "Other",
] as const;

export const RESTOCK_FREQUENCY = [
  "Weekly",
  "Every 2 weeks",
  "Monthly",
  "Irregular",
] as const;

export const EMPLOYMENT_STATUS = [
  "Employed (private)",
  "Employed (government)",
  "Self-employed",
  "Freelancer",
  "OFW",
  "Business owner",
  "Student",
  "Unemployed",
] as const;

export const EWALLETS = [
  "GCash",
  "Maya",
  "GrabPay",
  "ShopeePay",
  "Coins.ph",
  "UnionBank Online",
  "PayPal",
  "Other",
] as const;

// Major PH banks for disbursement reconciliation (operator-side; app moves no
// money). Kept broad — digital banks included for the informal market.
export const BANKS = [
  "BDO",
  "BPI",
  "Metrobank",
  "Landbank",
  "PNB",
  "Security Bank",
  "UnionBank",
  "RCBC",
  "China Bank",
  "EastWest",
  "PSBank",
  "Maybank",
  "CIMB",
  "GoTyme",
  "Tonik",
  "SeaBank",
  "DBP",
  "Other",
] as const;

export type BuyerKind = "business" | "personal";

export type BuyerApplication = {
  // Contact / personal
  email?: string;
  date_of_birth?: string;
  city?: string;
  province?: string;
  // Identity
  id_type?: string;
  id_number?: string;
  proof_of_billing_path?: string;
  // OCR results (filled by an operator-triggered check; see lib/ocr)
  ocr_id_check?: {
    idNumberFound: boolean;
    typeKeywordFound: boolean;
    textPreview: string;
    ranAt: string;
  } | null;
  ocr_billing_preview?: string | null;
  // Disbursement (operator reconciles manual transfers; app moves no money)
  ewallet_provider?: string;
  ewallet_number?: string;
  bank_name?: string;
  bank_account_name?: string;
  bank_account_number?: string;
  // Business branch
  product_category?: string;
  sell_channels?: string[];
  social_handles?: string;
  months_selling?: number;
  monthly_sales_centavos?: number;
  sourcing?: string[];
  restock_frequency?: string;
  typical_restock_centavos?: number;
  references?: { name?: string; contact?: string }[];
  // Personal branch
  employment_status?: string;
  occupation?: string;
  monthly_income_centavos?: number;
  // Common cash flow
  other_income_centavos?: number;
  existing_loans?: boolean;
  existing_loan_monthly_centavos?: number;
};
