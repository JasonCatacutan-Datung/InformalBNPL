/**
 * Cross-check OCR text against what the applicant declared. Pure + deterministic
 * (unit-tested without running OCR). Two signals the operator sees:
 *  - idNumberFound: the typed ID number appears in the document text
 *  - typeKeywordFound: wording for the chosen ID type appears (so a "Passport"
 *    selection backed by a photo of a driver's license gets flagged)
 * Both are advisory — OCR on phone photos is noisy, so a miss means "look
 * closer", not "reject".
 */

import type { PhIdType } from "@/lib/ids/ph-ids";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
const digits = (s: string) => s.replace(/\D/g, "");

// Keywords expected on each PH ID (lowercase, matched loosely). Keyed by the
// canonical PhIdType labels so this map stays in lockstep with lib/ids/ph-ids —
// the Record type makes a missing/renamed key a compile error.
const ID_KEYWORDS: Record<PhIdType, string[]> = {
  "PhilSys (National ID)": ["philsys", "pambansang", "national id", "pcn", "republika ng pilipinas"],
  UMID: ["umid", "unified multi", "sss", "gsis", "social security"],
  "Driver's License": ["driver", "license", "licence", "land transportation", "lto", "non-professional", "professional"],
  Passport: ["passport", "pasaporte", "republic of the philippines"],
  "Voter's ID": ["comelec", "voter", "commission on elections"],
  "Postal ID": ["postal", "philpost", "philippine postal"],
  "PRC ID": ["professional regulation", "prc", "registration no"],
  "SSS/GSIS ID": ["sss", "gsis", "social security", "government service"],
};

export type OcrIdCheck = {
  idNumberFound: boolean;
  typeKeywordFound: boolean;
  textPreview: string;
};

export function crossCheckId(
  idType: string,
  idNumber: string,
  ocrText: string,
): OcrIdCheck {
  const text = norm(ocrText);
  const textDigits = digits(ocrText);
  const wanted = digits(idNumber);

  // Match the ID number on digits (ignores spacing/dashes); needs enough
  // digits to be meaningful.
  const idNumberFound = wanted.length >= 6 && textDigits.includes(wanted);

  const keywords = ID_KEYWORDS[idType as PhIdType] ?? [];
  const typeKeywordFound =
    keywords.length === 0 ? true : keywords.some((k) => text.includes(k));

  return {
    idNumberFound,
    typeKeywordFound,
    textPreview: ocrText.replace(/\s+/g, " ").trim().slice(0, 280),
  };
}
