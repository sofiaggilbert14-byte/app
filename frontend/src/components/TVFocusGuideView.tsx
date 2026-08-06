import React from "react";
import { View, ViewProps } from "react-native";

// react-native-tvos ships a real TVFocusGuideView; react-native-web / plain RN
// do not. We resolve it at runtime and fall back to a plain View so the same
// tree renders everywhere (web preview, phones, and Android TV).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- optional export is resolved at runtime across RN variants
const RN = require("react-native");
const Native = RN.TVFocusGuideView as React.ComponentType<any> | undefined;

export type FocusGuideProps = ViewProps & {
  autoFocus?: boolean;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  children?: React.ReactNode;
  onFocusLost?: () => void;
};

/**
 * Thin TV focus guide wrapper.
 * Intentionally does NOT restore focus on blur — that race fights chips/modals/grids
 * on Fire TV and is a major source of focus lag/jumps.
 */
export function FocusGuide({
  autoFocus,
  trapFocusUp,
  trapFocusDown,
  trapFocusLeft,
  trapFocusRight,
  onFocusLost,
  children,
  ...rest
}: FocusGuideProps) {
  if (Native) {
    return (
      <Native
        autoFocus={autoFocus}
        trapFocusUp={trapFocusUp}
        trapFocusDown={trapFocusDown}
        trapFocusLeft={trapFocusLeft}
        trapFocusRight={trapFocusRight}
        onBlur={onFocusLost}
        testID="tv-focus-guide"
        {...rest}
      >
        {children}
      </Native>
    );
  }

  return (
    <View onBlur={onFocusLost} testID="focus-guide-fallback" {...rest}>
      {children}
    </View>
  );
}

/** Attach to Pressable onFocus: `onFocus={(e) => trackFocus(focusTracker, e, handler)}` */
export function trackFocus(
  tracker: React.MutableRefObject<unknown>,
  node: unknown,
  onFocus?: () => void,
) {
  if (node) tracker.current = node;
  onFocus?.();
}
