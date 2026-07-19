import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, fonts, radius, spacing } from "@/src/theme";

type Props = {
  children: React.ReactNode;
  // Optional custom fallback; receives a reset() to try re-rendering children.
  fallback?: (reset: () => void) => React.ReactNode;
  onReset?: () => void;
};

type State = { hasError: boolean };

// Catches JS render/lifecycle errors anywhere in its subtree so a single screen
// (e.g. the player) can never white-screen / take down the whole app.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[ErrorBoundary] caught", error);
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.sub}>The screen hit an unexpected error. Try again.</Text>
        <Pressable
          style={({ focused }: any) => [styles.btn, focused && styles.btnFocused]}
          onPress={this.reset}
          hasTVPreferredFocus
          testID="error-boundary-retry"
        >
          <Text style={styles.btnText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontFamily: fonts.bold, fontSize: 18 },
  sub: { color: colors.onSurfaceTertiary, fontFamily: fonts.regular, fontSize: 14, textAlign: "center" },
  btn: { backgroundColor: colors.brand, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: "transparent" },
  btnFocused: { borderColor: "#fff" },
  btnText: { color: "#fff", fontFamily: fonts.semibold, fontSize: 15 },
});
