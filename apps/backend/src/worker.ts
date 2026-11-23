import {
  getConfig,
  loadConfigFromEnv,
  normalizeRepoOwners,
} from "@stats-organization/github-readme-stats-core";
import axios from "axios";

import router from "../router.js";
import type { RouterRequest, RouterResponse } from "../router.js";

/**
 * Env vars read by backend modules through `process.env` at request time.
 * `loadConfigFromEnv(env)` covers core's config (`WHITELIST`, `GIST_WHITELIST`,
 * `EXCLUDE_REPO`, `DEFAULT_REPO_OWNERS`, `REPO_OWNERS`, `FETCH_MULTI_PAGE_STARS`,
 * `PAT_*`). `CACHE_SECONDS` is read directly by backend cache helpers.
 */
const BRIDGED_PROCESS_ENV_KEYS = ["CACHE_SECONDS"];

const CARD_ROUTES = new Set([
  "/api",
  "/api/top-langs",
  "/api/pin",
  "/api/gist",
  "/api/wakatime",
]);

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/**
 * Returns Cloudflare's default edge cache when available in the runtime.
 *
 * @returns Default `Cache` instance or `undefined` outside Workers.
 */
function getDefaultCache(): WorkerCache | undefined {
  const cachesObj = (globalThis as { caches?: { default?: WorkerCache } })
    .caches;
  return cachesObj?.default;
}

/**
 * Normalizes a Workers `env` binding map to string values suitable for
 * `loadConfigFromEnv` and `process.env`.
 *
 * @param env Cloudflare Workers environment bindings.
 * @returns String-only environment map.
 */
function extractStringEnv(
  env: Record<string, unknown>,
): Record<string, string | undefined> {
  const stringEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      stringEnv[key] = value;
    }
  }
  return stringEnv;
}

/**
 * Applies per-request Workers bindings to core config and bridged `process.env` keys.
 *
 * @param env Cloudflare Workers environment bindings.
 */
function applyWorkerEnv(env: Record<string, unknown>): void {
  const stringEnv = extractStringEnv(env);
  loadConfigFromEnv(stringEnv);

  for (const key of BRIDGED_PROCESS_ENV_KEYS) {
    const value = stringEnv[key];
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Normalizes a Node-style response payload into a Web `BodyInit` value and
 * sets a default `Content-Type` when Express's `res.send` would have done so.
 *
 * @param payload Body passed to `res.send` or `res.end`.
 * @param headers Response headers map to inspect/update.
 * @returns Normalized response body.
 */
function normalizeBody(
  payload: unknown,
  headers: Headers,
): string | Uint8Array | null {
  if (payload === undefined || payload === null) {
    return null;
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return JSON.stringify(payload);
}

/**
 * Builds a canonical `GET` cache key URL with sorted query parameters,
 * lowercased `username`, and canonicalized, alphabetically sorted `repo_owners`.
 *
 * @param origin Request origin.
 * @param pathname Normalized card route pathname.
 * @param searchParams Incoming query parameters.
 * @param defaultRepoOwners Default extra owners from config.
 * @returns Canonical query map, router search string, and edge cache key `Request`.
 */
function canonicalizeRequest(
  origin: string,
  pathname: string,
  searchParams: URLSearchParams,
  defaultRepoOwners: Array<string>,
): {
  query: Record<string, string>;
  routerSearch: string;
  cacheKey: Request;
} {
  const query = Object.fromEntries(searchParams.entries());
  const rawRepoOwnerValues = [
    ...searchParams.getAll("repo_owners"),
    ...searchParams.getAll("repo-owners"),
  ];
  const hasExplicitRepoOwners = rawRepoOwnerValues.length > 0;

  const routerParams = new URLSearchParams(searchParams);
  routerParams.delete("repo-owners");

  let canonicalOwners: Array<string>;
  if (hasExplicitRepoOwners) {
    const splitOwners = rawRepoOwnerValues.flatMap((value) => value.split(","));
    const normalizedOwners = normalizeRepoOwners(
      splitOwners,
      query["username"],
    );
    const normalizedValue = normalizedOwners
      .map((owner) => owner.toLowerCase())
      .join(",");
    routerParams.set("repo_owners", normalizedValue);
    query["repo_owners"] = normalizedValue;
    delete query["repo-owners"];
    canonicalOwners = normalizedOwners
      .map((owner) => owner.toLowerCase())
      .sort();
  } else {
    canonicalOwners = normalizeRepoOwners(defaultRepoOwners, query["username"])
      .map((owner) => owner.toLowerCase())
      .sort();
  }

  const cacheParams = new URLSearchParams();
  const sortedEntries = [...routerParams.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, value] of sortedEntries) {
    if (key === "repo_owners") {
      continue;
    }
    cacheParams.append(
      key,
      key === "username" ? value.trim().toLowerCase() : value,
    );
  }
  if (canonicalOwners.length > 0) {
    cacheParams.set("repo_owners", canonicalOwners.join(","));
  }
  cacheParams.sort();

  const routerSearch = routerParams.toString();
  const cacheSearch = cacheParams.toString();
  const cacheUrl = `${origin}${pathname}${cacheSearch ? `?${cacheSearch}` : ""}`;

  return {
    query,
    routerSearch: routerSearch ? `?${routerSearch}` : "",
    cacheKey: new Request(cacheUrl, { method: "GET" }),
  };
}

/**
 * Checks whether a response is eligible for Cloudflare edge caching.
 *
 * @param response Candidate response.
 * @returns True if the response is a cacheable 200 SVG.
 */
function isCacheableSvgResponse(response: Response): boolean {
  if (response.status !== 200) {
    return false;
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/svg+xml")) {
    return false;
  }
  const cacheControl = (
    response.headers.get("Cache-Control") ?? ""
  ).toLowerCase();
  if (
    cacheControl.includes("no-store") ||
    cacheControl.includes("no-cache") ||
    cacheControl.includes("private")
  ) {
    return false;
  }
  return true;
}

/**
 * Handles a Cloudflare Workers `fetch` event by bridging the Web `Request`
 * to the backend Node-style `router(req, res)` and returning a Web `Response`.
 *
 * @param request Incoming Fetch API request.
 * @param env Cloudflare Workers environment bindings.
 * @param ctx Optional Workers execution context for background cache writes.
 * @returns Web `Response` produced by the backend router or edge cache.
 */
export async function handleWorkerRequest(
  request: Request,
  env: Record<string, unknown> = {},
  ctx?: WorkerExecutionContext,
): Promise<Response> {
  // Cloudflare Workers supports `fetch` natively, so force axios onto its fetch
  // adapter so it does not attempt to use Node's `http` adapter under `nodejs_compat`.
  axios.defaults.adapter = "fetch";

  const url = new URL(request.url);
  if (url.pathname.startsWith("//")) {
    return new Response("Not Found", { status: 404 });
  }

  let pathname = url.pathname;
  if (pathname !== "/" && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  if (!CARD_ROUTES.has(pathname)) {
    return new Response("Not Found", { status: 404 });
  }

  applyWorkerEnv(env);

  const method = request.method.toUpperCase();
  const isCacheableMethod = method === "GET" || method === "HEAD";

  const { query, routerSearch, cacheKey } = canonicalizeRequest(
    url.origin,
    pathname,
    url.searchParams,
    getConfig().defaultRepoOwners,
  );

  const cache = isCacheableMethod ? getDefaultCache() : undefined;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      if (method === "HEAD") {
        return new Response(null, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
        });
      }
      return cached;
    }
  }

  const req: RouterRequest = {
    method: request.method,
    url: `${pathname}${routerSearch}`,
    headers: Object.fromEntries(request.headers.entries()),
    query,
  };

  const headers = new Headers();
  let body: string | Uint8Array | null = null;
  let ended = false;

  const finalize = (payload?: unknown): void => {
    if (ended) {
      return;
    }
    ended = true;
    if (payload !== undefined) {
      body = normalizeBody(payload, headers);
    }
  };

  const res: RouterResponse = {
    statusCode: 200,
    setHeader(name, value) {
      if (Array.isArray(value)) {
        headers.delete(name);
        for (const entry of value) {
          headers.append(name, entry);
        }
      } else {
        headers.set(name, String(value));
      }
    },
    getHeader(name) {
      return headers.get(name);
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(payload) {
      finalize(payload);
    },
    end(payload) {
      finalize(payload);
    },
  };

  await router(req, res);

  const response = new Response(body, {
    status: res.statusCode,
    headers,
  });

  if (cache && isCacheableSvgResponse(response)) {
    const putPromise = cache.put(cacheKey, response.clone());
    if (ctx) {
      ctx.waitUntil(putPromise);
    } else {
      await putPromise;
    }
  }

  if (method === "HEAD") {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  return response;
}

export default {
  fetch(
    request: Request,
    env: Record<string, unknown> = {},
    ctx?: WorkerExecutionContext,
  ): Promise<Response> {
    return handleWorkerRequest(request, env, ctx);
  },
};
