// The app shares the server's protocol types and a few pure helpers from the
// repo's lib/ (chat events, shelves, timeline grouping). Metro watches only
// that folder, never the repo root, whose node_modules is the web app's.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.join(root, "lib")];
// Shared files in lib/ resolve packages from the app, never the web app's.
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];

const resolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  const shared = name.startsWith("@/lib/");
  const target = shared ? path.join(root, name.slice(2)) : name;
  return (resolve ?? context.resolveRequest)(context, target, platform);
};

// A module runs when it's first used, not all at launch, so the chat's
// markdown, highlighting and WebView code wait until a chat opens (19 MB less
// memory; README "Performance").
config.transformer.getTransformOptions = async () => ({
  transform: { experimentalImportSupport: true, inlineRequires: true },
});

module.exports = config;
