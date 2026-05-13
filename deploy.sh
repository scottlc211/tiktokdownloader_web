#!/bin/bash
# 一键部署脚本 - 推送到 GitHub 后可用 Railway/Render 等平台部署

set -e

PROJECT_DIR="/home/admin123/tiktok_web"
cd "$PROJECT_DIR"

echo "==================================="
echo "  TikTok 下载器 - 准备部署"
echo "==================================="

# 初始化 git (如果没有)
if [ ! -d ".git" ]; then
    git init
    git add -A
    git commit -m "Initial commit: TikTok downloader"
fi

echo ""
echo "✓ 项目已准备就绪!"
echo ""
echo "下一步 - 选择部署方式:"
echo ""
echo "【方式1: Railway (推荐，免费)】"
echo "  1. 在 GitHub 创建新仓库: tiktok-downloader"
echo "  2. 推送代码:"
echo "     git remote add origin https://github.com/YOUR_USERNAME/tiktok-downloader.git"
echo "     git push -u origin master"
echo "  3. 访问 https://railway.app"
echo "  4. New Project → Deploy from GitHub repo"
echo "  5. 选择仓库，自动部署，获取 URL"
echo ""
echo "【方式2: Render (免费)】"
echo "  1. 访问 https://render.com"
echo "  2. New → Web Service → 连接 GitHub 仓库"
echo "  3. 设置:"
echo "     Build: pip install -r requirements.txt"
echo "     Start: python server.py"
echo ""
echo "【方式3: 一键部署到 Railway】"
echo "  1. 访问 https://railway.app/new"
echo "  2. 点击 'Deploy from GitHub'"
echo "  3. 授权并选择仓库"
echo "  4. 完成!"
echo ""
echo "==================================="
