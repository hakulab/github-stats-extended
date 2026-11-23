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

vi.mock(import("@stats-organization/github-readme-stats-core"), async () => {
  const { mockCore } = await import("./utils.js");
  return {
    ...mockCore(),
    loadConfigFromEnv: vi.fn(),
  };
});

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
  getConfigMock.mockReset().mockReturnValue({});
  loadConfigFromEnvMock.mockReset();
  storeRequestMock.mockReset().mockResolvedValue(undefined);
  getUserAccessByNameMock.mockReset().mockResolvedValue(null);
  delete process.env.CACHE_SECONDS;
  delete process.env.OAUTH_CLIENT_ID;
  delete process.env.OAUTH_CLIENT_SECRET;
  delete process.env.OAUTH_REDIRECT_URI;
});

afterEach(() => {
  axios.defaults.adapter = savedAdapter;
});

describe("Cloudflare Workers fetch adapter", () => {
  it("bridges /api requests, loads string env bindings, and returns SVG response", async () => {
    apiMock.mockResolvedValue({
      status: "success",
      content: "<svg>stats</svg>",
    });

    const request = new Request(
      "https://github-stats.hakula.xyz/api?username=hakula139&theme=dark",
    );
    const response = await worker.fetch(request, {
      PAT_1: "ghp_test_token",
      WHITELIST: "hakula139",
      CACHE_SECONDS: "3600",
      NON_STRING_BINDING: { ignored: true },
    });

    expect(axios.defaults.adapter).toBe("fetch");
    expect(loadConfigFromEnvMock).toHaveBeenCalledWith({
      PAT_1: "ghp_test_token",
      WHITELIST: "hakula139",
      CACHE_SECONDS: "3600",
    });
    expect(apiMock).toHaveBeenCalledWith(
      { username: "hakula139", theme: "dark" },
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
      new Request("https://github-stats.hakula.xyz/api?username=hakula139"),
      { CACHE_SECONDS: "120" },
    );
    expect(process.env.CACHE_SECONDS).toBe("120");

    const response = await handleWorkerRequest(
      new Request("https://github-stats.hakula.xyz/api?username=hakula139"),
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
      new Request(
        "https://github-stats.hakula.xyz/api/top-langs/?username=hakula139",
      ),
      {},
    );

    expect(topLangsMock).toHaveBeenCalledWith({ username: "hakula139" }, null);
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
      new Request(
        "https://github-stats.hakula.xyz/api/pin?username=hakula139&repo=demo",
      ),
      {},
    );
    expect(pinRes.status).toBe(200);
    expect(await pinRes.text()).toBe("<svg>pin</svg>");

    const gistRes = await worker.fetch(
      new Request("https://github-stats.hakula.xyz/api/gist?id=abc123"),
      {},
    );
    expect(gistRes.status).toBe(200);
    expect(await gistRes.text()).toBe("<svg>gist</svg>");

    const wakaRes = await worker.fetch(
      new Request(
        "https://github-stats.hakula.xyz/api/wakatime?username=hakula139",
      ),
      {},
    );
    expect(wakaRes.status).toBe(200);
    expect(await wakaRes.text()).toBe("<svg>wakatime</svg>");
  });

  it("serializes JSON objects sent via res.send", async () => {
    const response = await worker.fetch(
      new Request("https://github-stats.hakula.xyz/api/repeat-recent", {
        method: "GET",
      }),
      {},
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ error: "Method Not Allowed" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch(
      new Request("https://github-stats.hakula.xyz/unknown"),
      {},
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });
});
