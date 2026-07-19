import React, { useState } from "react";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, fonts } from "@/src/theme";

// Custom tab button that highlights when focused by a TV remote's D-pad.
function TabBarButton({ style, children, onFocus, onBlur, ...rest }: any) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        style,
        { alignItems: "center", justifyContent: "center" },
        focused && { backgroundColor: colors.brandTertiary, borderRadius: 10, borderWidth: 2, borderColor: "#fff" },
      ]}
    >
      {children}
    </Pressable>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenListeners={{
        tabPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      }}
      screenOptions={{
        headerShown: false,
        tabBarPosition: "top",
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.onSurfaceTertiary,
        tabBarButton: (props) => <TabBarButton {...props} />,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          height: 60 + insets.top,
          paddingTop: insets.top + 4,
          paddingBottom: 4,
        },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "TV Guide",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: "Favorites",
          tabBarIcon: ({ color, size }) => <Ionicons name="star" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
