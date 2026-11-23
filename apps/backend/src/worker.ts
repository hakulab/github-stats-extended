import {
  getConfig,
  loadConfigFromEnv,
  normalizeRepoOwners,
} from "@stats-organization/github-readme-stats-core";
import axios from "axios";

import router from "../router.js";
import type { RouterRequest, RouterResponse } from "../router.js";

import { guardAccess } from "./common/access.js";

// Core config reads env via `loadConfigFromEnv(env)`, while `CACHE_SECONDS` is
// read directly from `process.env` by backend cache helpers.
const BRIDGED_PROCESS_ENV_KEYS = ["CACHE_SECONDS"];

const CARD_ROUTES = new Set([
  "/api",
  "/api/top-langs",
  "/api/pin",
  "/api/gist",
  "/api/wakatime",
]);

const REPO_OWNER_ROUTES = new Set(["/api", "/api/top-langs"]);

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function getDefaultCache(): WorkerCache | undefined {
  const cachesObj = (globalThis as { caches?: { default?: WorkerCache } })
    .caches;
  return cachesObj?.default;
}

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
  const supportsRepoOwners = REPO_OWNER_ROUTES.has(pathname);

  let canonicalOwners: Array<string> = [];
  if (supportsRepoOwners) {
    const rawRepoOwnerValues = [
      ...searchParams.getAll("repo_owners"),
      ...searchParams.getAll("repo-owners"),
    ];
    delete query["repo-owners"];

    if (rawRepoOwnerValues.length > 0) {
      const splitOwners = rawRepoOwnerValues.flatMap((value) =>
        value.split(","),
      );
      const lowerOwners = normalizeRepoOwners(
        splitOwners,
        query["username"],
      ).map((owner) => owner.toLowerCase());
      query["repo_owners"] = lowerOwners.join(",");
      canonicalOwners = [...lowerOwners].sort();
    } else {
      canonicalOwners = normalizeRepoOwners(
        defaultRepoOwners,
        query["username"],
      )
        .map((owner) => owner.toLowerCase())
        .sort();
    }
  }

  const routerParams = new URLSearchParams();
  const cacheParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    routerParams.set(key, value);
    if (supportsRepoOwners && key === "repo_owners") {
      continue;
    }
    const normalizedValue =
      key === "username" || (pathname === "/api/gist" && key === "id")
        ? value.trim().toLowerCase()
        : value;
    cacheParams.set(key, normalizedValue);
  }
  if (supportsRepoOwners && canonicalOwners.length > 0) {
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

function isRequestAllowed(
  pathname: string,
  query: Record<string, string>,
): boolean {
  const type =
    pathname === "/api/gist"
      ? "gist"
      : pathname === "/api/wakatime"
        ? "wakatime"
        : "username";
  const id = type === "gist" ? (query["id"] ?? "") : (query["username"] ?? "");
  return guardAccess({ id, type, colors: {} }).isPassed;
}

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

export async function handleWorkerRequest(
  request: Request,
  env: Record<string, unknown> = {},
  ctx?: WorkerExecutionContext,
): Promise<Response> {
  // Force axios onto its fetch adapter so it does not attempt to use Node's
  // `http` adapter under `nodejs_compat`.
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

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  applyWorkerEnv(env);

  const { query, routerSearch, cacheKey } = canonicalizeRequest(
    url.origin,
    pathname,
    url.searchParams,
    getConfig().defaultRepoOwners,
  );

  // Check access before consulting or populating the edge cache so revoked
  // users cannot hit stale entries and denial SVGs are never cached.
  const canUseCache = isRequestAllowed(pathname, query);
  const cache = canUseCache ? getDefaultCache() : undefined;
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
    method: "GET",
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
