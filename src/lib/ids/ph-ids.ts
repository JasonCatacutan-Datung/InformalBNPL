/**
 * Single source of truth for the Philippine government IDs accepted at intake:
 * the canonical type labels, plus normalization and validation rules. Consumed
 * by the buyer application form, the server-side submit guard, the OCR
 * cross-check (lib/ocr/id-check), and the duplicate-ID fraud signal
 * (lib/operator/fraud-flags) so all four agree on labels, formats, and how a
 * number is normalized before it is compared or stored.
 *
 * Validation is split by confidence:
 *  - hard: block submission with an inline error naming the expected format.
 *  - soft: normalize and allow submission, but surface a non-blocking hint when
 *    the number doesn't match the typical shape (OCR + manual review are the
 *    real verification, so we don't reject moderate-confidence formats).
 */

// Canonical PH ID type labels. The order is the order shown in the form.
export const PH_ID_TYPES = [
  "PhilSys (National ID)",
  "UMID",
  "Driver's License",
  "Passport",
  "Voter's ID",
  "Postal ID",
  "PRC ID",
  "SSS/GSIS ID",
] as const;

export type PhIdType = (typeof PH_ID_TYPES)[number];

/**
 * Normalize an ID number before validating, comparing, or storing it: strip
 * separators (spaces, dashes) and uppercase, so "1234-5678" and "12345678"
 * agree and a lower/upper-case passport letter doesn't create a phantom
 * duplicate.
 */
export function normalizeIdNumber(raw: string): string {
  return (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
}

type Severity = "hard" | "soft";

type IdRule = {
  /** Short human hint of the expected format, shown under the field. */
  hint: string;
  /** hard = block submission; soft = allow but warn. */
  severity: Severity;
  /** Tested against the normalized value; absent = permissive (always valid). */
  pattern?: RegExp;
  /**
   * Type-specific message that overrides the default when it returns a string
   * (e.g. the 12-digit PhilSys back-of-card rejection). Runs on the normalized
   * value before the pattern check.
   */
  message?: (normalized: string) => string | null;
};

const RULES: Record<PhIdType, IdRule> = {
  // Relying parties collect the public 16-digit PCN printed on the FRONT, never
  // the confidential 12-digit PSN on the back (PSA guidance / RA 11055).
  "PhilSys (National ID)": {
    hint: "16 digits (PCN, front of card)",
    severity: "hard",
    pattern: /^\d{16}$/,
    message: (v) =>
      /^\d{12}$/.test(v)
        ? "Enter the 16-digit PhilSys Card Number (PCN) printed on the FRONT of the card — not the 12-digit number on the back."
        : null,
  },
  UMID: { hint: "12 digits", severity: "hard", pattern: /^\d{12}$/ },
  "SSS/GSIS ID": { hint: "10–11 digits", severity: "hard", pattern: /^\d{10,11}$/ },
  "Driver's License": {
    hint: "e.g. A11-11-111111",
    severity: "soft",
    pattern: /^[A-Z]\d{10}$/,
  },
  Passport: {
    hint: "e.g. P1234567A",
    severity: "soft",
    pattern: /^[A-Z]{1,2}\d{7}[A-Z]?$/,
  },
  "PRC ID": { hint: "7 digits", severity: "soft", pattern: /^\d{7}$/ },
  "Voter's ID": { hint: "16–22 digits", severity: "soft", pattern: /^\d{16,22}$/ },
  // Postal IDs have changed format several times; stay permissive.
  "Postal ID": { hint: "alphanumeric", severity: "soft" },
};

export type IdCheck =
  | { status: "ok"; normalized: string }
  | { status: "error"; normalized: string; message: string }
  | { status: "warn"; normalized: string; message: string };

/**
 * Full intake check: normalizes the number, then classifies it as ok, a hard
 * error (blocks submission), or a soft warning (allow submission, show a hint).
 */
export function checkIdNumber(idType: string, raw: string): IdCheck {
  const normalized = normalizeIdNumber(raw);
  if (!normalized)
    return { status: "error", normalized, message: "ID number is required." };

  const rule = RULES[idType as PhIdType];
  if (!rule) {
    // "Other" / unmapped types — permissive, just require a few characters.
    return normalized.length >= 4
      ? { status: "ok", normalized }
      : { status: "error", normalized, message: "Enter a valid ID number." };
  }

  const custom = rule.message?.(normalized);
  if (custom) return { status: "error", normalized, message: custom };

  const valid = rule.pattern ? rule.pattern.test(normalized) : true;
  if (valid) return { status: "ok", normalized };

  if (rule.severity === "hard") {
    return {
      status: "error",
      normalized,
      message: `Enter a valid ${idType} (${rule.hint}).`,
    };
  }
  return {
    status: "warn",
    normalized,
    message: `This doesn't look like a typical ${idType} number (${rule.hint}) — double-check it.`,
  };
}

/** Expected-format hint for an ID type, or "" if unconstrained. */
export function idHint(idType: string): string {
  return RULES[idType as PhIdType]?.hint ?? "";
}

/**
 * Hard error message that must block submission, or null. Soft warnings return
 * null here so they never block — the form surfaces those separately via
 * {@link idNumberWarning}.
 */
export function validateIdNumber(idType: string, raw: string): string | null {
  const r = checkIdNumber(idType, raw);
  return r.status === "error" ? r.message : null;
}

/** Non-blocking soft-warn message for moderate-confidence formats, or null. */
export function idNumberWarning(idType: string, raw: string): string | null {
  const r = checkIdNumber(idType, raw);
  return r.status === "warn" ? r.message : null;
}
