"use client";

import { useState, useRef, useEffect } from "react";
import {
  Store,
  ShoppingBag,
  Smartphone,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { applyAsBuyer } from "@/app/(public)/onboarding/actions";
import {
  ID_TYPES,
  SELL_CHANNELS,
  SOURCING,
  RESTOCK_FREQUENCY,
  EMPLOYMENT_STATUS,
  EWALLETS,
  BANKS,
  type BuyerKind,
} from "@/lib/profiles/buyer-application";
import PhLocation from "@/app/(public)/onboarding/PhLocation";
import { idHint, validateIdNumber, idNumberWarning } from "@/lib/ids/ph-ids";
import { Field, TextInput, Select, controlClasses } from "@/components/ui/Field";
import ChoiceCards from "@/components/ui/ChoiceCards";
import CheckboxGroup from "@/components/ui/CheckboxGroup";
import FileUpload from "@/components/ui/FileUpload";
import Callout from "@/components/ui/Callout";
import Wizard, { type WizardStep } from "@/components/ui/Wizard";
import LocationConsent from "@/components/location/LocationConsent";
import ImportContacts from "@/components/contacts/ImportContacts";

function StepIntro({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {subtitle ? <p className="text-sm text-black/55">{subtitle}</p> : null}
    </div>
  );
}

export default function BuyerApplicationForm({ next }: { next?: string }) {
  const [kind, setKind] = useState<BuyerKind>("business");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [payout, setPayout] = useState<"ewallet" | "bank">("ewallet");

  // Required ID photo is enforced in JS (a hidden required file input isn't
  // focusable for native validation) — the identity step's validate() uses this.
  const [idPhotoFilled, setIdPhotoFilled] = useState(false);
  const [idPhotoError, setIdPhotoError] = useState<string | null>(null);

  // Inline ID-number validation: a typo shows under the field and blocks the
  // step via native validity, instead of a round-trip that wipes the form.
  const idInputRef = useRef<HTMLInputElement>(null);
  const idError = idType && idNumber ? validateIdNumber(idType, idNumber) : null;
  // Soft warning for moderate-confidence formats — shown as a non-blocking hint
  // (never fed into setCustomValidity, so it doesn't block the step).
  const idWarn = idType && idNumber ? idNumberWarning(idType, idNumber) : null;
  useEffect(() => {
    idInputRef.current?.setCustomValidity(idError ?? "");
  }, [idError]);

  const steps: WizardStep[] = [
    {
      id: "purpose",
      title: "Purpose",
      render: (
        <>
          <StepIntro
            title="What are you applying for?"
            subtitle="This tailors the rest of the questions to you."
          />
          <ChoiceCards
            name="buyer_kind"
            value={kind}
            onChange={(v) => setKind(v as BuyerKind)}
            options={[
              {
                value: "business",
                label: "Buying stock to resell",
                description: "You run a small business and restock inventory.",
                icon: Store,
              },
              {
                value: "personal",
                label: "Personal purchases",
                description: "Shop now and pay in small amounts, for your own needs.",
                icon: ShoppingBag,
              },
            ]}
          />
        </>
      ),
    },
    {
      id: "you",
      title: "About you",
      render: (
        <>
          <StepIntro title="About you" subtitle="Your basic details." />
          <Field label="Full name">
            <TextInput name="name" required autoComplete="name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile number">
              <TextInput
                name="contact"
                required
                inputMode="tel"
                defaultValue="+639"
                placeholder="+639XX XXX XXXX"
              />
            </Field>
            <Field label="Email" optional>
              <TextInput name="email" type="email" autoComplete="email" />
            </Field>
            <Field label="Date of birth">
              <TextInput name="date_of_birth" type="date" required />
            </Field>
            <div />
          </div>
          <PhLocation inputClassName={controlClasses} required />
        </>
      ),
    },
    {
      id: "identity",
      title: "Identity",
      validate: () => {
        if (!idPhotoFilled) {
          setIdPhotoError("Please add a photo of your ID to continue.");
          return false;
        }
        setIdPhotoError(null);
        return true;
      },
      render: (
        <>
          <StepIntro
            title="Verify your identity"
            subtitle="One valid government ID. Stored privately, used only for review."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID type">
              <Select
                name="id_type"
                required
                defaultValue=""
                onChange={(e) => setIdType(e.target.value)}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {ID_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="ID number"
              error={idError}
              hint={
                idWarn ??
                (idHint(idType) ? `Format: ${idHint(idType)}` : undefined)
              }
            >
              <TextInput
                name="id_number"
                ref={idInputRef}
                required
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                aria-invalid={idError ? true : undefined}
              />
            </Field>
          </div>
          <FileUpload
            name="id_photo"
            label="Photo of your ID"
            hint="On a phone this opens the camera. Stored privately for review."
            error={idPhotoError}
            onFilledChange={(f) => {
              setIdPhotoFilled(f);
              if (f) setIdPhotoError(null);
            }}
          />
          <FileUpload
            name="proof_of_billing"
            label="Proof of billing (optional)"
            hint="A recent utility bill in your name helps verify your address."
          />
        </>
      ),
    },
    ...(kind === "business" ? businessSteps() : personalSteps()),
    {
      id: "payout",
      title: "Payout",
      render: (
        <>
          <StepIntro
            title="Where you'd receive or send money"
            subtitle="So the operator can reconcile transfers. The app never moves money itself."
          />
          <ChoiceCards
            name="payout_method"
            value={payout}
            onChange={(v) => setPayout(v as "ewallet" | "bank")}
            columns={2}
            options={[
              { value: "ewallet", label: "E-wallet", icon: Smartphone },
              { value: "bank", label: "Bank account", icon: Landmark },
            ]}
          />
          {payout === "ewallet" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="E-wallet">
                <Select name="ewallet_provider" defaultValue="" required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {EWALLETS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="E-wallet mobile number">
                <TextInput
                  name="ewallet_number"
                  inputMode="tel"
                  defaultValue="+639"
                />
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank">
                <Select name="bank_name" defaultValue="" required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Account number">
                <TextInput name="bank_account_number" inputMode="numeric" />
              </Field>
              <Field label="Account name" className="sm:col-span-2">
                <TextInput name="bank_account_name" />
              </Field>
            </div>
          )}
        </>
      ),
    },
    {
      id: "confirm",
      title: "Confirm",
      render: (
        <>
          <StepIntro
            title="Confirm & consent"
            subtitle="Almost done — review and submit."
          />
          <Callout tone="success" title="You don't pick a limit yourself">
            Once you&apos;re approved, you&apos;ll get a starting spending limit.
            Pay on time and it grows.
          </Callout>
          <Callout tone="info">
            We&apos;ll review your application and text you as soon as
            it&apos;s approved.
          </Callout>
          <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-white p-4 text-sm">
            <input
              type="checkbox"
              name="consent"
              value="yes"
              required
              className="mt-0.5 size-5 accent-brand-600"
            />
            <span className="text-foreground">
              I confirm the information is true, and consent to verification of
              my details and references.
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-black/10 bg-white p-4 text-sm">
            <input
              type="checkbox"
              name="agree_credit_agreement"
              value="yes"
              required
              className="mt-0.5 size-5 accent-brand-600"
            />
            <span className="text-foreground">
              I have read and agree to the{" "}
              <a
                href="/legal/credit-agreement"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline underline-offset-4"
              >
                Datung Credit Agreement
              </a>{" "}
              and Data Privacy consent.
            </span>
          </label>
          <LocationConsent purpose="to help verify my account and protect against fraud" />
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">
              Type your full name to sign
            </span>
            <input
              type="text"
              name="signature"
              required
              autoComplete="name"
              placeholder="Your full name"
              className="h-12 w-full rounded-xl border border-black/10 bg-white px-3.5 text-[16px] shadow-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
            />
          </label>
        </>
      ),
    },
  ];

  return (
    <form
      action={applyAsBuyer}
      encType="multipart/form-data"
      className="space-y-6"
    >
      {next === "seller" ? (
        <input type="hidden" name="next" value="seller" />
      ) : null}
      <div className="flex items-center gap-2 text-xs font-medium text-brand-700">
        <ShieldCheck className="size-4" /> Your information is encrypted and
        reviewed privately.
      </div>
      <Wizard
        steps={steps}
        submitLabel={
          next === "seller"
            ? "Submit & continue to seller"
            : "Submit application"
        }
        pendingLabel="Submitting your application…"
      />
    </form>
  );
}

/* ---- Branch steps ---------------------------------------------------------- */

function businessSteps(): WizardStep[] {
  return [
    {
      id: "selling",
      title: "Your business",
      render: (
        <>
          <StepIntro
            title="What & where you sell"
            subtitle="Helps us understand your business."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What do you sell?">
              <TextInput
                name="product_category"
                required
                placeholder="e.g. ukay clothes, snacks, phone accessories"
              />
            </Field>
            <Field label="Months selling" optional>
              <TextInput
                name="months_selling"
                type="number"
                min={0}
                inputMode="numeric"
              />
            </Field>
          </div>
          <Field label="Where do you sell?">
            <CheckboxGroup
              name="sell_channels"
              options={SELL_CHANNELS}
              columns={4}
            />
          </Field>
          <Field label="Page / shop links or handles" optional>
            <TextInput
              name="social_handles"
              placeholder="fb.com/yourshop, @yourshop"
            />
          </Field>
          <Field label="Estimated monthly sales (PHP)">
            <TextInput
              name="monthly_sales"
              type="number"
              min={0}
              inputMode="numeric"
              required
            />
          </Field>
        </>
      ),
    },
    {
      id: "sourcing",
      title: "Sourcing",
      render: (
        <>
          <StepIntro
            title="Where you buy your stock"
            subtitle="And a couple of cash-flow questions."
          />
          <Field label="Where do you source?">
            <CheckboxGroup name="sourcing" options={SOURCING} columns={2} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How often do you restock?">
              <Select name="restock_frequency" defaultValue="">
                <option value="">Choose…</option>
                {RESTOCK_FREQUENCY.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Typical restock amount (PHP)" optional>
              <TextInput
                name="typical_restock"
                type="number"
                min={0}
                inputMode="numeric"
              />
            </Field>
          </div>
          <CashFlowFields />
          <Field label="Character references" optional>
            <div className="space-y-2.5">
              <ImportContacts />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput name="ref1_name" placeholder="Reference 1 — name" />
                <TextInput name="ref1_contact" placeholder="Reference 1 — mobile" />
                <TextInput name="ref2_name" placeholder="Reference 2 — name" />
                <TextInput name="ref2_contact" placeholder="Reference 2 — mobile" />
              </div>
            </div>
          </Field>
        </>
      ),
    },
  ];
}

function personalSteps(): WizardStep[] {
  return [
    {
      id: "livelihood",
      title: "Livelihood",
      render: (
        <>
          <StepIntro
            title="Your livelihood"
            subtitle="How you earn, so we can review you fairly."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employment status">
              <Select name="employment_status" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {EMPLOYMENT_STATUS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Occupation / employer" optional>
              <TextInput name="occupation" />
            </Field>
          </div>
          <Field label="Estimated monthly income (PHP)">
            <TextInput
              name="monthly_income"
              type="number"
              min={0}
              inputMode="numeric"
              required
            />
          </Field>
          <CashFlowFields />
        </>
      ),
    },
  ];
}

function CashFlowFields() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Other monthly income (PHP)" optional>
        <TextInput
          name="other_income"
          type="number"
          min={0}
          inputMode="numeric"
        />
      </Field>
      <Field label="Existing loan payments / month (PHP)" optional>
        <TextInput
          name="existing_loan_monthly"
          type="number"
          min={0}
          inputMode="numeric"
        />
      </Field>
    </div>
  );
}
