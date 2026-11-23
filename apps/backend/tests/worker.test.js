// @ts-check

import {
  api,
  getConfig,
  gist,
  loadConfigFromEnv,
  pin,
  topLangs,
  wakatime,
} from "@stats-organization/github-readme-stats-core";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_TTL, DURATIONS } from "../src/common/cache.js";
import { getUserAccessByName, storeRequest } from "../src/common/database.js";
import worker, { handleWorkerRequest } from "../src/worker.ts";

vi.mock(
  import("@stats-organization/github-readme-stats-core"),
  async (importOriginal) => {
    const actual = await importOriginal();
    const { mockCore } = await import("./utils.js");
    return {
      ...mockCore(),
      normalizeRepoOwners: actual.normalizeRepoOwners,
      loadConfigFromEnv: vi.fn(),
    };
  },
);

vi.mock(import("../src/common/database.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  storeRequest: vi.fn(),
  getUserAccessByName: vi.fn(),
}));

const apiMock = vi.mocked(api);
const gistMock = vi.mocked(gist);
const pinMock = vi.mocked(pin);
const topLangsMock = vi.mocked(topLangs);
const wakatimeMock = vi.mocked(wakatime);
const getConfigMock = vi.mocked(getConfig);
const loadConfigFromEnvMock = vi.mocked(loadConfigFromEnv);
const storeRequestMock = vi.mocked(storeRequest);
const getUserAccessByNameMock = vi.mocked(getUserAccessByName);

const defaultStatsCacheHeader =
  `max-age=${CACHE_TTL.STATS_CARD.DEFAULT}, ` +
  `s-maxage=${CACHE_TTL.STATS_CARD.DEFAULT}, ` +
  `stale-while-revalidate=${DURATIONS.ONE_DAY}`;

const savedAdapter = axios.defaults.adapter;

beforeEach(() => {
  apiMock.mockReset();
  gistMock.mockReset();
  pinMock.mockReset();
  topLangsMock.mockReset();
  wakatimeMock.mockReset();
  getConfigMock.mockReset().mockReturnValue({ defaultRepoOwners: [] });
  loadConfigFromEnvMock.mockReset();
  storeRequestMock.mockReset().mockResolvedValue(undefined);
  getUserAccessByNameMock.mockReset().mockResolvedValue(null);
  delete process.env.CACHE_SECONDS;
  Reflect.deleteProperty(globalThis, "caches");
});

afterEach(() => {
  axios.defaults.adapter = savedAdapter;
  Reflect.deleteProperty(globalThis, "caches");
});

describe("Cloudflare Workers fetch adapter", () => {
  it("bridges /api requests, loads string env bindings, and returns SVG response", async () => {
    apiMock.mockResolvedValue({
      status: "success",
      content: "<svg>stats</svg>",
    });

    const request = new Request(
      "https://stats.example.com/api?username=alice&theme=dark",
    );
    const response = await worker.fetch(request, {
      PAT_1: "ghp_test_token",
      WHITELIST: "alice",
      CACHE_SECONDS: "3600",
      NON_STRING_BINDING: { ignored: true },
    });

    expect(axios.defaults.adapter).toBe("fetch");
    expect(loadConfigFromEnvMock).toHaveBeenCalledWith({
      PAT_1: "ghp_test_token",
      WHITELIST: "alice",
      CACHE_SECONDS: "3600",
    });
    expect(apiMock).toHaveBeenCalledWith(
      { username: "alice", theme: "dark" },
      null,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe(
      `max-age=3600, s-maxage=3600, stale-while-revalidate=${DURATIONS.ONE_DAY}`,
    );
    expect(await response.text()).toBe("<svg>stats</svg>");
  });

  it("clears bridged process.env keys when omitted on a subsequent request", async () => {
    apiMock.mockResolvedValue({
      status: "success",
      content: "<svg>stats</svg>",
    });

    await handleWorkerRequest(
      new Request("https://stats.example.com/api?username=alice"),
      { CACHE_SECONDS: "120" },
    );
    expect(process.env.CACHE_SECONDS).toBe("120");

    const response = await handleWorkerRequest(
      new Request("https://stats.example.com/api?username=alice"),
      {},
    );
    expect(process.env.CACHE_SECONDS).toBeUndefined();
    expect(response.headers.get("Cache-Control")).toBe(defaultStatsCacheHeader);
  });

  it("strips trailing slashes on card routes", async () => {
    topLangsMock.mockResolvedValue({
      status: "success",
      content: "<svg>top-langs</svg>",
    });

    const response = await worker.fetch(
      new Request("https://stats.example.com/api/top-langs/?username=alice"),
      {},
    );

    expect(topLangsMock).toHaveBeenCalledWith({ username: "alice" }, null);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await response.text()).toBe("<svg>top-langs</svg>");
  });

  it("routes /api/pin, /api/gist, and /api/wakatime", async () => {
    pinMock.mockResolvedValue({ status: "success", content: "<svg>pin</svg>" });
    gistMock.mockResolvedValue({
      status: "success",
      content: "<svg>gist</svg>",
    });
    wakatimeMock.mockResolvedValue({
      status: "success",
      content: "<svg>wakatime</svg>",
    });

    const pinRes = await worker.fetch(
      new Request("https://stats.example.com/api/pin?username=alice&repo=demo"),
      {},
    );
    expect(pinRes.status).toBe(200);
    expect(await pinRes.text()).toBe("<svg>pin</svg>");

    const gistRes = await worker.fetch(
      new Request("https://stats.example.com/api/gist?id=abc123"),
      {},
    );
    expect(gistRes.status).toBe(200);
    expect(await gistRes.text()).toBe("<svg>gist</svg>");

    const wakaRes = await worker.fetch(
      new Request("https://stats.example.com/api/wakatime?username=alice"),
      {},
    );
    expect(wakaRes.status).toBe(200);
    expect(await wakaRes.text()).toBe("<svg>wakatime</svg>");
  });

  it("returns 404 for non-card backend routes and protocol-relative paths", async () => {
    for (const url of [
      "https://stats.example.com/api/status/pat-info",
      "https://stats.example.com/api/wakatime-proxy",
      "https://stats.example.com/api/repeat-recent",
      "https://stats.example.com/api/authenticate",
      "https://stats.example.com/api/user-access",
      "https://stats.example.com/api/delete-user",
      "https://stats.example.com/api/downgrade",
      "https://stats.example.com//evil.com/api?username=alice",
      "https://stats.example.com/unknown",
    ]) {
      const response = await worker.fetch(new Request(url), {});
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    }
  });

  it("normalizes repeated repo_owners and repo-owners query params for routing and caching", async () => {
    apiMock.mockResolvedValue({
      status: "success",
      content: "<svg>stats</svg>",
    });

    const response = await worker.fetch(
      new Request(
        "https://stats.example.com/api?username=alice&repo_owners=Org-B,alice&repo-owners=Org-A,ORG-B",
      ),
      { DEFAULT_REPO_OWNERS: "org-a,org-b" },
    );

    expect(loadConfigFromEnvMock).toHaveBeenCalledWith({
      DEFAULT_REPO_OWNERS: "org-a,org-b",
    });
    expect(apiMock).toHaveBeenCalledWith(
      { username: "alice", repo_owners: "org-b,org-a" },
      null,
    );
    expect(storeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api?username=alice&repo_owners=org-b%2Corg-a",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("uses caches.default with a canonical GET key, stores via waitUntil, and serves HEAD with an empty body", async () => {
    const store = new Map();
    const match = vi.fn(async (req) => store.get(req.url)?.clone());
    const put = vi.fn(async (req, res) => {
      store.set(req.url, res.clone());
    });
    Object.defineProperty(globalThis, "caches", {
      value: { default: { match, put } },
      configurable: true,
    });

    const waitUntilPromises = [];
    const ctx = {
      waitUntil: vi.fn((promise) => {
        waitUntilPromises.push(promise);
      }),
    };

    getConfigMock.mockReturnValue({ defaultRepoOwners: ["org-z", "org-a"] });
    apiMock.mockResolvedValue({
      status: "success",
      content: "<svg>cached-stats</svg>",
    });

    const first = await worker.fetch(
      new Request(
        "https://stats.example.com/api?theme=dark&username=Alice&repo_owners=Org-B,org-a",
      ),
      {},
      ctx,
    );
    await Promise.all(waitUntilPromises);

    expect(first.status).toBe(200);
    expect(await first.text()).toBe("<svg>cached-stats</svg>");
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0].url).toBe(
      "https://stats.example.com/api?repo_owners=org-a%2Corg-b&theme=dark&username=alice",
    );

    const second = await worker.fetch(
      new Request(
        "https://stats.example.com/api?username=alice&repo-owners=org-a&repo_owners=ORG-B&theme=dark",
      ),
      {},
      ctx,
    );
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("<svg>cached-stats</svg>");
    expect(apiMock).toHaveBeenCalledTimes(1);

    const headRes = await worker.fetch(
      new Request(
        "https://stats.example.com/api?theme=dark&username=ALICE&repo_owners=org-b,org-a",
        { method: "HEAD" },
      ),
      {},
      ctx,
    );
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await headRes.text()).toBe("");
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes defaultRepoOwners into the edge cache key when repo_owners is omitted", async () => {
    const store = new Map();
    const match = vi.fn(async (req) => store.get(req.url)?.clone());
    const put = vi.fn(async (req, res) => {
      store.set(req.url, res.clone());
    });
    Object.defineProperty(globalThis, "caches", {
      value: { default: { match, put } },
      configurable: true,
    });

    getConfigMock.mockReturnValue({
      defaultRepoOwners: ["Org-Z", "alice", "org-a"],
    });
    apiMock.mockResolvedValue({
      status: "success",
      content: "<svg>default-owners</svg>",
    });

    await worker.fetch(
      new Request("https://stats.example.com/api?username=Alice"),
      {},
    );

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0].url).toBe(
      "https://stats.example.com/api?repo_owners=org-a%2Corg-z&username=alice",
    );
  });

  it("matches WHITELIST case-insensitively with trimmed entries", async () => {
    getConfigMock.mockReturnValue({
      whitelist: ["Alice", "Bob"],
      defaultRepoOwners: [],
    });
    apiMock.mockResolvedValue({
      status: "success",
      content: "<svg>allowed</svg>",
    });

    const allowed = await worker.fetch(
      new Request("https://stats.example.com/api?username=ALICE"),
      {},
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("<svg>allowed</svg>");
    expect(apiMock).toHaveBeenCalledTimes(1);

    const denied = await worker.fetch(
      new Request("https://stats.example.com/api?username=charlie"),
      {},
    );
    expect(denied.status).toBe(200);
    expect(await denied.text()).toBe(
      "render-error:This username is not whitelisted",
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
