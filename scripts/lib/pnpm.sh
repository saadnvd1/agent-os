#!/usr/bin/env bash
# Make `pnpm` runnable: the pinned version comes from package.json's
# packageManager field through corepack (bundled with Node 22; Node 25+ needs
# `npm i -g corepack`). Sourced by scripts/install-deps and scripts/redeploy.

use_pnpm() {
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    corepack enable pnpm >/dev/null 2>&1 || true
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is not available. Use Node 22 (it bundles corepack: corepack enable pnpm) or npm i -g corepack." >&2
    return 1
  fi
}

# Share -> Download -> PDF prints with Playwright's headless shell, at the
# revision the locked playwright package names. A failed download only warns:
# a deploy must not hang on a CDN, and the PDF option hides itself without a
# browser. Run after the install, from the repository root.
install_pdf_browser() {
  if ! pnpm exec playwright install chromium-headless-shell; then
    echo "Warning: could not download the PDF browser; share PDF is unavailable until 'pnpm exec playwright install chromium-headless-shell' succeeds." >&2
    return 0
  fi
  if [ "$(uname -s)" = Linux ]; then
    local bin missing
    bin=$(node -e 'const p=require("playwright").chromium.executablePath();const fs=require("fs"),path=require("path");const root=path.dirname(path.dirname(path.dirname(p)));const d=fs.readdirSync(root).filter(x=>x.startsWith("chromium_headless_shell-")).sort().pop();if(d){const b=fs.readdirSync(path.join(root,d)).find(x=>x.startsWith("chrome-headless-shell-"));if(b)console.log(path.join(root,d,b,"chrome-headless-shell"))}' 2>/dev/null || true)
    if [ -n "$bin" ] && command -v ldd >/dev/null 2>&1; then
      missing=$(ldd "$bin" 2>/dev/null | grep -c 'not found' || true)
      if [ "${missing:-0}" -gt 0 ]; then
        echo "Warning: the PDF browser is missing $missing system libraries; run: sudo pnpm exec playwright install-deps chromium-headless-shell" >&2
      fi
    fi
  fi
}
