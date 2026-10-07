#!/usr/bin/env bash
# Build beside the live server, then swap. `next build` writes into its
# distDir as it goes, so building into the .next a running server reads from
# makes every request 500 for the two minutes it takes. Instead the build goes
# into .next-build (next.config.ts reads AGENTOS_DIST_DIR), is checked, and is
# renamed into .next right before the restart. The build it replaced stays in
# .next-prev for one rollback. A failed build never touches .next.
# Sourced by scripts/redeploy; run from the repository root.

LIVE=.next
NEXT_BUILD=.next-build
PREV=.next-prev

# Next rewrites these to point at the distDir it built into; put them back.
REWRITTEN=(tsconfig.json next-env.d.ts)

build_beside() {
  local cmd="${AGENTOS_BUILD_CMD:-npm run build}" saved f status=0
  rm -rf "$NEXT_BUILD"
  saved=$(mktemp -d)
  for f in "${REWRITTEN[@]}"; do [ -f "$f" ] && cp -p "$f" "$saved/"; done
  # The turbopack cache is the build's, not the server's: carry it forward so
  # a deploy stays incremental.
  if [ -d "$LIVE/cache" ]; then
    mkdir -p "$NEXT_BUILD" && mv "$LIVE/cache" "$NEXT_BUILD/cache"
  fi
  AGENTOS_DIST_DIR="$NEXT_BUILD" bash -c "$cmd" || status=$?
  for f in "${REWRITTEN[@]}"; do [ -f "$saved/$f" ] && cp -p "$saved/$f" "$f"; done
  rm -rf "$saved"
  # `next build` exits non-zero on a type error, so a build that got here
  # typechecked; a missing BUILD_ID means it stopped short anyway.
  if [ "$status" = 0 ] && [ ! -s "$NEXT_BUILD/BUILD_ID" ]; then
    echo "build finished without $NEXT_BUILD/BUILD_ID" >&2
    status=1
  fi
  if [ "$status" != 0 ]; then
    if [ -d "$NEXT_BUILD/cache" ] && [ -d "$LIVE" ] && [ ! -e "$LIVE/cache" ]; then
      mv "$NEXT_BUILD/cache" "$LIVE/cache"
    fi
    rm -rf "$NEXT_BUILD"
    echo "Build failed; the live $LIVE is untouched." >&2
    return 1
  fi
}

# Two renames on one filesystem: the live directory is never half-written,
# only absent for the instant between them.
swap_build() {
  [ -s "$NEXT_BUILD/BUILD_ID" ] || { echo "no verified build to swap in" >&2; return 1; }
  rm -rf "$PREV"
  [ -d "$LIVE" ] && mv "$LIVE" "$PREV"
  mv "$NEXT_BUILD" "$LIVE"
}

# Put the previous build back, keeping the current one as the next rollback.
rollback_build() {
  [ -s "$PREV/BUILD_ID" ] || { echo "no previous build in $PREV" >&2; return 1; }
  rm -rf "$NEXT_BUILD"
  mv "$PREV" "$NEXT_BUILD"
  swap_build
}
