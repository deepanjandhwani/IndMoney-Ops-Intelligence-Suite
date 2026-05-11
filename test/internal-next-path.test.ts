import { describe, expect, it } from "vitest";
import { safeInternalNextPath } from "@/lib/internal-next-path";

describe("safeInternalNextPath", () => {
  it("allows simple internal paths", () => {
    expect(safeInternalNextPath("/customer/faq", "/admin")).toBe("/customer/faq");
  });

  it("uses fallback when next is null", () => {
    expect(safeInternalNextPath(null, "/admin")).toBe("/admin");
  });

  it("rejects scheme-relative URLs", () => {
    expect(safeInternalNextPath("//evil.com/phish", "/admin")).toBe("/admin");
  });

  it("rejects non-path values", () => {
    expect(safeInternalNextPath("https://evil.com", "/admin")).toBe("/admin");
  });
});
