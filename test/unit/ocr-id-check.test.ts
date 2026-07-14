import { describe, it, expect } from "vitest";
import { crossCheckId } from "@/lib/ocr/id-check";

describe("crossCheckId", () => {
  it("finds the ID number ignoring spacing, and matches type keywords", () => {
    const text = "REPUBLIKA NG PILIPINAS PhilSys PCN 1234 5678 9012 3456 Juan Dela Cruz";
    const r = crossCheckId("PhilSys (National ID)", "1234-5678-9012-3456", text);
    expect(r.idNumberFound).toBe(true);
    expect(r.typeKeywordFound).toBe(true);
  });

  it("flags a type mismatch (passport selected, license text)", () => {
    const text = "LAND TRANSPORTATION OFFICE NON-PROFESSIONAL DRIVER'S LICENSE N01-23-456789";
    const r = crossCheckId("Passport", "XY9988776", text);
    expect(r.typeKeywordFound).toBe(false); // key signal: wrong document type
    expect(r.idNumberFound).toBe(false); // passport number not present

  });

  it("does not false-match a too-short number", () => {
    const r = crossCheckId("Other", "12", "some text with 12 in it");
    expect(r.idNumberFound).toBe(false);
  });

  it("matches Tagalog wording on the ID (read via the fil model)", () => {
    // PSA cards print the Filipino label; OCR with `fil` surfaces these.
    const philsys = crossCheckId(
      "PhilSys (National ID)",
      "1234567890123456",
      "Republika ng Pilipinas — Pambansang Pagkakakilanlan 1234 5678 9012 3456",
    );
    expect(philsys.typeKeywordFound).toBe(true);
    expect(philsys.idNumberFound).toBe(true);

    const passport = crossCheckId("Passport", "P1234567A", "Pasaporte P1234567A");
    expect(passport.typeKeywordFound).toBe(true);
  });
});
