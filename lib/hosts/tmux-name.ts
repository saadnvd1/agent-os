// No imports: the browser checks names with it too.
const TMUX_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isValidTmuxName(name: string): boolean {
  return TMUX_NAME_PATTERN.test(name);
}
