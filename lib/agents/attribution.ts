// Claude Code's `attribution` setting, with every part hidden: no
// Co-Authored-By trailer on commits, no "Generated with Claude Code" line in
// PR bodies, no session link. The object form, as the Agent SDK's Settings
// type (sdk.d.ts, `attribution`) recommends: an empty string hides a part,
// and older Claude Code versions reject a bare `false`. Passed in the flag
// settings layer, so it wins over the user's own settings.json.
export const NO_ATTRIBUTION = {
  commit: "",
  pr: "",
  sessionUrl: false,
};
