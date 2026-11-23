import nock from "nock";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfigFromEnv } from "../src/common/config.js";
import { fetchTopLanguages } from "../src/fetchers/top-languages.js";

import { approxNumber } from "./utils.js";

vi.mock(import("../src/common/log.js"), async () => {
  const { createLoggerMock } = await import("./utils.js");
  return createLoggerMock();
});

const { logger } = await import("../src/index.js");

const loggerErrorSpy = vi.mocked(logger.error);

afterEach(() => {
  loggerErrorSpy.mockClear();
});

const data_langs = {
  data: {
    user: {
      repositories: {
        nodes: [
          {
            name: "test-repo-1",
            nameWithOwner: "anuraghazra/test-repo-1",
            languages: {
              edges: [{ size: 100, node: { color: "#0f0", name: "HTML" } }],
            },
          },
          {
            name: "test-repo-2",
            nameWithOwner: "anuraghazra/test-repo-2",
            languages: {
              edges: [
                { size: 100, node: { color: "#0ff", name: "javascript" } },
              ],
            },
          },
          {
            name: "test-repo-3",
            nameWithOwner: "anuraghazra/test-repo-3",
            languages: {
              edges: [{ size: 100, node: { color: "#0f0", name: "HTML" } }],
            },
          },
          {
            name: "test-repo-4",
            nameWithOwner: "anuraghazra/test-repo-4",
            languages: {
              edges: [
                { size: 100, node: { color: "#0ff", name: "javascript" } },
              ],
            },
          },
        ],
      },
    },
  },
};

const error = {
  errors: [
    {
      type: "NOT_FOUND",
      path: ["user"],
      locations: [],
      message: "Could not resolve to a User with the login of 'noname'.",
    },
  ],
};

describe("FetchTopLanguages", () => {
  it("should fetch correct language data while using the new calculation", async () => {
    nock("https://api.github.com").post("/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", [], 0.5, 0.5);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 2,
        name: "HTML",
        size: approxNumber(20.0),
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: approxNumber(20.0),
      },
    });
  });

  it("should fetch correct language data while excluding the 'test-repo-1' repository", async () => {
    nock("https://api.github.com").post("/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", ["test-repo-1"]);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 1,
        name: "HTML",
        size: 100,
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: 200,
      },
    });
  });

  it("should fetch correct language data while using the old calculation", async () => {
    nock("https://api.github.com").post("/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", [], 1, 0);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 2,
        name: "HTML",
        size: 200,
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: 200,
      },
    });
  });

  it("should rank languages by the number of repositories they appear in", async () => {
    nock("https://api.github.com").post("/graphql").reply(200, data_langs);

    const repo = await fetchTopLanguages("anuraghazra", [], 0, 1);
    expect(repo).toStrictEqual({
      HTML: {
        color: "#0f0",
        count: 2,
        name: "HTML",
        size: 2,
      },
      javascript: {
        color: "#0ff",
        count: 2,
        name: "javascript",
        size: 2,
      },
    });
  });

  it("should throw specific error when user not found", async () => {
    nock("https://api.github.com").post("/graphql").reply(200, error);

    await expect(fetchTopLanguages("anuraghazra")).rejects.toThrow(
      "Could not resolve to a User with the login of 'noname'.",
    );

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
  });

  it("should throw other errors with their message", async () => {
    nock("https://api.github.com")
      .post("/graphql")
      .reply(200, {
        errors: [{ message: "Some test GraphQL error" }],
      });

    await expect(fetchTopLanguages("anuraghazra")).rejects.toThrow(
      "Some test GraphQL error",
    );

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
  });

  it("should throw error with specific message when error does not contain message property", async () => {
    nock("https://api.github.com")
      .post("/graphql")
      .reply(200, {
        errors: [{ type: "TEST" }],
      });

    await expect(fetchTopLanguages("anuraghazra")).rejects.toThrow(
      "Something went wrong while trying to retrieve the language data using the GraphQL API.",
    );

    expect(loggerErrorSpy).toHaveBeenCalledOnce();
  });

  it("should aggregate languages across additional repo_owners, deduplicate by nameWithOwner, and respect exclude_repo", async () => {
    const queriedOwners: Array<string> = [];
    const ownerResponses: Record<string, object> = {
      "org-a": {
        data: {
          repositoryOwner: {
            repositories: {
              nodes: [
                {
                  name: "test-repo-1",
                  nameWithOwner: "anuraghazra/test-repo-1",
                  languages: {
                    edges: [
                      { size: 100, node: { color: "#0f0", name: "HTML" } },
                    ],
                  },
                },
                {
                  name: "org-ts",
                  nameWithOwner: "org-a/org-ts",
                  languages: {
                    edges: [
                      {
                        size: 300,
                        node: { color: "#3178c6", name: "TypeScript" },
                      },
                    ],
                  },
                },
                {
                  name: "excluded-org-repo",
                  nameWithOwner: "org-a/excluded-org-repo",
                  languages: {
                    edges: [
                      { size: 900, node: { color: "#dea584", name: "Rust" } },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
      "org-b": {
        data: {
          repositoryOwner: {
            repositories: {
              nodes: [
                {
                  name: "org-ts",
                  nameWithOwner: "ORG-A/org-ts",
                  languages: {
                    edges: [
                      {
                        size: 300,
                        node: { color: "#3178c6", name: "TypeScript" },
                      },
                    ],
                  },
                },
                {
                  name: "archive-py",
                  nameWithOwner: "org-b/archive-py",
                  languages: {
                    edges: [
                      { size: 250, node: { color: "#3572A5", name: "Python" } },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };

    nock.cleanAll();
    nock("https://api.github.com")
      .persist()
      .post("/graphql")
      .reply(async (request: Request) => {
        const req = (await request.json()) as {
          query: string;
          variables: { login: string };
        };
        if (req.query.includes("query ownerTopLanguages(")) {
          queriedOwners.push(req.variables.login);
          return [
            200,
            ownerResponses[req.variables.login.toLowerCase()] ?? {
              data: { repositoryOwner: null },
            },
          ];
        }
        return [200, data_langs];
      });

    const langs = await fetchTopLanguages(
      "anuraghazra",
      ["test-repo-1", "org-a/excluded-org-repo"],
      1,
      0,
      [],
      null,
      ["org-a", "ORG-A", "anuraghazra", " org-b "],
    );

    expect(queriedOwners).toEqual(["org-a", "org-b"]);
    expect(langs).toStrictEqual({
      TypeScript: { color: "#3178c6", count: 1, name: "TypeScript", size: 300 },
      Python: { color: "#3572A5", count: 1, name: "Python", size: 250 },
      javascript: { color: "#0ff", count: 2, name: "javascript", size: 200 },
      HTML: { color: "#0f0", count: 1, name: "HTML", size: 100 },
    });
  });

  it("should fall back to DEFAULT_REPO_OWNERS from env config when repo_owners is omitted", async () => {
    loadConfigFromEnv({
      ...process.env,
      DEFAULT_REPO_OWNERS: "org-a, anuraghazra",
    });

    const queriedOwners: Array<string> = [];
    nock.cleanAll();
    nock("https://api.github.com")
      .persist()
      .post("/graphql")
      .reply(async (request: Request) => {
        const req = (await request.json()) as {
          query: string;
          variables: { login: string };
        };
        if (req.query.includes("query ownerTopLanguages(")) {
          queriedOwners.push(req.variables.login);
          return [
            200,
            {
              data: {
                repositoryOwner: {
                  repositories: {
                    nodes: [
                      {
                        name: "org-go",
                        nameWithOwner: "org-a/org-go",
                        languages: {
                          edges: [
                            {
                              size: 500,
                              node: { color: "#00ADD8", name: "Go" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ];
        }
        return [200, data_langs];
      });

    try {
      const langs = await fetchTopLanguages("anuraghazra");
      expect(queriedOwners).toEqual(["org-a"]);
      expect(langs["Go"]).toStrictEqual({
        color: "#00ADD8",
        count: 1,
        name: "Go",
        size: 500,
      });
    } finally {
      loadConfigFromEnv();
    }
  });
});
