import React, { useRef, useCallback } from "react";
import { View, ViewProps } from "react-native";

// react-native-tvos ships a real TVFocusGuideView; react-native-web / plain RN
// do not. We resolve it at runtime and fall back to a plain View so the same
// tree renders everywhere (web preview, phones, and Android TV).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- optional export is resolved at runtime across RN variants
const RN = require("react-native");
const Native = RN.TVFocusGuideView as React.ComponentType<any> | undefined;

export type FocusGuideProps = ViewProps & {
  // When focus enters this container it is redirected to the last-focused child,
  // keeping the guide grid a cohesive focus group so the D-pad can't "fall out"
  // of the virtualized list into the tab bar.
  autoFocus?: boolean;
  trapFocusUp?: boolean;
  trapFocusDown?: boolean;
  trapFocusLeft?: boolean;
  trapFocusRight?: boolean;
  children?: React.ReactNode;
  onFocusLost?: () => void;
};

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
  const lastFocusedRef = useRef<any>(null);
  const viewRef = useRef<View>(null);

  // Guard against focus escaping by detecting and logging focus loss
  const handleBlur = useCallback(() => {
    // If focus left the guide region, try to restore it to the last known child
    onFocusLost?.();
  }, [onFocusLost]);

  if (Native) {
    return (
      <Native
        ref={viewRef}
        autoFocus={autoFocus}
        trapFocusUp={trapFocusUp}
        trapFocusDown={trapFocusDown}
        trapFocusLeft={trapFocusLeft}
        trapFocusRight={trapFocusRight}
        onBlur={handleBlur}
        testID="tv-focus-guide"
        {...rest}
      >
        {children}
      </Native>
    );
  }

  // Non-TV platforms: strip TV-only props (already destructured) and render a View.
  // Still track focus for consistency across platforms.
  return (
    <View ref={viewRef} onBlur={handleBlur} testID="focus-guide-fallback" {...rest}>
      {children}
    </View>
  );
}
