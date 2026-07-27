import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachSignedDownloadUrls,
  createSignedDownloadPath,
  proxyDownload,
  validateProxyTarget,
  verifySignedDownloadUrl,
} from "../src/proxy";

const SECRET = "test-signing-key-with-more-than-32-characters";
const NOW = Date.UTC(2026, 6, 27, 0, 0, 0);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signed download URLs", () => {
  it("signs and verifies a public download URL", async () => {
    const target = "https://media.example.com/video.mp4?quality=hd";
    const path = await createSignedDownloadPath(target, SECRET, NOW);
    const verified = await verifySignedDownloadUrl(
      new URL(path, "https://download.example.com"),
      SECRET,
      NOW,
    );

    expect(verified.toString()).toBe(target);
  });

  it("rejects tampered and expired signatures", async () => {
    const path = await createSignedDownloadPath(
      "https://media.example.com/video.mp4",
      SECRET,
      NOW,
    );
    const tampered = new URL(path, "https://download.example.com");
    tampered.searchParams.set("url", "https://media.example.com/other.mp4");

    await expect(verifySignedDownloadUrl(tampered, SECRET, NOW)).rejects.toThrow(
      "下载签名无效",
    );
    await expect(
      verifySignedDownloadUrl(
        new URL(path, "https://download.example.com"),
        SECRET,
        NOW + 16 * 60 * 1000,
      ),
    ).rejects.toThrow("下载链接已过期");
  });

  it("adds signed downloadUrl fields without replacing provider URLs", async () => {
    const data = await attachSignedDownloadUrls(
      {
        videoItemVoList: [
          {
            baseUrl: "https://media.example.com/video.mp4",
            fileType: "video",
          },
        ],
      },
      SECRET,
      NOW,
    );
    const items = data.videoItemVoList as Array<Record<string, unknown>>;

    expect(items[0]?.baseUrl).toBe("https://media.example.com/video.mp4");
    expect(items[0]?.downloadUrl).toMatch(/^\/api\/proxy\?/);
  });
});

describe("proxy target validation", () => {
  it("blocks local addresses and non-HTTP protocols", () => {
    expect(() => validateProxyTarget("http://127.0.0.1/video")).toThrow();
    expect(() => validateProxyTarget("http://[::1]/video")).toThrow();
    expect(() => validateProxyTarget("file:///etc/passwd")).toThrow();
  });

  it("streams range responses without buffering the body", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Range")).toBe("bytes=0-99");
      return new Response("video-bytes", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 0-10/11",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyDownload(
      new Request("https://download.example.com/api/proxy", {
        headers: { Range: "bytes=0-99" },
      }),
      new URL("https://media.example.com/video.mp4"),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Disposition")).toContain("video.mp4");
    expect(await response.text()).toBe("video-bytes");
  });
});
