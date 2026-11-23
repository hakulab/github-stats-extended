import toEmoji from "emoji-name-map";

import type { RepositoryAffiliation } from "../graphql/generated/common.js";

import { OWNER_AFFILIATIONS } from "./constants.js";
import { CustomError } from "./error.js";

/**
 * Returns boolean if value is either "true" or "false" else the value as it is.
 *
 * @param value The value to parse; `undefined` when the param was not sent.
 * @returns The parsed value.
 */
const parseBoolean = (
  value: string | boolean | undefined,
): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    } else if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return undefined;
};

/**
 * Parse string to array of strings.
 *
 * @param str The string to parse.
 * @returns The array of strings.
 */
const parseArray = (str: string): Array<string> => {
  if (!str) {
    return [];
  }
  return str.split(",");
};

/**
 * Clamp the given number between the given range.
 *
 * @param number The number to clamp.
 * @param min The minimum value.
 * @param max The maximum value.
 * @returns The clamped number.
 */
const clampValue = (
  number: string | number,
  min: number,
  max: number,
): number => {
  if (Number.isNaN(parseInt(String(number), 10))) {
    return min;
  }
  return Math.max(min, Math.min(Number(number), max));
};

/**
 * Lowercase and trim string.
 *
 * @param name String to lowercase and trim.
 * @returns Lowercased and trimmed string.
 */
const lowercaseTrim = (name: string): string => name.toLowerCase().trim();

/**
 * Split array of languages in two columns.
 *
 * @template T Language object.
 * @param arr Array of languages.
 * @param perChunk Number of languages per column.
 * @returns Array of languages split in two columns.
 */
const chunkArray = <T>(arr: Array<T>, perChunk: number): Array<Array<T>> => {
  return arr.reduce<Array<Array<T>>>((resultArray, item, index) => {
    const chunkIndex = Math.floor(index / perChunk);
    const chunk = resultArray[chunkIndex] ?? [];
    chunk.push(item);
    resultArray[chunkIndex] = chunk;
    return resultArray;
  }, []);
};

/**
 * Parse emoji from string.
 *
 * @param str String to parse emoji from.
 * @returns String with emoji parsed.
 */
const parseEmojis = (str: string): string => {
  if (!str) {
    throw new Error("[parseEmoji]: str argument not provided");
  }
  return str.replace(/:\w+:/gm, (emoji) => {
    return toEmoji.get(emoji) || "";
  });
};

const isOwnerAffiliation = (value: string): value is RepositoryAffiliation =>
  OWNER_AFFILIATIONS.some((affiliation) => affiliation === value);

/**
 * Parse owner affiliations.
 *
 * @param affiliations input affiliations to be parsed.
 * @returns Parsed affiliations.
 *
 * @throws {CustomError} If affiliations contains invalid values.
 */
const parseOwnerAffiliations = (
  affiliations: Array<string>,
): Array<RepositoryAffiliation> => {
  // Set default value for ownerAffiliations.
  // NOTE: Done here since parseArray() will always return an empty array even nothing
  //was specified.
  const normalized =
    affiliations.length > 0
      ? affiliations.map((affiliation) => affiliation.toUpperCase())
      : ["OWNER"];

  // Check if ownerAffiliations contains valid values.
  if (!normalized.every(isOwnerAffiliation)) {
    throw new CustomError(
      "Invalid query parameter",
      CustomError.INVALID_AFFILIATION,
    );
  }
  return normalized;
};

const buildSearchFilter = (
  repos: Array<string> | string = [],
  owners: Array<string> | string = [],
): string => {
  const repoFilter =
    Array.isArray(repos) && repos.length > 0
      ? repos.map((r) => `repo:${r} `).join("")
      : "";
  const orgFilter =
    Array.isArray(owners) && owners.length > 0
      ? owners.map((o) => `owner:${o} `).join("")
      : "";
  return repoFilter + orgFilter;
};

/**
 * Maximum number of additional repository owners aggregated alongside the primary user.
 */
const MAX_ADDITIONAL_REPO_OWNERS = 10;

/**
 * Normalize, trim, deduplicate case-insensitively, and cap repository owner logins,
 * optionally excluding a primary username that is already fetched.
 *
 * @param owners Raw owner login list.
 * @param primaryUsername Optional primary username to omit from extra owners.
 * @returns Deduplicated, trimmed owner logins preserving first-seen order, capped at `MAX_ADDITIONAL_REPO_OWNERS`.
 */
const normalizeRepoOwners = (
  owners: Array<string>,
  primaryUsername?: string,
): Array<string> => {
  const seen = new Set<string>();
  if (primaryUsername) {
    seen.add(lowercaseTrim(primaryUsername));
  }

  const normalized: Array<string> = [];
  for (const rawOwner of owners) {
    const trimmed = rawOwner.trim();
    if (!trimmed) {
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    normalized.push(trimmed);
    if (normalized.length >= MAX_ADDITIONAL_REPO_OWNERS) {
      break;
    }
  }

  return normalized;
};

/**
 * Resolve effective extra repository owners from explicit param values or
 * `DEFAULT_REPO_OWNERS` / `REPO_OWNERS` env config, normalized and deduplicated.
 *
 * @param explicitOwners Explicit owner logins passed via query/argument, or `undefined` to use env default.
 * @param defaultOwners Default owner logins from runtime config.
 * @param primaryUsername Primary username already queried.
 * @returns Normalized extra owner logins.
 */
const resolveRepoOwners = (
  explicitOwners: Array<string> | undefined,
  defaultOwners: Array<string>,
  primaryUsername: string,
): Array<string> => {
  const source = explicitOwners ?? defaultOwners;
  return normalizeRepoOwners(source, primaryUsername);
};

/**
 * Check whether a repository matches an exclusion set by either short `name`
 * or full `nameWithOwner` (case-insensitive when `excludedLower` is supplied).
 *
 * @param repo Repository to check.
 * @param repo.name Short repository name.
 * @param repo.nameWithOwner Optional `owner/repo` full name.
 * @param excluded Exact repo names and `owner/repo` entries to exclude.
 * @param excludedLower Optional lowercased exclusion set for case-insensitive matching.
 * @returns True if the repository should be excluded.
 */
const isRepoExcluded = (
  repo: { name: string; nameWithOwner?: string | null },
  excluded: ReadonlySet<string>,
  excludedLower?: ReadonlySet<string>,
): boolean => {
  if (excluded.has(repo.name) || excludedLower?.has(repo.name.toLowerCase())) {
    return true;
  }
  if (repo.nameWithOwner) {
    if (excluded.has(repo.nameWithOwner)) {
      return true;
    }
    if (excludedLower?.has(repo.nameWithOwner.toLowerCase())) {
      return true;
    }
  }
  return false;
};

/**
 * Deduplicate repositories by `nameWithOwner` (case-insensitive), falling back
 * to `name` when `nameWithOwner` is absent in legacy fixtures.
 *
 * @param repos Repository nodes to deduplicate.
 * @returns Deduplicated repository nodes preserving first-seen order.
 */
const deduplicateRepoNodes = <
  T extends { name: string; nameWithOwner?: string | null },
>(
  repos: Array<T>,
): Array<T> => {
  const seen = new Set<string>();
  const unique: Array<T> = [];
  for (const repo of repos) {
    const key = (repo.nameWithOwner || repo.name).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(repo);
  }
  return unique;
};

export {
  MAX_ADDITIONAL_REPO_OWNERS,
  parseBoolean,
  parseArray,
  clampValue,
  lowercaseTrim,
  chunkArray,
  parseEmojis,
  parseOwnerAffiliations,
  buildSearchFilter,
  normalizeRepoOwners,
  resolveRepoOwners,
  isRepoExcluded,
  deduplicateRepoNodes,
};
