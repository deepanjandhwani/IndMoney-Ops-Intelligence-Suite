import { describe, expect, it } from "vitest";

import {
  classifySchedulerIntent,
  looksLikeScheduleDatePreference
} from "../src/services/scheduler/topics";

describe("looksLikeScheduleDatePreference", () => {
  it("detects month names and ordinals", () => {
    expect(looksLikeScheduleDatePreference("any slots from 30th may")).toBe(true);
    expect(looksLikeScheduleDatePreference("may 30 morning")).toBe(true);
  });

  it("detects weekdays and relative days", () => {
    expect(looksLikeScheduleDatePreference("slots for tomorrow")).toBe(true);
    expect(looksLikeScheduleDatePreference("monday afternoon")).toBe(true);
  });

  it("returns false for generic browse phrasing", () => {
    expect(looksLikeScheduleDatePreference("what slots do you have")).toBe(false);
    expect(looksLikeScheduleDatePreference("show slots")).toBe(false);
  });
});

describe("classifySchedulerIntent — slots vs browse", () => {
  it("treats slots + date cue as unclear (not check_availability)", () => {
    expect(classifySchedulerIntent("Any slots from 30th May")).toBe("unclear");
    expect(classifySchedulerIntent("any slots for tomorrow?")).toBe("unclear");
  });

  it("keeps generic slot browsing as check_availability", () => {
    expect(classifySchedulerIntent("what slots are available")).toBe("check_availability");
    expect(classifySchedulerIntent("free slots")).toBe("check_availability");
  });

  it("still classifies explicit availability wording", () => {
    expect(classifySchedulerIntent("check availability")).toBe("check_availability");
    expect(classifySchedulerIntent("are you available Tuesday")).toBe("check_availability");
  });
});
