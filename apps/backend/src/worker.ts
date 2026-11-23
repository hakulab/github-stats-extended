import { loadConfigFromEnv } from "@stats-organization/github-readme-stats-core";
import axios from "axios";

import router from "../router.js";

/**
 * Env vars read by backend modules through `process.env` at request time.
 * `loadConfigFromEnv(env)` covers core's config (`WHITELIST`, `GIST_WHITELIST`,
 * `EXCLUDE_REPO`, `FETCH_MULTI_PAGE_STARS`, `PAT_*`). These are read directly
 * by backend cache and OAuth handlers.
 */
const BRIDGED_PROCESS_ENV_KEYS = [
  "CACHE_SECONDS",
  "OAUTH_CLIENT_ID",
  "OAUTH_CLIENT_SECRET",
  "OAUTH_REDIRECT_URI",
];

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

interface RouterRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
}

interface RouterResponse {
  statusCode: number;
  setHeader(name: string, value: string | number | Array<string>): void;
  getHeader(name: string): string | null;
  status(code: number): RouterResponse;
  send(payload?: unknown): void;
  end(payload?: unknown): void;
}

/**
 * Handles a Cloudflare Workers `fetch` event by bridging the Web `Request`
 * to the backend Node-style `router(req, res)` and returning a Web `Response`.
 *
 * @param request Incoming Fetch API request.
 * @param env Cloudflare Workers environment bindings.
 * @returns Web `Response` produced by the backend router.
 */
export async function handleWorkerRequest(
  request: Request,
  env: Record<string, unknown> = {},
): Promise<Response> {
  // Cloudflare Workers supports `fetch` natively, so force axios onto its fetch
  // adapter so it does not attempt to use Node's `http` adapter under `nodejs_compat`.
  axios.defaults.adapter = "fetch";

  applyWorkerEnv(env);

  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname !== "/" && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  const req: RouterRequest = {
    method: request.method,
    url: `${pathname}${url.search}`,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(url.searchParams.entries()),
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

  return new Response(body, {
    status: res.statusCode,
    headers,
  });
}

export default {
  fetch: handleWorkerRequest,
};
