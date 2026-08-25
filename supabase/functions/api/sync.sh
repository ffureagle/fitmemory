#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
dest="$root/supabase/functions/api"
cp "$root/api/src/app.js" "$dest/app.js"
cp "$root/api/src/engine.js" "$dest/engine.js"
cp "$root/api/src/config.js" "$dest/config.js"
cp "$root/api/src/store-supabase.js" "$dest/store-supabase.js"
echo "Copied FitMemory API sources into supabase/functions/api"
