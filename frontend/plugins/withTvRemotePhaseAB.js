// PR #24 Phase A+B wrapper: run the established TV remote plugin, then replace
// its two generated runtime files with the checked-in Phase A templates. This
// prevents Expo prebuild from silently restoring older focus behavior.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const withTvRemote = require("./withTvRemote");

const NS = "com.charmiptv.app";

function withPhaseAbTemplates(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const templateRoot = path.join(projectRoot, "plugins", "templates");
      const javaDir = path.join(androidRoot, "app", "src", "main", "java", ...NS.split("."));
      fs.mkdirSync(javaDir, { recursive: true });
      fs.copyFileSync(
        path.join(templateRoot, "TvRemoteModule.phaseAB.kt"),
        path.join(javaDir, "TvRemoteModule.kt"),
      );
      fs.copyFileSync(
        path.join(templateRoot, "MainActivity.phaseAB.kt"),
        path.join(javaDir, "MainActivity.kt"),
      );
      return cfg;
    },
  ]);
}

module.exports = function withTvRemotePhaseAB(config) {
  config = withTvRemote(config);
  config = withPhaseAbTemplates(config);
  return config;
};
