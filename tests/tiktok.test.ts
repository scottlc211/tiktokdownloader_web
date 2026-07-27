import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadTikTok,
  isValidTikTokUrl,
  parseTikTokHtml,
} from "../src/tiktok";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TikTok URL validation", () => {
  it("accepts supported TikTok URLs", () => {
    expect(
      isValidTikTokUrl("https://www.tiktok.com/@creator/video/1234567890"),
    ).toBe(true);
    expect(isValidTikTokUrl("https://vm.tiktok.com/ZM123abc/")).toBe(true);
  });

  it("rejects lookalike and unsupported URLs", () => {
    expect(
      isValidTikTokUrl(
        "https://example.com/?next=tiktok.com/@creator/video/1234567890",
      ),
    ).toBe(false);
    expect(isValidTikTokUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("TikTok HTML parsing", () => {
  it("extracts the response fields used by the frontend", () => {
    const html = `
      <input name="tt" value="token-value">
      <a id="hd_download" data-directurl="/hd-download"></a>
      <a class="download without_watermark" href="https://r1.ssstik.top/video.mp4?x=1&amp;y=2">video</a>
      <div style="background-image: url(https://img.tiktokcdn.com/cover.jpg)"></div>
      <a class="music" href="https://cdn.example.com/audio.mp3">music</a>
      <p class="maintext">A &amp; B</p>
      <h2>creator</h2>
    `;

    expect(parseTikTokHtml(html)).toEqual({
      video_url: "https://r1.ssstik.top/video.mp4?x=1&y=2",
      video_url_hd: null,
      cover_url: "https://img.tiktokcdn.com/cover.jpg",
      music_url: "https://cdn.example.com/audio.mp3",
      description: "A & B",
      author: "creator",
      hd_direct_url: "/hd-download",
      tt_value: "token-value",
    });
  });

  it("passes bootstrap cookies and tokens to the download request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<script>s_tt = 'fresh-token'</script>", {
          headers: { "Set-Cookie": "session=abc123; Path=/; HttpOnly" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          '<a href="https://tikcdn.io/video.mp4" class="download without_watermark">video</a>',
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadTikTok(
      "https://www.tiktok.com/@creator/video/1234567890",
      false,
    );
    const postInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const postHeaders = new Headers(postInit.headers);

    expect(result.video_url).toBe("https://tikcdn.io/video.mp4");
    expect(postHeaders.get("Cookie")).toBe("session=abc123");
    expect(String(postInit.body)).toContain("tt=fresh-token");
  });
});
