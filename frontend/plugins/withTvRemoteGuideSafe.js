const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const withTvRemote = require("./withTvRemote");

/**
 * Keep the established TV-remote plugin as the source for TvRemoteModule,
 * package registration, memory-pressure wiring, and Android TV behavior. After
 * it runs, pin MainActivity to the checked-in Guide-safe template so a future
 * Expo prebuild cannot silently remove the held-vertical stale-target guard.
 */
module.exports = function withTvRemoteGuideSafe(config) {
  config = withTvRemote(config);
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const template = path.join(__dirname, "templates", "MainActivity.guideSafe.kt");
      const target = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "charmiptv",
        "app",
        "MainActivity.kt",
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(template, target);
      return cfg;
    },
  ]);
};
