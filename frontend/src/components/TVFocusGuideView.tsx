import React from "react";
import { View, ViewProps } from "react-native";

// react-native-tvos ships a real TVFocusGuideView; react-native-web / plain RN
// do not. We resolve it at runtime and fall back to a plain View so the same
// tree renders everywhere (web preview, phones, and Android TV).
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
};

export function FocusGuide({
  autoFocus,
  trapFocusUp,
  trapFocusDown,
  trapFocusLeft,
  trapFocusRight,
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
        {...rest}
      >
        {children}
      </Native>
    );
  }
  // Non-TV platforms: strip TV-only props (already destructured) and render a View.
  return <View {...rest}>{children}</View>;
}
