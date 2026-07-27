#!/usr/bin/env bash
# Cloudflare Worker 一键检查与部署

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "错误: 需要安装 Node.js 20 或更高版本" >&2
    exit 1
fi

echo "安装锁定依赖..."
npm ci

echo "运行类型检查和测试..."
npm run check

echo "部署到 Cloudflare Workers..."
npm run deploy

echo "部署完成。首次部署还需配置 PROXY_SIGNING_KEY，详见 README.md。"
