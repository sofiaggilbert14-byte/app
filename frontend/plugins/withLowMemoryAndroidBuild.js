const { withGradleProperties } = require("@expo/config-plugins");

function setProperty(properties, key, value) {
  const existing = properties.find(
    (item) => item.type === "property" && item.key === key,
  );

  if (existing) {
    existing.value = value;
    return;
  }

  properties.push({ type: "property", key, value });
}

module.exports = function withLowMemoryAndroidBuild(config) {
  return withGradleProperties(config, (gradleConfig) => {
    const properties = gradleConfig.modResults;

    // Keep Android builds reliable on development laptops with limited RAM.
    setProperty(
      properties,
      "org.gradle.jvmargs",
      "-Xmx768m -XX:MaxMetaspaceSize=512m -Xss512k -XX:+UseSerialGC -Dfile.encoding=UTF-8",
    );
    setProperty(properties, "org.gradle.parallel", "false");
    setProperty(properties, "org.gradle.workers.max", "2");
    setProperty(properties, "kotlin.daemon.jvmargs", "-Xmx384m");
    setProperty(properties, "kotlin.compiler.execution.strategy", "in-process");

    // Phoenix targets Android TV and Fire TV hardware, which use ARM ABIs.
    // An emulator ABI can still be supplied from the command line when needed.
    setProperty(
      properties,
      "reactNativeArchitectures",
      "armeabi-v7a,arm64-v8a",
    );

    return gradleConfig;
  });
};
