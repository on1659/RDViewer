#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13 이상이 필요합니다."
  read -r "?Enter를 누르면 닫습니다."
  exit 1
fi
if [[ ! -f node_modules/markdown-it/dist/markdown-it.min.js ]]; then
  npm ci --no-audit --no-fund
fi
if [[ $# -gt 0 && -d "$1" ]]; then
  node open.mjs --root "$1"
elif [[ $# -gt 0 ]]; then
  node open.mjs --root ../.. "$1"
else
  node open.mjs --root ../..
fi
