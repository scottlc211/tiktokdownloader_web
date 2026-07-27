export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
};

const MAX_JSON_BODY_BYTES = 16 * 1024;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", "application/json; charset=utf-8");

  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }

  return new Response(JSON.stringify(data), { status, headers });
}

export function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export function methodNotAllowed(methods: string[]): Response {
  return jsonResponse(
    { error: "Method Not Allowed" },
    405,
    { Allow: methods.join(", ") },
  );
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new AppError(413, "请求体过大");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BODY_BYTES) {
    throw new AppError(413, "请求体过大");
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new AppError(400, "无效的 JSON");
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AppError(400, "无效的 JSON");
  }

  return data as Record<string, unknown>;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(error: unknown, fallback = "请求失败"): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export function errorStatus(error: unknown, fallback = 500): number {
  return error instanceof AppError ? error.status : fallback;
}
