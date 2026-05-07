import { describe, expect, it } from "vitest";

import { maskPii, REDACTION_TOKEN } from "../src/services/safety/pii";

describe("maskPii", () => {
  it("masks configured PII classes", () => {
    const result = maskPii(
      [
        "PAN ABCDE1234F",
        "Aadhaar 2345 6789 1234",
        "phone +91 98765 43210",
        "email user@example.com",
        "account number 123456789012",
        "OTP is 123456",
        "my name is Priya Sharma",
        "address is Flat 12, MG Road, Mumbai"
      ].join(". ")
    );

    expect(result.maskedText).not.toContain("ABCDE1234F");
    expect(result.maskedText).not.toContain("2345 6789 1234");
    expect(result.maskedText).not.toContain("98765 43210");
    expect(result.maskedText).not.toContain("user@example.com");
    expect(result.maskedText).not.toContain("123456789012");
    expect(result.maskedText).not.toContain("123456");
    expect(result.maskedText).not.toContain("Priya Sharma");
    expect(result.maskedText).not.toContain("Flat 12");
    expect(result.maskedText.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("returns finding counts by PII type", () => {
    const result = maskPii("email a@example.com and b@example.com. PAN ABCDE1234F");

    expect(result.findings).toEqual(
      expect.arrayContaining([
        { type: "email", count: 2 },
        { type: "pan", count: 1 }
      ])
    );
    expect(result.maskedText).toContain(REDACTION_TOKEN);
  });
});
