import {
  errorMessage,
  errorStatus,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  readJsonObject,
} from "./http";
import { extractMultiPlatform } from "./multi-platform";
import {
  attachSignedDownloadUrls,
  proxyDownload,
  verifySignedDownloadUrl,
} from "./proxy";
import { downloadTikTok } from "./tiktok";

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetBinding;
  PROXY_SIGNING_KEY?: string;
}

async function handleTikTok(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST", "OPTIONS"]);
  }

  try {
    const body = await readJsonObject(request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return jsonResponse({ error: "请输入 TikTok 链接" }, 400);
    }

    const preferHd = body.hd !== false;
    const result = await downloadTikTok(url, preferHd);
    return jsonResponse(result, result.error ? 400 : 200);
  } catch (error) {
    console.error("TikTok 解析失败", error);
    return jsonResponse(
      { error: errorMessage(error, "TikTok 解析失败") },
      errorStatus(error),
    );
  }
}

async function handleMultiPlatform(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST", "OPTIONS"]);
  }

  try {
    const body = await readJsonObject(request);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return jsonResponse({ code: 400, message: "请输入链接" }, 400);
    }

    const result = await extractMultiPlatform(url);
    if (result.error || !result.data) {
      return jsonResponse(
        { code: 400, message: result.error ?? "解析失败" },
        400,
      );
    }

    const data = await attachSignedDownloadUrls(
      result.data,
      env.PROXY_SIGNING_KEY,
    );
    return jsonResponse({ code: 200, message: "操作成功", data });
  } catch (error) {
    console.error("多平台解析失败", error);
    return jsonResponse(
      { code: errorStatus(error), message: errorMessage(error, "解析失败") },
      errorStatus(error),
    );
  }
}

async function handleProxy(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(["GET", "HEAD", "OPTIONS"]);
  }

  try {
    const requestUrl = new URL(request.url);
    const target = await verifySignedDownloadUrl(
      requestUrl,
      env.PROXY_SIGNING_KEY,
    );
    return await proxyDownload(request, target);
  } catch (error) {
    console.error("代理下载失败", error);
    return jsonResponse(
      { error: errorMessage(error, "代理下载失败") },
      errorStatus(error, 502),
    );
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/")) {
    return env.ASSETS.fetch(request);
  }

  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  if (url.pathname === "/api/tiktok/download") {
    return handleTikTok(request);
  }
  if (url.pathname === "/api/video/extract") {
    return handleMultiPlatform(request, env);
  }
  if (url.pathname === "/api/proxy") {
    return handleProxy(request, env);
  }

  return jsonResponse({ error: "Not Found" }, 404);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
