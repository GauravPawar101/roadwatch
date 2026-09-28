#!/usr/bin/env bash
# Fails when compiled output sits beside TypeScript sources in a package source
# tree.
#
# Why this exists: a committed `.js` next to a `.ts` shadows it. Node resolves
# `./x.js` to the emitted file, so the stale copy is loaded at runtime while the
# source looks correct — and TypeScript consumers pick up the stale `.d.ts`
# instead of the real types. During this work a 6-day-old `endpoints.js` was
# being loaded in preference to the current `endpoints.ts`, so newly added
# exports were `undefined` at runtime while `tsc` reported zero errors.
#
# `.gitignore` prevents these from being *committed*; it does nothing about
# files already on disk, which is how they came back. This checks the working
# tree, so a stray `tsc` run without `outDir` is caught at the gate rather than
# discovered as a mystifying test failure.
#
# Usage: ops/verify/no-shadowing-build-output.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Only the hand-written shims are legitimate .d.ts files in a source tree.
ALLOW=(
  "packages/core/src/react-native-config.d.ts"
  "apps/gateway-api/src/types.d.ts"
  "apps/gateway-api/src/types/form-data.d.ts"
  "backend-api/src/types/express.d.ts"
  "frontend/src/types/sql-js.d.ts"
  "packages/providers/src/types.d.ts"
)

is_allowed() {
  local candidate="$1" allow
  for allow in "${ALLOW[@]}"; do
    [[ "$candidate" == "$allow" ]] && return 0
  done
  return 1
}

shadows=()
while IFS= read -r file; do
  is_allowed "$file" && continue
  shadows+=("$file")
done < <(
  find packages/*/src apps/*/src services/*/src backend-api/src frontend/src \
    \( -name '*.js' -o -name '*.js.map' -o -name '*.d.ts' -o -name '*.d.ts.map' \) \
    -type f 2>/dev/null | sort
)

if [[ ${#shadows[@]} -eq 0 ]]; then
  echo "OK: no compiled output shadowing TypeScript sources."
  exit 0
fi

cat >&2 <<EOF
ERROR: ${#shadows[@]} compiled file(s) sit beside TypeScript sources and will shadow them:

$(printf '  %s\n' "${shadows[@]}")

A stale .js is what Node loads at runtime, and a stale .d.ts is what other
packages resolve, so both make the code appear to work while running something
else. Remove them and build to dist/ instead:

  find packages/*/src apps/*/src services/*/src backend-api/src frontend/src \\
    \\( -name '*.js' -o -name '*.js.map' -o -name '*.d.ts' -o -name '*.d.ts.map' \\) \\
    -type f -delete

The hand-written declaration shims listed in ops/verify/no-shadowing-build-output.sh
are excluded.
EOF
exit 1
