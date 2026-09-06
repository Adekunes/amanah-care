#!/bin/bash
# Bundles api-src/index.mjs (and the express api, projector, notifier, schema)
# into api/index.mjs, the one file Vercel runs as the /api function.
cd "$(dirname "$0")" || exit 1
NODE_PATH="$PWD/../api/node_modules:$PWD/../projector/node_modules:$PWD/../notifier/node_modules" npx -y esbuild@0.24.0 api-src/index.mjs --bundle --platform=node --format=esm --target=node20 \
  --loader:.sql=text --external:pg-native --external:pg-cloudflare \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
  --outfile=api/index.mjs --log-level=warning && echo "built api/index.mjs ($(wc -c < api/index.mjs | tr -d ' ') bytes)"
