// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildJoinUrl } from "./buildJoinUrl";

const PHRASE = "ability about above absent absorb abstract";
const EXPECTED_HASH = "#ability-about-above-absent-absorb-abstract";

describe("buildJoinUrl", () => {
  const ORIGINAL_LOCATION = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: ORIGINAL_LOCATION,
    });
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, origin: "https://void.example.com" },
    });
  });

  it("composes origin + BASE_URL + phrase hash into a full join URL", () => {
    const url = buildJoinUrl(PHRASE);
    expect(url.startsWith("https://void.example.com")).toBe(true);
    expect(url.endsWith(EXPECTED_HASH)).toBe(true);
  });

  it("normalizes the phrase (case + whitespace) into the hash exactly like phraseToHash", () => {
    expect(buildJoinUrl("ABILITY  ABOUT above absent absorb abstract")).toBe(
      buildJoinUrl(PHRASE),
    );
  });
});
