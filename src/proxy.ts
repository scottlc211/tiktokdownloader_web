import {
  AppError,
  CORS_HEADERS,
  fetchWithTimeout,
  USER_AGENT,
} from "./http";
import type { VideoData } from "./multi-platform";

const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
const MAX_ACCEPTED_TTL_SECONDS = 60 * 60;
const MAX_REDIRECTS = 5;

function requireSigningSecret(secret: string | undefined): string {
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new AppError(500, "服务端未配置有效的 PROXY_SIGNING_KEY");
  }
  return secret;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("[")
  );
}

export function validateProxyTarget(value: string): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new AppError(400, "无效的下载地址");
  }

  if (
    (target.protocol !== "https:" && target.protocol !== "http:") ||
    target.username ||
    target.password ||
    isBlockedHostname(target.hostname) ||
    (target.port && target.port !== "80" && target.port !== "443")
  ) {
    throw new AppError(400, "不允许代理该下载地址");
  }

  return target;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signaturePayload(target: string, expires: number): ArrayBuffer {
  return new TextEncoder().encode(`${expires}\n${target}`).buffer as ArrayBuffer;
}

function base64UrlEncode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AppError(403, "下载签名无效");
  }

  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  } catch {
    throw new AppError(403, "下载签名无效");
  }

  return Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  ).buffer as ArrayBuffer;
}

async function signTarget(
  key: CryptoKey,
  target: string,
  expires: number,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    signaturePayload(target, expires),
  );
  return base64UrlEncode(signature);
}

export async function createSignedDownloadPath(
  targetValue: string,
  secretValue: string | undefined,
  nowMs = Date.now(),
): Promise<string> {
  const secret = requireSigningSecret(secretValue);
  const target = validateProxyTarget(targetValue).toString();
  const expires = Math.floor(nowMs / 1000) + DOWNLOAD_URL_TTL_SECONDS;
  const key = await importSigningKey(secret);
  const signature = await signTarget(key, target, expires);
  const query = new URLSearchParams({
    url: target,
    expires: String(expires),
    sig: signature,
  });
  return `/api/proxy?${query.toString()}`;
}

export async function verifySignedDownloadUrl(
  requestUrl: URL,
  secretValue: string | undefined,
  nowMs = Date.now(),
): Promise<URL> {
  const secret = requireSigningSecret(secretValue);
  const targetValue = requestUrl.searchParams.get("url");
  const expiresValue = requestUrl.searchParams.get("expires");
  const signatureValue = requestUrl.searchParams.get("sig");

  if (!targetValue || !expiresValue || !signatureValue || !/^\d+$/.test(expiresValue)) {
    throw new AppError(403, "下载签名无效");
  }

  const expires = Number(expiresValue);
  const now = Math.floor(nowMs / 1000);
  if (expires < now || expires > now + MAX_ACCEPTED_TTL_SECONDS) {
    throw new AppError(403, "下载链接已过期");
  }

  const target = validateProxyTarget(targetValue);
  const key = await importSigningKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(signatureValue),
    signaturePayload(target.toString(), expires),
  );

  if (!valid) {
    throw new AppError(403, "下载签名无效");
  }

  return target;
}

export async function attachSignedDownloadUrls(
  data: VideoData,
  secretValue: string | undefined,
  nowMs = Date.now(),
): Promise<VideoData> {
  const secret = requireSigningSecret(secretValue);
  const items = data.videoItemVoList;
  if (!Array.isArray(items)) {
    return data;
  }

  const expires = Math.floor(nowMs / 1000) + DOWNLOAD_URL_TTL_SECONDS;
  const key = await importSigningKey(secret);
  const signedItems = await Promise.all(
    items.map(async (item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return item;
      }

      const record = item as Record<string, unknown>;
      if (typeof record.baseUrl !== "string") {
        return record;
      }

      let target: URL;
      try {
        target = validateProxyTarget(record.baseUrl);
      } catch {
        return record;
      }

      const signature = await signTarget(key, target.toString(), expires);
      const query = new URLSearchParams({
        url: target.toString(),
        expires: String(expires),
        sig: signature,
      });

      return {
        ...record,
        // Worker 定义并保证该字段存在时已经完成签名，前端不得自行拼接原始 URL。
        downloadUrl: `/api/proxy?${query.toString()}`,
      };
    }),
  );

  return { ...data, videoItemVoList: signedItems };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function fetchDownload(
  initialTarget: URL,
  request: Request,
): Promise<Response> {
  let target = initialTarget;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const headers = new Headers({
      "User-Agent": USER_AGENT,
      Referer: "https://www.douyin.com/",
      Accept: request.headers.get("Accept") ?? "*/*",
    });
    const range = request.headers.get("Range");
    if (range) {
      headers.set("Range", range);
    }

    const response = await fetchWithTimeout(
      target,
      {
        method: request.method,
        headers,
        redirect: "manual",
        cache: "no-store",
      },
      120_000,
    );

    if (!isRedirect(response.status)) {
      return response;
    }

    const location = response.headers.get("Location");
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new AppError(502, "下载源重定向异常");
    }
    target = validateProxyTarget(new URL(location, target).toString());
  }

  throw new AppError(502, "下载源重定向次数过多");
}

function downloadFilename(contentType: string): string {
  if (contentType.startsWith("audio/")) return "audio.mp3";
  if (contentType.startsWith("image/png")) return "image.png";
  if (contentType.startsWith("image/webp")) return "image.webp";
  if (contentType.startsWith("image/")) return "image.jpg";
  return "video.mp4";
}

export async function proxyDownload(
  request: Request,
  target: URL,
): Promise<Response> {
  const incoming = new URL(request.url);
  if (target.host === incoming.host) {
    throw new AppError(400, "不允许代理本站地址");
  }

  const upstream = await fetchDownload(target, request);
  if (!upstream.ok && upstream.status !== 206) {
    upstream.body?.cancel();
    throw new AppError(502, `下载源返回 HTTP ${upstream.status}`);
  }

  const headers = new Headers(CORS_HEADERS);
  const passthroughHeaders = [
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
  ];
  for (const name of passthroughHeaders) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  const contentType = headers.get("Content-Type") ?? "video/mp4";
  headers.set("Content-Type", contentType);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${downloadFilename(contentType)}"`,
  );
  headers.set("Cache-Control", "private, no-store");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
