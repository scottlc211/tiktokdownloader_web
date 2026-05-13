#!/usr/bin/env python3
"""
TikTok 无水印下载器 Web 服务 (支持 HD 高清)
"""

import os
import re
import json
import time
import requests
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urljoin


class TikTokDownloader:
    def __init__(self):
        self.base_url = "https://ssstik.io"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        })
        self.tt_token = "dlRBd2c3"

    def _get_page_token(self):
        try:
            resp = self.session.get(self.base_url, timeout=10)
            match = re.search(r"s_tt\s*=\s*['\"]([^'\"]+)['\"]", resp.text)
            if match:
                self.tt_token = match.group(1)
        except Exception:
            pass
        return self.tt_token

    def _resolve_short_url(self, url):
        try:
            resp = self.session.head(url, allow_redirects=True, timeout=10)
            return resp.url
        except Exception as e:
            raise Exception(f"无法解析短链接: {e}")

    def _get_hd_url(self, direct_url, tt_value):
        """获取 HD 高清链接"""
        try:
            full_url = urljoin(self.base_url, direct_url)
            resp = self.session.post(
                full_url,
                data={"tt": tt_value},
                headers={
                    "Referer": self.base_url + "/",
                    "Origin": self.base_url,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "HX-Request": "true",
                    "HX-Trigger": "hd_download",
                    "HX-Target": "hd_download",
                },
                timeout=30,
            )
            # HD 链接可能在响应体或 HX-Redirect header 中
            redirect = resp.headers.get("HX-Redirect") or resp.headers.get("hx-redirect")
            if redirect:
                return redirect
            
            # 从响应体提取
            match = re.search(r'href="(https?://[^"]+)"', resp.text)
            if match:
                return match.group(1)
            
            # 直接返回响应URL (可能是重定向)
            if resp.url and resp.url != full_url:
                return resp.url
                
        except Exception as e:
            print(f"获取 HD 链接失败: {e}")
        return None

    def _parse_html(self, html):
        result = {
            "video_url": None,
            "video_url_hd": None,
            "cover_url": None,
            "music_url": None,
            "description": None,
            "author": None,
            "hd_direct_url": None,
            "tt_value": None,
        }

        # 提取 tt 值 (用于获取 HD)
        tt_match = re.search(r'name="tt"\s+value="([^"]+)"', html)
        if tt_match:
            result["tt_value"] = tt_match.group(1)

        # HD 按钮的 data-directurl
        hd_match = re.search(r'id="hd_download"[^>]+data-directurl="([^"]+)"', html)
        if hd_match:
            result["hd_direct_url"] = hd_match.group(1)

        # 无水印视频链接 (普通质量)
        patterns = [
            r'href="(https?://r\d*\.ssstik\.top/[^"]+)"',
            r'href="(https?://tikcdn\.io/[^"]+)"',
            r'href="(https?://[^"]*\.tiktokcdn[^"]*\.mp4[^"]*)"',
            r'<a[^>]+href="([^"]+)"[^>]*class="[^"]*download[^"]*without_watermark[^"]*"',
            r'<a[^>]+class="[^"]*without_watermark[^"]*"[^>]+href="([^"]+)"',
        ]
        for pattern in patterns:
            m = re.search(pattern, html, re.I)
            if m:
                url = m.group(1)
                if url.startswith("http") and "ssstik.io" not in url:
                    result["video_url"] = url
                    break

        # 备用: 任意 mp4 链接
        if not result["video_url"]:
            mp4_match = re.search(r'href="(https?://[^"]+\.mp4[^"]*)"', html)
            if mp4_match:
                result["video_url"] = mp4_match.group(1)

        # 封面图
        cover_patterns = [
            r'background-image:\s*url\((https?://[^)]+)\)',
            r'<img[^>]+src="(https?://[^"]*(?:tiktokcdn|byteimg|tiktok)[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"',
        ]
        for pattern in cover_patterns:
            m = re.search(pattern, html, re.I)
            if m:
                url = m.group(1)
                if url.startswith("http"):
                    result["cover_url"] = url
                    break

        # 音乐链接
        music_patterns = [
            r'href="(https?://[^"]*(?:\.mp3|music|audio)[^"]*)"',
            r'class="[^"]*music[^"]*"[^>]+href="([^"]+)"',
        ]
        for pattern in music_patterns:
            m = re.search(pattern, html, re.I)
            if m:
                result["music_url"] = m.group(1)
                break

        # 描述
        desc_match = re.search(r'class="[^"]*maintext[^"]*"[^>]*>\s*([^<]+)', html)
        if desc_match:
            result["description"] = desc_match.group(1).strip()

        # 作者
        author_match = re.search(r'<h2>([^<]+)</h2>', html)
        if author_match:
            result["author"] = author_match.group(1).strip()

        return result

    def download(self, tiktok_url, prefer_hd=True):
        # 处理短链接
        if 'vm.tiktok.com' in tiktok_url or 'vt.tiktok.com' in tiktok_url:
            try:
                tiktok_url = self._resolve_short_url(tiktok_url)
            except Exception as e:
                return {"error": str(e)}

        # 验证链接
        patterns = [
            r'tiktok\.com.*?/video/\d+',
            r'tiktok\.com.*?/photo/\d+',
            r'tiktok\.com/@[^/]+/video/\d+',
            r'vm\.tiktok\.com/',
            r'vt\.tiktok\.com/',
            r'tiktok\.com/t/',
        ]
        valid = any(re.search(p, tiktok_url) for p in patterns)
        if not valid:
            return {"error": f"无效的 TikTok 视频链接: {tiktok_url}"}

        token = self._get_page_token()

        try:
            resp = self.session.post(
                f"{self.base_url}/abc?url=dl",
                data={"id": tiktok_url, "locale": "en", "tt": token},
                headers={
                    "Referer": self.base_url + "/",
                    "Origin": self.base_url,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout=30,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            return {"error": f"请求失败: {e}"}

        html = resp.text

        if "Holy moly" in html or "serious problem" in html:
            error_match = re.search(r"Error code:\s*([^<]+)", html)
            msg = error_match.group(1).strip() if error_match else "TikTok 接口异常，稍后重试"
            return {"error": msg}

        result = self._parse_html(html)
        result["original_url"] = tiktok_url

        # 尝试获取 HD 链接
        if prefer_hd and result.get("hd_direct_url"):
            print(f"[*] 正在获取 HD 高清链接...")
            hd_url = self._get_hd_url(result["hd_direct_url"], result.get("tt_value", ""))
            if hd_url:
                result["video_url_hd"] = hd_url
                result["video_url"] = hd_url  # 默认使用 HD

        if not result.get("video_url"):
            result["error"] = "未能提取视频链接"
            result["debug_hint"] = "可能需要更新解析逻辑"

        return result


downloader = TikTokDownloader()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.path = '/index.html'
            return super().do_GET()
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/download':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                url = data.get('url', '').strip()
                hd = data.get('hd', True)
                if not url:
                    self._json_response({"error": "请输入 TikTok 链接"}, 400)
                    return

                print(f"[{time.strftime('%H:%M:%S')}] 解析: {url} (HD={hd})")
                result = downloader.download(url, prefer_hd=hd)
                status = 200 if "error" not in result else 400
                self._json_response(result, status)

            except json.JSONDecodeError:
                self._json_response({"error": "无效的 JSON"}, 400)
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
        else:
            self._json_response({"error": "Not Found"}, 404)

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")


def main():
    port = int(os.environ.get('PORT', 8080))
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f"""
╔══════════════════════════════════════════╗
║   TikTok 无水印下载器 (HD) 已启动       ║
║   http://localhost:{port}                 ║
╚══════════════════════════════════════════╝
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
        server.server_close()


if __name__ == "__main__":
    main()
