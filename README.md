# TikTok 无水印下载器

基于 ssstik.io 逆向实现的 TikTok 无水印视频下载器，支持 HD 高清。

## 本地运行

```bash
pip install -r requirements.txt
python server.py
# 访问 http://localhost:8080
```

## 部署到 Railway (推荐，免费)

1. Fork 或上传到 GitHub
2. 访问 [railway.app](https://railway.app)
3. 点击 "New Project" → "Deploy from GitHub repo"
4. 选择仓库，自动部署
5. 获取公网 URL

## 部署到 Render (免费)

1. 上传到 GitHub
2. 访问 [render.com](https://render.com)
3. New → Web Service → 连接仓库
4. 设置:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `python server.py`
5. 部署完成

## 部署到 Vercel

```bash
npm i -g vercel
vercel
```

## 部署到自己的服务器

```bash
# SSH 到服务器
git clone <your-repo>
cd tiktok_web
pip install -r requirements.txt
python server.py
# 用 nginx 反代 8080 端口
```

## 环境变量

- `PORT`: 服务端口 (默认 8080)
