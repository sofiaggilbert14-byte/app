import { useFonts } from "expo-font";

export function useAppFonts(): readonly [boolean, Error | null] {
  return useFonts({
    Fraunces: require("../../assets/fonts/Fraunces.ttf"),
    Geist: require("../../assets/fonts/Geist-Regular.ttf"),
    "Geist-Medium": require("../../assets/fonts/Geist-Medium.ttf"),
    "Geist-SemiBold": require("../../assets/fonts/Geist-SemiBold.ttf"),
    "Geist-Bold": require("../../assets/fonts/Geist-Bold.ttf"),
  });
}
