import { describe, expect, it } from "vitest";

import { getConfig, loadConfigFromEnv } from "../src/common/config.js";
import {
  MAX_ADDITIONAL_REPO_OWNERS,
  chunkArray,
  clampValue,
  isRepoExcluded,
  lowercaseTrim,
  normalizeRepoOwners,
  parseArray,
  parseBoolean,
  parseEmojis,
} from "../src/common/ops.js";

describe("Test ops.js", () => {
  it("should test parseBoolean", () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);

    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("True")).toBe(true);
    expect(parseBoolean("False")).toBe(false);
    expect(parseBoolean("TRUE")).toBe(true);
    expect(parseBoolean("FALSE")).toBe(false);

    expect(parseBoolean("1")).toBe(undefined);
    expect(parseBoolean("0")).toBe(undefined);
    expect(parseBoolean("")).toBe(undefined);
    expect(parseBoolean(undefined)).toBe(undefined);
  });

  it("should test parseArray", () => {
    expect(parseArray("a,b,c")).toEqual(["a", "b", "c"]);
    expect(parseArray("a, b, c")).toEqual(["a", " b", " c"]); // preserves spaces
    expect(parseArray("")).toEqual([]);
    // @ts-expect-error testing invalid input
    expect(parseArray(undefined)).toEqual([]);
  });

  it("should test clampValue", () => {
    expect(clampValue(5, 1, 10)).toBe(5);
    expect(clampValue(0, 1, 10)).toBe(1);
    expect(clampValue(15, 1, 10)).toBe(10);

    // string inputs are coerced numerically by Math.min/Math.max
    expect(clampValue("7", 1, 10)).toBe(7);

    // non-numeric and NaN fall back to min
    expect(clampValue("abc", 1, 10)).toBe(1);
    expect(clampValue(NaN, 2, 5)).toBe(2);
  });

  it("should test lowercaseTrim", () => {
    expect(lowercaseTrim("  Hello World  ")).toBe("hello world");
    expect(lowercaseTrim("already lower")).toBe("already lower");
  });

  it("should test chunkArray", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([1, 2, 3, 4, 5], 1)).toEqual([[1], [2], [3], [4], [5]]);
    expect(chunkArray([1, 2, 3, 4, 5], 10)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("should test parseEmojis", () => {
    // unknown emoji name is stripped
    expect(parseEmojis("Hello :nonexistent:")).toBe("Hello ");
    // common emoji names should be replaced (at least token removed)
    const out = parseEmojis("I :heart: OSS");
    expect(out).not.toContain(":heart:");
    expect(out.startsWith("I ")).toBe(true);
    expect(out.endsWith(" OSS")).toBe(true);

    expect(() => parseEmojis("")).toThrow(/parseEmoji/);
    // @ts-expect-error testing missing argument
    expect(() => parseEmojis()).toThrow(/parseEmoji/);
  });

  it("should cap normalizeRepoOwners at MAX_ADDITIONAL_REPO_OWNERS while preserving caller order", () => {
    const owners = Array.from({ length: 15 }, (_, index) => `org-${index + 1}`);
    const result = normalizeRepoOwners(
      ["primary-user", "org-2", ...owners],
      "PRIMARY-USER",
    );

    expect(result).toHaveLength(MAX_ADDITIONAL_REPO_OWNERS);
    expect(result).toEqual([
      "org-2",
      "org-1",
      "org-3",
      "org-4",
      "org-5",
      "org-6",
      "org-7",
      "org-8",
      "org-9",
      "org-10",
    ]);
  });

  it("should match short repo names and nameWithOwner case-insensitively in isRepoExcluded", () => {
    const excluded = new Set(["MyRepo", "Org-A/Secret"]);
    const excludedLower = new Set(["myrepo", "org-a/secret"]);

    expect(
      isRepoExcluded(
        { name: "myrepo", nameWithOwner: "alice/myrepo" },
        excluded,
        excludedLower,
      ),
    ).toBe(true);
    expect(
      isRepoExcluded(
        { name: "secret", nameWithOwner: "org-a/SECRET" },
        excluded,
        excludedLower,
      ),
    ).toBe(true);
    expect(
      isRepoExcluded(
        { name: "other", nameWithOwner: "alice/other" },
        excluded,
        excludedLower,
      ),
    ).toBe(false);
  });

  it("should trim and filter empty CSV entries in loadConfigFromEnv", () => {
    try {
      loadConfigFromEnv({
        WHITELIST: " alice , , bob , ",
        GIST_WHITELIST: " , , ",
        EXCLUDE_REPO: " repo-a , , org/repo-b ",
        DEFAULT_REPO_OWNERS: " org-a , , org-b ",
      });
      const config = getConfig();
      expect(config.whitelist).toEqual(["alice", "bob"]);
      expect(config.gistWhitelist).toBeUndefined();
      expect(config.excludeRepositories).toEqual(["repo-a", "org/repo-b"]);
      expect(config.defaultRepoOwners).toEqual(["org-a", "org-b"]);
    } finally {
      loadConfigFromEnv();
    }
  });
});
