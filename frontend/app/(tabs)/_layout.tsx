import React from "react";
import { Tabs } from "expo-router";
import { PurpleTvDrawerProvider } from "@/src/components/PurpleTvShell";

export default function TabsLayout() {
  return (
    <PurpleTvDrawerProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
          sceneStyle: { backgroundColor: "#070711" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Live TV" }} />
        <Tabs.Screen name="guide" options={{ title: "TV Guide" }} />
        <Tabs.Screen name="channels" options={{ title: "Channels" }} />
        <Tabs.Screen name="movies" options={{ title: "Movies" }} />
        <Tabs.Screen name="series" options={{ title: "Series" }} />
        <Tabs.Screen name="catchup" options={{ title: "Catch Up" }} />
        <Tabs.Screen name="favorites" options={{ title: "Favorites" }} />
        <Tabs.Screen name="reminders" options={{ title: "Reminders" }} />
        <Tabs.Screen name="search" options={{ title: "Search" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
        <Tabs.Screen name="epg-sources" options={{ title: "EPG Sources" }} />
      </Tabs>
    </PurpleTvDrawerProvider>
  );
}
