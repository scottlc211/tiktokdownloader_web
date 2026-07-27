import { errorMessage, fetchWithTimeout, USER_AGENT } from "./http";

const GREENVIDEO_URL = "https://greenvideo.cc/api/video/extract";
const DOUYIN_WTF_URL = "https://douyin.wtf/api/hybrid/video_data";

export type VideoData = Record<string, unknown>;

export interface ExtractResult {
  data?: VideoData;
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  const first = value.find((item) => typeof item === "string");
  return typeof first === "string" ? first : "";
}

function identifier(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function isDouyinUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "douyin.com" || hostname.endsWith(".douyin.com");
  } catch {
    return false;
  }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  const data = asRecord(value);
  if (!data) {
    throw new Error("上游接口返回了无效 JSON");
  }
  return data;
}

async function extractDouyin(url: string): Promise<VideoData | null> {
  try {
    const endpoint = new URL(DOUYIN_WTF_URL);
    endpoint.searchParams.set("url", url);
    const response = await fetchWithTimeout(
      endpoint,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://douyin.wtf/",
          Accept: "application/json",
        },
      },
      30_000,
    );
    const payload = await parseJsonResponse(response);
    if (payload.code !== 200) {
      return null;
    }

    // 字段结构沿用 douyin.wtf 当前接口契约，不尝试猜测其他备用字段。
    const info = asRecord(payload.data) ?? {};
    const video = asRecord(info.video) ?? {};
    const playAddress = asRecord(video.play_addr) ?? {};
    const videoUrl = firstString(playAddress.url_list);
    const cover = asRecord(video.cover) ?? {};
    const coverUrl = firstString(cover.url_list);
    const items: Record<string, unknown>[] = [];

    if (videoUrl) {
      items.push({
        baseUrl: videoUrl,
        quality: "无水印",
        qualityAlias: "无水印视频",
        fileType: "video",
        size:
          typeof playAddress.data_size === "number"
            ? playAddress.data_size
            : 0,
      });
    }

    return {
      vid: identifier(info.aweme_id),
      host: "douyin",
      hostAlias: "抖音",
      displayTitle: typeof info.desc === "string" ? info.desc : "",
      status: "finish",
      videoItemVoList: items,
      _cover: coverUrl,
    };
  } catch (error) {
    console.warn("douyin.wtf 解析失败", errorMessage(error));
    return null;
  }
}

async function extractGreenVideo(url: string): Promise<ExtractResult> {
  try {
    const response = await fetchWithTimeout(
      GREENVIDEO_URL,
      {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Referer: "https://greenvideo.cc/",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ url }),
      },
      30_000,
    );
    const payload = await parseJsonResponse(response);

    if (payload.code === 200) {
      const data = asRecord(payload.data);
      return data ? { data } : { error: "解析接口返回数据异常" };
    }

    return {
      error: typeof payload.message === "string" ? payload.message : "解析失败",
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export async function extractMultiPlatform(url: string): Promise<ExtractResult> {
  if (isDouyinUrl(url)) {
    const result = await extractDouyin(url);
    if (result) {
      return { data: result };
    }
  }

  return extractGreenVideo(url);
}
