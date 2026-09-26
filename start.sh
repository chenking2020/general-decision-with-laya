#!/usr/bin/env bash
# 一键启动：后端 8000（FastAPI + 本地 laya 权重），前端构建产物由后端托管。
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "==> 创建虚拟环境并安装依赖"
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -r server/requirements.txt
fi

if [ ! -d web/node_modules ]; then
  echo "==> 安装前端依赖"
  (cd web && npm install --silent)
fi

if [ ! -f web/dist/index.html ]; then
  echo "==> 构建前端"
  (cd web && npm run build)
fi

echo "==> 启动后端 http://127.0.0.1:8000"
exec .venv/bin/python server/run.py --host 127.0.0.1 --port 8000
