import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRequest, type Env } from "../src/index";

const SECRET = "test-signing-key-with-more-than-32-characters";

function createEnv(): Env {
  return {
    ASSETS: {
      async fetch(): Promise<Response> {
        return new Response("static asset");
      },
    },
    PROXY_SIGNING_KEY: SECRET,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Worker routing", () => {
  it("serves non-API requests through the assets binding", async () => {
    const response = await handleRequest(
      new Request("https://download.example.com/"),
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("static asset");
  });

  it("handles CORS preflight before route dispatch", async () => {
    const response = await handleRequest(
      new Request("https://download.example.com/api/tiktok/download", {
        method: "OPTIONS",
      }),
      createEnv(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("returns JSON for invalid TikTok input without an upstream request", async () => {
    const response = await handleRequest(
      new Request("https://download.example.com/api/tiktok/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/video/123" }),
      }),
      createEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "无效的 TikTok 链接",
    });
  });

  it("returns 403 for an unsigned proxy request", async () => {
    const response = await handleRequest(
      new Request(
        "https://download.example.com/api/proxy?url=https%3A%2F%2Fmedia.example.com%2Fvideo.mp4",
      ),
      createEnv(),
    );

    expect(response.status).toBe(403);
  });

  it("normalizes provider results with signed download URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              host: "example",
              videoItemVoList: [
                {
                  baseUrl: "https://media.example.com/video.mp4",
                  fileType: "video",
                },
              ],
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await handleRequest(
      new Request("https://download.example.com/api/video/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://video.example.com/watch/1" }),
      }),
      createEnv(),
    );
    const payload = (await response.json()) as {
      code: number;
      data: { videoItemVoList: Array<{ downloadUrl: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(200);
    expect(payload.data.videoItemVoList[0]?.downloadUrl).toMatch(
      /^\/api\/proxy\?/,
    );
  });
});
