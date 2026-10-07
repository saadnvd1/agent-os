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
LOCK=.next-build.lock

# Next rewrites these to point at the distDir it built into; put them back.
REWRITTEN=(tsconfig.json next-env.d.ts)

# One build at a time: two would share .next-build. A lock older than 30
# minutes is from a run that died. Released when the shell exits.
acquire_build_lock() {
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30)" ]; then
    rmdir "$LOCK"
  fi
  mkdir "$LOCK" 2>/dev/null || { echo "Another redeploy is building ($LOCK)" >&2; return 1; }
  trap 'rmdir "$LOCK"' EXIT
}

build_beside() {
  local cmd="${AGENTOS_BUILD_CMD:-npm run build}" saved f status=0
  rm -rf "$NEXT_BUILD"
  saved=$(mktemp -d)
  for f in "${REWRITTEN[@]}"; do [ -f "$f" ] && cp -p "$f" "$saved/"; done
  # Seed the build with the last one's turbopack cache so a deploy stays
  # incremental. A copy (a clone where the filesystem can), so .next itself is
  # never touched before the swap.
  if [ -d "$LIVE/cache" ]; then
    local clone=--reflink=auto
    [ "$(uname -s)" = Darwin ] && clone=-c
    mkdir -p "$NEXT_BUILD"
    cp -R "$clone" "$LIVE/cache" "$NEXT_BUILD/cache" || rm -rf "$NEXT_BUILD/cache"
  fi
  # tsconfig includes the live build's generated route types too; a route this
  # build deleted would fail its typecheck against them. The server never reads
  # them, so hide them for the build.
  [ -d "$LIVE/types" ] && mv "$LIVE/types" "$LIVE/types.building"
  AGENTOS_DIST_DIR="$NEXT_BUILD" bash -c "$cmd" || status=$?
  [ -d "$LIVE/types.building" ] && mv "$LIVE/types.building" "$LIVE/types"
  for f in "${REWRITTEN[@]}"; do [ -f "$saved/$f" ] && cp -p "$saved/$f" "$f"; done
  rm -rf "$saved"
  # `next build` exits non-zero on a type error, so a build that got here
  # typechecked; a missing BUILD_ID means it stopped short anyway.
  if [ "$status" = 0 ] && [ ! -s "$NEXT_BUILD/BUILD_ID" ]; then
    echo "build finished without $NEXT_BUILD/BUILD_ID" >&2
    status=1
  fi
  if [ "$status" != 0 ]; then
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
