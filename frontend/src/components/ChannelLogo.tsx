import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { colors, fonts, radius } from "@/src/theme";

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function ChannelLogoComponent({
  name,
  logo,
  size = 48,
  disabled = false,
}: {
  name: string;
  logo?: string;
  size?: number;
  disabled?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [logo]);
  const showImage = !disabled && logo && logo.startsWith("http") && !failed;
  if (showImage) {
    return (
      <Image
        source={{ uri: logo }}
        style={{ width: size, height: size, borderRadius: radius.sm }}
        contentFit="contain"
        cachePolicy="memory-disk"
        recyclingKey={logo}
        transition={0}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.fallback, { width: size, height: size }]}>
      <Text style={[styles.initials, { fontSize: size * 0.34 }]}>{initials(name)}</Text>
    </View>
  );
}

export const ChannelLogo = React.memo(ChannelLogoComponent);

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { color: colors.onBrandTertiary, fontFamily: fonts.bold },
});
