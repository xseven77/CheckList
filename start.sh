#!/usr/bin/env bash
set -e

# 进入项目根目录
cd "$(dirname "$0")"

PORT="${PORT:-3000}"

echo "🚀 [CheckList] 检查依赖..."
if [ ! -d "node_modules" ]; then
  echo "📦 未检测到依赖，正在执行 npm install..."
  npm install
fi

echo "🔨 [CheckList] 正在构建项目 (next build)..."
npm run build

echo "✨ [CheckList] 启动服务 (端口: ${PORT})..."
export PORT
exec npm start
