import { errorMessage, fetchWithTimeout, USER_AGENT } from "./http";

const SSSTIK_BASE_URL = "https://ssstik.io";
const FALLBACK_TOKEN = "dlRBd2c3";

interface BootstrapData {
  token: string;
  cookie: string;
}

export interface TikTokResult {
  video_url: string | null;
  video_url_hd: string | null;
  cover_url: string | null;
  music_url: string | null;
  description: string | null;
  author: string | null;
  hd_direct_url: string | null;
  tt_value: string | null;
  original_url?: string;
  error?: string;
}

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

function parseHttpUrl(value: string, base?: string): URL | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function isTikTokHostname(hostname: string): boolean {
  return hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
}

function isShortTikTokHostname(hostname: string): boolean {
  return hostname === "vm.tiktok.com" || hostname === "vt.tiktok.com";
}

export function isValidTikTokUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  if (!url || !isTikTokHostname(url.hostname)) {
    return false;
  }

  if (isShortTikTokHostname(url.hostname)) {
    return url.pathname.length > 1;
  }

  return (
    /\/(?:video|photo)\/\d+/.test(url.pathname) ||
    /^\/t\/[^/]+/.test(url.pathname)
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );
}

function normalizeExternalUrl(value: string, base?: string): string | null {
  const decoded = decodeHtml(value.trim());
  return parseHttpUrl(decoded, base)?.toString() ?? null;
}

function getSetCookieValues(headers: Headers): string[] {
  const compatibleHeaders = headers as Headers & {
    getSetCookie?: () => string[];
    getAll?: (name: string) => string[];
  };

  if (typeof compatibleHeaders.getSetCookie === "function") {
    return compatibleHeaders.getSetCookie();
  }
  if (typeof compatibleHeaders.getAll === "function") {
    return compatibleHeaders.getAll("Set-Cookie");
  }

  const combined = headers.get("Set-Cookie");
  return combined ? [combined] : [];
}

function extractCookieHeader(headers: Headers): string {
  return getSetCookieValues(headers)
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie))
    .join("; ");
}

async function getBootstrapData(): Promise<BootstrapData> {
  try {
    const response = await fetchWithTimeout(
      SSSTIK_BASE_URL,
      { headers: COMMON_HEADERS, redirect: "follow" },
      10_000,
    );
    const html = await response.text();
    const token = html.match(/s_tt\s*=\s*['"]([^'"]+)['"]/)?.[1];

    return {
      token: token || FALLBACK_TOKEN,
      cookie: extractCookieHeader(response.headers),
    };
  } catch {
    return { token: FALLBACK_TOKEN, cookie: "" };
  }
}

async function resolveShortUrl(value: string): Promise<string> {
  const response = await fetchWithTimeout(
    value,
    {
      method: "HEAD",
      headers: COMMON_HEADERS,
      redirect: "follow",
    },
    10_000,
  );
  return response.url;
}

function withSessionHeaders(
  headers: Record<string, string>,
  cookie: string,
): Headers {
  const result = new Headers({ ...COMMON_HEADERS, ...headers });
  if (cookie) {
    result.set("Cookie", cookie);
  }
  return result;
}

export function parseTikTokHtml(html: string): TikTokResult {
  const result: TikTokResult = {
    video_url: null,
    video_url_hd: null,
    cover_url: null,
    music_url: null,
    description: null,
    author: null,
    hd_direct_url: null,
    tt_value: null,
  };

  result.tt_value = html.match(/name="tt"\s+value="([^"]+)"/i)?.[1] ?? null;
  result.hd_direct_url =
    html.match(/id="hd_download"[^>]+data-directurl="([^"]+)"/i)?.[1] ?? null;

  const videoPatterns = [
    /href="(https?:\/\/r\d*\.ssstik\.top\/[^"]+)"/i,
    /href="(https?:\/\/tikcdn\.io\/[^"]+)"/i,
    /<a[^>]+href="([^"]+)"[^>]*class="[^"]*download[^"]*without_watermark[^"]*"/i,
    /<a[^>]+class="[^"]*without_watermark[^"]*"[^>]+href="([^"]+)"/i,
  ];

  for (const pattern of videoPatterns) {
    const candidate = pattern.exec(html)?.[1];
    const url = candidate ? normalizeExternalUrl(candidate, SSSTIK_BASE_URL) : null;
    const hostname = url ? new URL(url).hostname : "";
    if (url && hostname !== "ssstik.io" && !hostname.endsWith(".ssstik.io")) {
      result.video_url = url;
      break;
    }
  }

  if (!result.video_url) {
    const candidate = html.match(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/i)?.[1];
    result.video_url = candidate ? normalizeExternalUrl(candidate) : null;
  }

  const coverPatterns = [
    /background-image:\s*url\((https?:\/\/[^)]+)\)/i,
    /<img[^>]+src="(https?:\/\/[^"]*(?:tiktokcdn|byteimg|tiktok)[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i,
  ];
  for (const pattern of coverPatterns) {
    const candidate = pattern.exec(html)?.[1];
    const url = candidate ? normalizeExternalUrl(candidate) : null;
    if (url) {
      result.cover_url = url;
      break;
    }
  }

  const musicPatterns = [
    /href="(https?:\/\/[^"]*(?:\.mp3|music|audio)[^"]*)"/i,
    /class="[^"]*music[^"]*"[^>]+href="([^"]+)"/i,
  ];
  for (const pattern of musicPatterns) {
    const candidate = pattern.exec(html)?.[1];
    const url = candidate ? normalizeExternalUrl(candidate, SSSTIK_BASE_URL) : null;
    if (url) {
      result.music_url = url;
      break;
    }
  }

  const description = html.match(/class="[^"]*maintext[^"]*"[^>]*>\s*([^<]+)/i)?.[1];
  const author = html.match(/<h2>([^<]+)<\/h2>/i)?.[1];
  result.description = description ? decodeHtml(description.trim()) : null;
  result.author = author ? decodeHtml(author.trim()) : null;

  return result;
}

async function getHdUrl(
  directUrl: string,
  ttValue: string,
  cookie: string,
): Promise<string | null> {
  const endpoint = normalizeExternalUrl(directUrl, SSSTIK_BASE_URL);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: withSessionHeaders(
          {
            Referer: `${SSSTIK_BASE_URL}/`,
            Origin: SSSTIK_BASE_URL,
            "Content-Type": "application/x-www-form-urlencoded",
            "HX-Request": "true",
            "HX-Trigger": "hd_download",
            "HX-Target": "hd_download",
          },
          cookie,
        ),
        body: new URLSearchParams({ tt: ttValue }).toString(),
        redirect: "manual",
      },
      30_000,
    );

    const redirect =
      response.headers.get("HX-Redirect") ?? response.headers.get("Location");
    if (redirect) {
      return normalizeExternalUrl(redirect, SSSTIK_BASE_URL);
    }

    const html = await response.text();
    const candidate = html.match(/href="(https?:\/\/[^"]+)"/i)?.[1];
    return candidate ? normalizeExternalUrl(candidate) : null;
  } catch {
    return null;
  }
}

export async function downloadTikTok(
  inputUrl: string,
  preferHd = true,
): Promise<TikTokResult> {
  let tiktokUrl = inputUrl.trim();
  const input = parseHttpUrl(tiktokUrl);

  if (input && isShortTikTokHostname(input.hostname)) {
    try {
      tiktokUrl = await resolveShortUrl(tiktokUrl);
    } catch (error) {
      return {
        ...parseTikTokHtml(""),
        error: `无法解析短链接: ${errorMessage(error)}`,
      };
    }
  }

  if (!isValidTikTokUrl(tiktokUrl)) {
    return { ...parseTikTokHtml(""), error: "无效的 TikTok 链接" };
  }

  const bootstrap = await getBootstrapData();
  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${SSSTIK_BASE_URL}/abc?url=dl`,
      {
        method: "POST",
        headers: withSessionHeaders(
          {
            Referer: `${SSSTIK_BASE_URL}/`,
            Origin: SSSTIK_BASE_URL,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          bootstrap.cookie,
        ),
        body: new URLSearchParams({
          id: tiktokUrl,
          locale: "en",
          tt: bootstrap.token,
        }).toString(),
      },
      30_000,
    );

    if (!response.ok) {
      throw new Error(`TikTok 接口返回 HTTP ${response.status}`);
    }
  } catch (error) {
    return {
      ...parseTikTokHtml(""),
      error: `请求失败: ${errorMessage(error)}`,
    };
  }

  const html = await response.text();
  if (html.includes("Holy moly") || html.includes("serious problem")) {
    const code = html.match(/Error code:\s*([^<]+)/i)?.[1]?.trim();
    return {
      ...parseTikTokHtml(""),
      error: code || "TikTok 接口异常，稍后重试",
    };
  }

  const result = parseTikTokHtml(html);
  result.original_url = tiktokUrl;

  if (preferHd && result.hd_direct_url) {
    const hdUrl = await getHdUrl(
      result.hd_direct_url,
      result.tt_value ?? "",
      bootstrap.cookie,
    );
    if (hdUrl) {
      result.video_url_hd = hdUrl;
      result.video_url = hdUrl;
    }
  }

  if (!result.video_url) {
    result.error = "未能提取视频链接";
  }

  return result;
}
