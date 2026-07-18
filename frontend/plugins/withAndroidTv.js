// Expo config plugin: make the Android app installable and launchable on
// Android TV / TV boxes by declaring TV feature support and adding the
// LEANBACK_LAUNCHER category to the main launcher activity.
const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

module.exports = function withAndroidTv(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    // --- uses-feature: touchscreen + leanback both optional so it installs on
    // phones AND TVs ---
    manifest.manifest["uses-feature"] = manifest.manifest["uses-feature"] || [];
    const addFeature = (name) => {
      const exists = manifest.manifest["uses-feature"].some(
        (f) => f.$ && f.$["android:name"] === name,
      );
      if (!exists) {
        manifest.manifest["uses-feature"].push({
          $: { "android:name": name, "android:required": "false" },
        });
      }
    };
    addFeature("android.hardware.touchscreen");
    addFeature("android.software.leanback");

    // --- add LEANBACK_LAUNCHER category to the main launcher activity ---
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    (app.activity || []).forEach((activity) => {
      (activity["intent-filter"] || []).forEach((filter) => {
        const categories = filter.category || [];
        const isLauncher = categories.some(
          (c) => c.$ && c.$["android:name"] === "android.intent.category.LAUNCHER",
        );
        const hasLeanback = categories.some(
          (c) => c.$ && c.$["android:name"] === "android.intent.category.LEANBACK_LAUNCHER",
        );
        if (isLauncher && !hasLeanback) {
          categories.push({
            $: { "android:name": "android.intent.category.LEANBACK_LAUNCHER" },
          });
          filter.category = categories;
        }
      });
    });

    return cfg;
  });
};
