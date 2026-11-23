import { getConfig } from "../common/config.js";
import { CustomError, MissingParamError } from "../common/error.js";
import { wrapTextMultiline } from "../common/fmt.js";
import { createGraphQLFetcher } from "../common/http.js";
import { logger } from "../common/log.js";
import {
  deduplicateRepoNodes,
  isRepoExcluded,
  parseOwnerAffiliations,
  resolveRepoOwners,
} from "../common/ops.js";
import { retryer } from "../common/retryer.js";
import {
  OwnerTopLanguagesDocument,
  TopLanguagesDocument,
} from "../graphql/generated/top-languages.js";
import type {
  OwnerTopLanguagesQueryVariables,
  TopLanguageFragment,
  TopLanguagesRepositoryFragment,
} from "../graphql/generated/top-languages.js";

import type { Lang, TopLangData } from "./types.js";

const fetcher = createGraphQLFetcher(TopLanguagesDocument, "token");
const ownerFetcher = createGraphQLFetcher(OwnerTopLanguagesDocument, "token");

const fetchOwnerTopLanguagesRepos = async (
  login: string,
  ownerAffiliations: OwnerTopLanguagesQueryVariables["ownerAffiliations"],
  pat: string | null,
): Promise<Array<TopLanguagesRepositoryFragment>> => {
  const res = await retryer(ownerFetcher, { login, ownerAffiliations }, pat);

  if (res.data.errors) {
    logger.error(res.data.errors);
    const firstError = res.data.errors[0];
    if (firstError?.message) {
      throw new CustomError(
        wrapTextMultiline(firstError.message, 525, 12)[0] ?? "",
        res.statusText,
      );
    }
    throw new CustomError(
      "Something went wrong while trying to retrieve the language data using the GraphQL API.",
      CustomError.GRAPHQL_ERROR,
    );
  }

  return (res.data.data.repositoryOwner?.repositories.nodes ?? []).filter(
    (node): node is TopLanguagesRepositoryFragment => node !== null,
  );
};

/**
 * Fetch top languages for a given username.
 *
 * @param username GitHub username.
 * @param exclude_repo List of repositories to exclude. Default: [].
 * @param size_weight Weightage to be given to size.
 * @param count_weight Weightage to be given to count.
 * @param ownerAffiliations The owner affiliations to filter by. Default: OWNER.
 * @param pat Optional PAT override.
 * @param repo_owners Additional repository owners (users or organizations) to aggregate languages from.
 * @returns Top languages data.
 */
const fetchTopLanguages = async (
  username: string,
  exclude_repo: Array<string> = [],
  size_weight = 1,
  count_weight = 0,
  ownerAffiliations: Array<string> = [],
  pat: string | null = null,
  repo_owners?: Array<string>,
): Promise<TopLangData> => {
  if (!username) {
    throw new MissingParamError(["username"]);
  }
  const affiliations = parseOwnerAffiliations(ownerAffiliations);

  const res = await retryer(
    fetcher,
    {
      login: username,
      ownerAffiliations: affiliations,
    },
    pat,
  );

  if (res.data.errors) {
    logger.error(res.data.errors);
    const firstError = res.data.errors[0];
    if (firstError?.type === "NOT_FOUND") {
      throw new CustomError(
        firstError.message || "Could not fetch user.",
        CustomError.USER_NOT_FOUND,
      );
    }
    if (firstError?.message) {
      throw new CustomError(
        wrapTextMultiline(firstError.message, 525, 12)[0] ?? "",
        res.statusText,
      );
    }
    throw new CustomError(
      "Something went wrong while trying to retrieve the language data using the GraphQL API.",
      CustomError.GRAPHQL_ERROR,
    );
  }

  const user = res.data.data.user;
  if (!user) {
    throw new CustomError("Could not fetch user.", CustomError.USER_NOT_FOUND);
  }

  const allExcludedRepos = [
    ...exclude_repo,
    ...getConfig().excludeRepositories,
  ];
  const repoToHide = new Set(allExcludedRepos);
  const repoToHideLower = new Set(
    allExcludedRepos.map((name) => name.toLowerCase()),
  );

  const primaryRepoNodes = (user.repositories.nodes ?? []).filter(
    (node): node is TopLanguagesRepositoryFragment => node !== null,
  );

  const extraOwners = resolveRepoOwners(
    repo_owners,
    getConfig().defaultRepoOwners,
    user.login || username,
  );
  let allRepoNodes: Array<TopLanguagesRepositoryFragment> = primaryRepoNodes;
  if (extraOwners.length > 0) {
    const extraOwnerRepos = await Promise.all(
      extraOwners.map((extraOwner) =>
        fetchOwnerTopLanguagesRepos(extraOwner, affiliations, pat),
      ),
    );
    allRepoNodes = deduplicateRepoNodes([
      ...primaryRepoNodes,
      ...extraOwnerRepos.flat(),
    ]);
  }

  // filter out repositories to be hidden
  const repoNodes = allRepoNodes.filter(
    (node) => !isRepoExcluded(node, repoToHide, repoToHideLower),
  );

  // flatten edges across repos. Order matters: `concat(acc)` prepends, and the
  // shared repoCount below depends on visitation order.
  const languageEdges = repoNodes.reduce<Array<TopLanguageFragment>>(
    (acc, repo) => {
      const edges = (repo.languages?.edges ?? []).filter(
        (edge): edge is TopLanguageFragment => !!edge,
      );
      return edges.length > 0 ? edges.concat(acc) : acc;
    },
    [],
  );

  // accumulate size and repo count per language
  const languageMap: Record<string, Lang> = {};
  let repoCount: number;
  for (const edge of languageEdges) {
    const existing = languageMap[edge.node.name];

    // same language seen again: add to its size and bump count; else reset to 1
    let langSize = edge.size;
    if (existing && edge.node.name === existing.name) {
      langSize = edge.size + existing.size;
      repoCount = existing.count + 1;
    } else {
      repoCount = 1;
    }
    languageMap[edge.node.name] = {
      name: edge.node.name,
      color: edge.node.color,
      size: langSize,
      count: repoCount,
    };
  }

  // comparison index calculation
  for (const lang of Object.values(languageMap)) {
    lang.size =
      Math.pow(lang.size, size_weight) * Math.pow(lang.count, count_weight);
  }

  // return languages sorted by (weighted) size, descending
  return Object.fromEntries(
    Object.entries(languageMap).sort(([, a], [, b]) => b.size - a.size),
  );
};

export { fetchTopLanguages };
