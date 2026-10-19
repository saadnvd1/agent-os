#!/usr/bin/env bash
# Install dependencies beside the live ones, prove the native modules work in
# them, and only then swap them in. A deploy that brings a broken install
# fails here, and the node_modules the running server reads is never touched.
# The tree being replaced stays in .deps/prev for one rollback.
# Sourced by scripts/redeploy; run from the repository root, after use_pnpm.
# Test hooks: AGENTOS_INSTALL_CMD (default `pnpm install --frozen-lockfile`),
# AGENTOS_NATIVE_CHECK (default `node scripts/check-native.mjs <dir>`).

DEPS=.deps
STAGE=$DEPS/stage
PREV=$DEPS/prev
STAMP=.agentos-deps

# What an install depends on. A new Node or CPU rebuilds the native modules.
deps_stamp() {
  {
    cat package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc 2>/dev/null
    node -p 'process.version + process.platform + process.arch'
  } | shasum -a 256 | cut -d' ' -f1
}

# 0 and a staged tree to swap in, or 10 when the live install is already
# right, or 1 with the live tree untouched.
install_beside() {
  local stamp
  stamp=$(deps_stamp)
  if [ -d node_modules ] && [ "$(cat "node_modules/$STAMP" 2>/dev/null)" = "$stamp" ]; then
    echo "Dependencies unchanged."
    # The last build ran on these same dependencies, so a rollback has
    # nothing to put back.
    rm -rf "$PREV"
    return 10
  fi
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$STAGE/"
  [ -f .npmrc ] && cp .npmrc "$STAGE/"
  # HUSKY=0: the staged copy is not a git checkout.
  if ! (cd "$STAGE" && HUSKY=0 bash -c "${AGENTOS_INSTALL_CMD:-pnpm install --frozen-lockfile}"); then
    rm -rf "$STAGE"
    echo "Install failed; the live node_modules is untouched." >&2
    return 1
  fi
  if ! bash -c "${AGENTOS_NATIVE_CHECK:-node scripts/check-native.mjs \"\$1\"}" _ "$STAGE/node_modules"; then
    rm -rf "$STAGE"
    echo "Native modules do not load in the new install; the live node_modules is untouched." >&2
    return 1
  fi
  echo "$stamp" > "$STAGE/node_modules/$STAMP"
}

swap_deps() {
  [ -d "$STAGE/node_modules" ] || { echo "no checked install to swap in" >&2; return 1; }
  rm -rf "$PREV"
  mkdir -p "$DEPS"
  [ -d node_modules ] && mv node_modules "$PREV"
  mv "$STAGE/node_modules" node_modules
  rm -rf "$STAGE"
}

# Put the node_modules from before the last swap back (a failed build, or
# `redeploy --rollback`); the current one is dropped.
restore_deps() {
  [ -d "$PREV" ] || return 0
  rm -rf node_modules
  mv "$PREV" node_modules
}
