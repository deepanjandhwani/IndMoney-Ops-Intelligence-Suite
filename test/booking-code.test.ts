import { describe, expect, it } from "vitest";

import {
  BookingCodeCollisionError,
  generateBookingCode,
  generateUniqueBookingCode,
  isValidBookingCode,
  parseBookingCodeFromLooseInput
} from "../src/services/scheduler/booking-code";

describe("booking code generation", () => {
  it("generates codes in LL-LDDD format", () => {
    expect(isValidBookingCode(generateBookingCode())).toBe(true);
  });

  it("retries collisions and returns the first unique code", async () => {
    const generatedCodes = ["AA-A111", "BB-B222", "CC-C333"];
    const existingCodes = new Set(["AA-A111", "BB-B222"]);
    let generatorCalls = 0;
    let lookupCalls = 0;

    const bookingCode = await generateUniqueBookingCode(
      {
        bookingCodeExists: async (code) => {
          lookupCalls += 1;
          return existingCodes.has(code);
        }
      },
      {
        codeGenerator: () => generatedCodes[generatorCalls++]
      }
    );

    expect(bookingCode).toBe("CC-C333");
    expect(generatorCalls).toBe(3);
    expect(lookupCalls).toBe(3);
  });

  it("fails after five collisions", async () => {
    await expect(
      generateUniqueBookingCode(
        {
          bookingCodeExists: async () => true
        },
        {
          codeGenerator: () => "AA-A111"
        }
      )
    ).rejects.toBeInstanceOf(BookingCodeCollisionError);
  });
});

describe("parseBookingCodeFromLooseInput (voice / STT)", () => {
  it('parses "R GDashY133" style transcripts', () => {
    expect(parseBookingCodeFromLooseInput("R GDashY133.")).toBe("RG-Y133");
  });

  it("parses spaced dash words", () => {
    expect(parseBookingCodeFromLooseInput("RG dash Y133")).toBe("RG-Y133");
  });

  it("parses compact NL A742 style", () => {
    expect(parseBookingCodeFromLooseInput("my code is NL A742 please")).toBe("NL-A742");
  });

  it("parses spoken digit words", () => {
    expect(parseBookingCodeFromLooseInput("A J dash C two one six.")).toBe("AJ-C216");
  });

  it("parses phonetic letter words", () => {
    expect(parseBookingCodeFromLooseInput("alpha jay dash sea seven forty two")).toBe("AJ-C742");
  });

  it("returns null for garbage", () => {
    expect(parseBookingCodeFromLooseInput("hello there")).toBeNull();
  });
});
