"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config/system-config";
import { validateIdNumber, normalizeIdNumber } from "@/lib/ids/ph-ids";
import { recordSellerReferral } from "@/lib/referrals/seller-referrals";
import { recordDocumentAcceptance, clientIp } from "@/lib/legal/acceptance";
import { recordLocationEvent } from "@/lib/location/events";

/**
 * Stage 3 onboarding: a logged-in user applies for buyer and/or seller
 * capability. Identity comes from the session; writes go through the service
 * role (clients have no write policies). Both profiles are created with
 * kyc_status 'pending' — underwriting/verification is manual, done by an
 * operator. No automated decision happens here.
 */

const SELLER_BUCKET = "seller-verification";
const BUYER_ID_BUCKET = "buyer-id";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Parse a peso amount into integer centavos, or null if empty/invalid. */
function centavos(formData: FormData, key: string): number | null {
  const n = Number(str(formData, key));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function num(formData: FormData, key: string): number | null {
  const n = Number(str(formData, key));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function ageFrom(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

export async function applyAsBuyer(formData: FormData) {
  const userId = await requireUserId();

  const next = str(formData, "next");

  // Preserve the "Both" step context (next=seller) on validation errors so the
  // applicant stays in the two-step flow instead of silently dropping to a
  // standalone buyer form.
  const buyerError = (message: string): never => {
    const suffix = next === "seller" ? "&next=seller" : "";
    redirect(
      "/onboarding/buyer?error=" + encodeURIComponent(message) + suffix,
    );
  };
  const kind = str(formData, "buyer_kind") === "personal" ? "personal" : "business";
  const name = str(formData, "name");
  const contact = str(formData, "contact");
  const dob = str(formData, "date_of_birth");
  const idType = str(formData, "id_type");
  const idNumber = str(formData, "id_number");
  const consent = str(formData, "consent") === "yes";
  const agreeAgreement = str(formData, "agree_credit_agreement") === "yes";
  const signature = str(formData, "signature");
  const idPhoto = formData.get("id_photo");

  // Optional, explicitly-consented device location + voluntary contact import.
  const locationConsent = str(formData, "location_consent") === "yes";
  const contactsConsent = str(formData, "contacts_consent") === "yes";
  const geoLat = parseFloat(str(formData, "geo_lat"));
  const geoLng = parseFloat(str(formData, "geo_lng"));
  const geoAcc = Number(str(formData, "geo_accuracy"));
  const nowIso = new Date().toISOString();

  // ---- Required core ----
  if (!name || !contact) buyerError("Name and mobile number are required.");
  if (!dob) buyerError("Date of birth is required.");
  const age = ageFrom(dob);
  if (age === null) buyerError("Date of birth is invalid.");
  else if (age < 18) buyerError("Applicants must be at least 18 years old.");
  if (!idType || !idNumber) buyerError("A valid government ID is required.");
  const idErr = validateIdNumber(idType, idNumber);
  if (idErr) buyerError(idErr);
  if (!(idPhoto instanceof File) || idPhoto.size === 0) {
    buyerError("A photo of your ID is required.");
  }
  if (!(idPhoto as File).type.startsWith("image/")) {
    buyerError("The ID photo must be an image.");
  }
  if (!consent) buyerError("Please confirm and consent to proceed.");
  if (!agreeAgreement || !signature) {
    buyerError("Please read and accept the Credit Agreement and sign with your name.");
  }

  // ---- Branch-specific required ----
  const monthlySales = centavos(formData, "monthly_sales");
  const monthlyIncome = centavos(formData, "monthly_income");
  const employment = str(formData, "employment_status");
  const productCategory = str(formData, "product_category");
  if (kind === "business") {
    if (!productCategory) buyerError("Tell us what you sell.");
    if (!monthlySales) buyerError("Estimated monthly sales is required.");
  } else {
    if (!employment) buyerError("Employment status is required.");
    if (!monthlyIncome) buyerError("Estimated monthly income is required.");
  }

  const admin = createAdminClient();

  // ---- Upload the ID photo (private bucket) ----
  const photo = idPhoto as File;
  const ext = photo.name.includes(".") ? photo.name.split(".").pop() : "jpg";
  const idPath = `${userId}/${Date.now()}-id.${ext}`;
  const { error: uploadError } = await admin.storage
    .from(BUYER_ID_BUCKET)
    .upload(idPath, Buffer.from(await photo.arrayBuffer()), {
      contentType: photo.type,
      upsert: true,
    });
  if (uploadError) buyerError("ID upload failed: " + uploadError.message);

  // ---- Optional proof of billing (address verification) ----
  let proofOfBillingPath: string | undefined;
  const proof = formData.get("proof_of_billing");
  if (proof instanceof File && proof.size > 0 && proof.type.startsWith("image/")) {
    const pext = proof.name.includes(".") ? proof.name.split(".").pop() : "jpg";
    const ppath = `${userId}/${Date.now()}-proof.${pext}`;
    const { error: pErr } = await admin.storage
      .from(BUYER_ID_BUCKET)
      .upload(ppath, Buffer.from(await proof.arrayBuffer()), {
        contentType: proof.type,
        upsert: true,
      });
    if (!pErr) proofOfBillingPath = ppath;
  }

  // ---- Build the structured application payload ----
  const references = [
    { name: str(formData, "ref1_name"), contact: str(formData, "ref1_contact") },
    { name: str(formData, "ref2_name"), contact: str(formData, "ref2_contact") },
  ].filter((r) => r.name || r.contact);

  const application: Record<string, unknown> = {
    email: str(formData, "email") || undefined,
    date_of_birth: dob,
    city: str(formData, "city") || undefined,
    province: str(formData, "province") || undefined,
    id_type: idType,
    // Store the normalized number (separators stripped, uppercased) so review,
    // OCR cross-check, and duplicate-ID detection all see one canonical form.
    id_number: normalizeIdNumber(idNumber),
    proof_of_billing_path: proofOfBillingPath,
    ewallet_provider: str(formData, "ewallet_provider") || undefined,
    ewallet_number: str(formData, "ewallet_number") || undefined,
    bank_name: str(formData, "bank_name") || undefined,
    bank_account_name: str(formData, "bank_account_name") || undefined,
    bank_account_number: str(formData, "bank_account_number") || undefined,
    other_income_centavos: centavos(formData, "other_income") ?? undefined,
    existing_loan_monthly_centavos:
      centavos(formData, "existing_loan_monthly") ?? undefined,
  };

  if (kind === "business") {
    Object.assign(application, {
      product_category: productCategory,
      sell_channels: formData.getAll("sell_channels").map(String),
      social_handles: str(formData, "social_handles") || undefined,
      months_selling: num(formData, "months_selling") ?? undefined,
      monthly_sales_centavos: monthlySales,
      sourcing: formData.getAll("sourcing").map(String),
      restock_frequency: str(formData, "restock_frequency") || undefined,
      typical_restock_centavos: centavos(formData, "typical_restock") ?? undefined,
      references: references.length > 0 ? references : undefined,
    });
  } else {
    Object.assign(application, {
      employment_status: employment,
      occupation: str(formData, "occupation") || undefined,
      monthly_income_centavos: monthlyIncome,
    });
  }

  // Onboarding is the first place we capture a real name/contact.
  await admin.from("users").update({ name, contact }).eq("id", userId);

  // BNPL buyers are pre-approved to a standard starting limit (no requested
  // amount). Identity is still verified before the line is activated; the
  // operator can adjust the limit for risk.
  const config = await getConfig(admin);

  const { error } = await admin.from("buyer_profiles").upsert(
    {
      user_id: userId,
      kyc_status: "pending",
      buyer_kind: kind,
      id_document_path: idPath,
      credit_limit_centavos: config.default_credit_limit_centavos,
      application,
      location_consent: locationConsent,
      location_consent_at: locationConsent ? nowIso : null,
      contacts_consent: contactsConsent,
      contacts_consent_at: contactsConsent ? nowIso : null,
    },
    { onConflict: "user_id" },
  );
  if (error) buyerError(error.message);

  // Record the consented location capture (append-only; best-effort).
  if (locationConsent) {
    await recordLocationEvent(admin, {
      userId,
      source: "signup",
      lat: geoLat,
      lng: geoLng,
      accuracyM: Number.isFinite(geoAcc) ? geoAcc : null,
    });
  }

  // Record the borrower's one-time acceptance of the master Credit Agreement
  // (+ data-privacy consent). No loan yet, so loan_id is null.
  await recordDocumentAcceptance({
    userId,
    documentType: "credit_agreement",
    signatureName: signature,
    ipAddress: await clientIp(),
  });

  // "Both" flow: after the buyer step, continue to the seller step.
  redirect(next === "seller" ? "/onboarding/seller" : "/dashboard");
}

export async function applyAsSeller(formData: FormData) {
  const userId = await requireUserId();

  const sellerError = (msg: string): never =>
    redirect("/onboarding/seller?error=" + encodeURIComponent(msg));

  const name = String(formData.get("name") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();
  const idType = String(formData.get("id_type") ?? "").trim();
  const sellsWhat = String(formData.get("sells_what") ?? "").trim();
  const socialHandle = String(formData.get("social_handle") ?? "").trim();
  const marketplaceUrl = String(formData.get("marketplace_url") ?? "").trim();
  const sellingSince = String(formData.get("selling_since") ?? "").trim();
  const storefrontAddress = String(formData.get("storefront_location") ?? "").trim();
  const storefrontCity = String(formData.get("storefront_city") ?? "").trim();
  const storefrontProvince = String(formData.get("storefront_province") ?? "").trim();
  const storefrontLocation = [storefrontAddress, storefrontCity, storefrontProvince]
    .filter(Boolean)
    .join(", ");
  const notes = String(formData.get("notes") ?? "").trim();
  const lat = parseFloat(String(formData.get("storefront_lat") ?? ""));
  const lng = parseFloat(String(formData.get("storefront_lng") ?? ""));

  // Optional, explicitly-consented device location.
  const locationConsent = str(formData, "location_consent") === "yes";
  const geoLat = parseFloat(str(formData, "geo_lat"));
  const geoLng = parseFloat(str(formData, "geo_lng"));
  const geoAcc = Number(str(formData, "geo_accuracy"));

  // Social handle is optional — we're onboarding physical stores, whose proof of
  // selling is their stall location + photos, not an online presence.
  if (!name || !contact) {
    sellerError("Name and contact are required.");
  }
  if (!idType) sellerError("Select your government ID type.");
  if (!sellsWhat) sellerError("Tell us what you sell.");
  if (!storefrontAddress) sellerError("Tell us where you sell.");

  const admin = createAdminClient();

  // Upload an image field to the private seller bucket, returning its path.
  async function uploadImage(field: string, label: string, tag: string): Promise<string> {
    const file = formData.get(field);
    if (!(file instanceof File) || file.size === 0) {
      sellerError(`${label} is required.`);
    }
    const f = file as File;
    if (!f.type.startsWith("image/")) sellerError(`${label} must be an image.`);
    const ext = f.name.includes(".") ? f.name.split(".").pop() : "jpg";
    const path = `${userId}/${Date.now()}-${tag}.${ext}`;
    const { error } = await admin.storage
      .from(SELLER_BUCKET)
      .upload(path, Buffer.from(await f.arrayBuffer()), {
        contentType: f.type,
        upsert: true,
      });
    if (error) sellerError(`${label} upload failed: ${error.message}`);
    return path;
  }

  // Reuse the ID photo from the buyer step if the seller didn't upload a new
  // one — the "Both" flow shouldn't ask for the same government ID twice.
  async function reuseBuyerId(): Promise<string> {
    const { data: bp } = await admin
      .from("buyer_profiles")
      .select("id_document_path")
      .eq("user_id", userId)
      .maybeSingle();
    const src = bp?.id_document_path as string | undefined;
    if (!src) sellerError("A photo of your government ID is required.");
    const { data: file, error: dlErr } = await admin.storage
      .from(BUYER_ID_BUCKET)
      .download(src as string);
    if (dlErr || !file) {
      sellerError("A photo of your government ID is required.");
    }
    const blob = file as Blob;
    const ext = (src as string).split(".").pop() || "jpg";
    const path = `${userId}/${Date.now()}-id.${ext}`;
    const { error: upErr } = await admin.storage
      .from(SELLER_BUCKET)
      .upload(path, Buffer.from(await blob.arrayBuffer()), {
        contentType: blob.type || "image/jpeg",
        upsert: true,
      });
    if (upErr) {
      sellerError("Could not reuse your buyer ID — please upload your ID photo.");
    }
    return path;
  }

  const idFile = formData.get("id_document");
  const idPath =
    idFile instanceof File && idFile.size > 0
      ? await uploadImage("id_document", "Government ID photo", "id")
      : await reuseBuyerId();
  const storefrontPath = await uploadImage(
    "storefront_photo",
    "Storefront photo",
    "storefront",
  );
  const itemPath = await uploadImage("photo", "Live item photo", "live-item");

  await admin.from("users").update({ name, contact }).eq("id", userId);

  const { error } = await admin.from("seller_profiles").upsert(
    {
      user_id: userId,
      sells_what: sellsWhat || null,
      social_handle: socialHandle || null,
      marketplace_url: marketplaceUrl || null,
      selling_since: sellingSince || null,
      id_type: idType,
      id_document_path: idPath,
      storefront_photo_path: storefrontPath,
      storefront_location: storefrontLocation,
      storefront_lat: Number.isFinite(lat) ? lat : null,
      storefront_lng: Number.isFinite(lng) ? lng : null,
      kyc_status: "pending",
      verification_notes: notes || null,
      verification_photo_path: itemPath,
      location_consent: locationConsent,
      location_consent_at: locationConsent ? new Date().toISOString() : null,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    redirect("/onboarding/seller?error=" + encodeURIComponent(error.message));
  }

  // Record the consented device-location capture (append-only; best-effort).
  if (locationConsent) {
    await recordLocationEvent(admin, {
      userId,
      source: "seller_onboarding",
      lat: geoLat,
      lng: geoLng,
      accuracyM: Number.isFinite(geoAcc) ? geoAcc : null,
    });
  }

  // If this applicant arrived via another seller's referral link, record a
  // pending referral now (the referrer id was captured in auth metadata at
  // sign-up). Best-effort — never block the application on it.
  try {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const referrer = String(
      u?.user?.user_metadata?.seller_referrer_id ?? "",
    ).trim();
    if (referrer) await recordSellerReferral(admin, userId, referrer);
  } catch (e) {
    console.error("recordSellerReferral failed:", e);
  }

  redirect("/dashboard");
}
