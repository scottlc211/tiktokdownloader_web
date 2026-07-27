# TikTok 无水印下载器

基于 Cloudflare Workers + Workers Static Assets 的视频解析与下载页面。静态页面和 API 由同一个 Worker 部署，不需要 Railway、Render 或常驻服务器。

## 架构

- `public/index.html`：由 Workers Static Assets 免费托管。
- `src/index.ts`：Worker 路由入口。
- `POST /api/tiktok/download`：TikTok 解析。
- `POST /api/video/extract`：抖音及多平台解析。
- `GET /api/proxy`：带时效签名的流式下载代理。

`server.py`、`Dockerfile` 和 `Procfile` 仅保留为旧版 Python 部署参考，Cloudflare 部署不会使用它们。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

访问 Wrangler 输出的本地地址，通常为 `http://localhost:8787`。本地开发命令使用仅限本机的测试签名密钥。

WSL1 无法运行 Wrangler 使用的 `workerd` 本地进程。如果出现 TCMalloc 或虚拟地址映射错误，请在 Windows PowerShell、WSL2 或原生 Linux 中执行 `npm run dev`；`npm run check`、dry-run 和正式部署不受此限制。

提交前运行完整检查：

```bash
npm run check
```

## 部署到 Cloudflare

首次部署：

```bash
npm install
npx wrangler login
npm run check
npm run deploy
```

随后创建下载代理使用的生产密钥：

```bash
openssl rand -hex 32 | npx wrangler secret put PROXY_SIGNING_KEY
```

不要把真实密钥写入 `wrangler.jsonc`、`.dev.vars.example` 或 Git 仓库。缺少该密钥时，TikTok 解析仍可执行，但多平台下载签名会返回配置错误。

## 绑定自定义域名

1. 在原 Cloudflare Pages 项目中移除 `download.932000.xyz`。
2. 打开 **Workers & Pages**，选择 `tiktok-downloader` Worker。
3. 进入 **Settings > Domains & Routes > Add > Custom Domain**。
4. 添加 `download.932000.xyz`。
5. 用 `POST /api/tiktok/download` 验证接口不再返回 405。

如果使用 Git 自动部署，应在 Worker 的 **Settings > Variables and Secrets** 中添加加密变量 `PROXY_SIGNING_KEY`，并将部署命令设置为 `npm run deploy`。

## 免费额度注意事项

- 静态资源请求免费且不计入 Worker 请求数。
- Workers Free 默认每天 100,000 次动态请求。
- 单次免费请求 CPU 时间为 10ms；等待第三方 HTTP 响应不计入 CPU 时间。
- 视频通过响应流转发，不会完整载入 Worker 内存。
- `ssstik.io`、`douyin.wtf` 或 `greenvideo.cc` 仍可能限制 Cloudflare 出口 IP，此情况需要根据 Worker 日志更换上游解析服务。
