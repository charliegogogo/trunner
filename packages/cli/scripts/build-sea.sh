#!/usr/bin/env bash
# Build a single-executable application (SEA) for macOS / Linux.
# Uses Node 25.5+ `node --build-sea` (one-step blob + inject, no postject).
# Usage: pnpm -F @trunner/cli build:sea
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

SEA_CONFIG="sea-config.json"
OUT="dist/trunner"

if [ ! -f "$SEA_CONFIG" ]; then
  echo "SEA: missing $SEA_CONFIG" >&2
  exit 1
fi

if [ ! -f "dist/trunner.mjs" ]; then
  echo "SEA: dist/trunner.mjs not found — run 'pnpm build' first" >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "SEA: node not on PATH" >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 25 ]; then
  echo "SEA: --build-sea requires Node 25.5+ (you have $("$NODE_BIN" -v))" >&2
  echo "SEA: install Node 25.5+ or fall back to the postject pipeline manually" >&2
  exit 1
fi

echo "SEA: using node at $NODE_BIN ($("$NODE_BIN" -v))"
echo "SEA: building single executable from $SEA_CONFIG"
if [ "$(uname -s)" = "Darwin" ] && [ -f "$OUT" ]; then
  echo "SEA: stripping existing signature (macOS)"
  codesign --remove-signature "$OUT" 2>/dev/null || true
fi
node --build-sea "$SEA_CONFIG"

echo "SEA: re-signing (macOS)"
if [ "$(uname -s)" = "Darwin" ]; then
  codesign --sign - --force --deep "$OUT" 2>/dev/null || true
fi

echo "SEA: done — $OUT"
ls -lh "$OUT" || true
