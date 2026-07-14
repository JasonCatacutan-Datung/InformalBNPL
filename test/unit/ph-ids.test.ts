import { describe, it, expect } from "vitest";
import {
  normalizeIdNumber,
  checkIdNumber,
  validateIdNumber,
  idNumberWarning,
  idHint,
} from "@/lib/ids/ph-ids";

describe("normalizeIdNumber", () => {
  it("strips spaces and dashes and uppercases", () => {
    expect(normalizeIdNumber("1234-5678-9012-3456")).toBe("1234567890123456");
    expect(normalizeIdNumber("1234 5678 9012 3456")).toBe("1234567890123456");
    expect(normalizeIdNumber("p1234567a")).toBe("P1234567A");
    expect(normalizeIdNumber("")).toBe("");
  });
});

describe("checkIdNumber — hard-enforced types", () => {
  it("accepts a 16-digit PhilSys ignoring separators", () => {
    expect(checkIdNumber("PhilSys (National ID)", "1234-5678-9012-3456"))
      .toMatchObject({ status: "ok", normalized: "1234567890123456" });
    expect(validateIdNumber("PhilSys (National ID)", "1234 5678 9012 3456")).toBeNull();
  });

  it("rejects a 12-digit PhilSys with the front/back guidance", () => {
    expect(checkIdNumber("PhilSys (National ID)", "1234-5678-9012").status).toBe("error");
    // It is a hard block: validateIdNumber returns the specific PCN message.
    const msg = validateIdNumber("PhilSys (National ID)", "123456789012") ?? "";
    expect(msg).toContain("16-digit PhilSys Card Number");
    expect(msg).toMatch(/not the 12-digit number on the back/);
  });

  it("rejects other wrong-length PhilSys values", () => {
    expect(validateIdNumber("PhilSys (National ID)", "12345")).toMatch(/16 digits/);
  });

  it("enforces UMID as exactly 12 digits", () => {
    expect(validateIdNumber("UMID", "1234-5678-9012")).toBeNull();
    expect(validateIdNumber("UMID", "12345678901")).toMatch(/12 digits/);
    expect(validateIdNumber("UMID", "1234567890123")).toMatch(/12 digits/);
  });

  it("enforces SSS/GSIS as 10 or 11 digits", () => {
    expect(validateIdNumber("SSS/GSIS ID", "01-2345678-9")).toBeNull(); // 10
    expect(validateIdNumber("SSS/GSIS ID", "01234567890")).toBeNull(); // 11
    expect(validateIdNumber("SSS/GSIS ID", "012345678")).toMatch(/10–11 digits/); // 9
  });
});

describe("checkIdNumber — soft-warned types", () => {
  it("accepts well-formed soft types without a warning", () => {
    expect(checkIdNumber("Driver's License", "A11-11-111111").status).toBe("ok");
    expect(checkIdNumber("Passport", "P1234567A").status).toBe("ok");
    expect(checkIdNumber("PRC ID", "1234567").status).toBe("ok");
    expect(checkIdNumber("Voter's ID", "1234567890123456").status).toBe("ok");
    expect(idNumberWarning("Passport", "P1234567A")).toBeNull();
  });

  it("warns (but never blocks) for atypical soft values", () => {
    for (const [type, bad] of [
      ["Driver's License", "AB123"],
      ["Passport", "notapassport"],
      ["PRC ID", "123"],
      ["Voter's ID", "12345"],
    ] as const) {
      // Non-blocking: no hard error…
      expect(validateIdNumber(type, bad)).toBeNull();
      // …but a soft warning is surfaced.
      const w = idNumberWarning(type, bad);
      expect(w).toBeTruthy();
      expect(w).toMatch(/double-check/);
    }
  });

  it("treats Postal ID as permissive", () => {
    expect(checkIdNumber("Postal ID", "PRN-1234-5678-90").status).toBe("ok");
    expect(idNumberWarning("Postal ID", "whatever123")).toBeNull();
  });
});

describe("checkIdNumber — required + unmapped", () => {
  it("requires a value", () => {
    expect(validateIdNumber("PhilSys (National ID)", "")).toMatch(/required/);
    expect(validateIdNumber("PhilSys (National ID)", "  ")).toMatch(/required/);
  });

  it("is lenient for unmapped / Other types", () => {
    expect(validateIdNumber("Other", "ABC123")).toBeNull();
    expect(validateIdNumber("Other", "x")).not.toBeNull();
  });
});

describe("idHint", () => {
  it("returns a format hint for known types and empty otherwise", () => {
    expect(idHint("UMID")).toMatch(/12 digits/);
    expect(idHint("PhilSys (National ID)")).toMatch(/16 digits/);
    expect(idHint("Other")).toBe("");
  });
});
