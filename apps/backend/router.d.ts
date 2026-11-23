export interface RouterRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
}

export interface RouterResponse {
  statusCode: number;
  setHeader(name: string, value: string | number | Array<string>): void;
  getHeader(name: string): string | null;
  status(code: number): RouterResponse;
  send(payload?: unknown): void;
  end(payload?: unknown): void;
}

declare const router: (
  req: RouterRequest,
  res: RouterResponse,
) => Promise<void>;

export default router;
