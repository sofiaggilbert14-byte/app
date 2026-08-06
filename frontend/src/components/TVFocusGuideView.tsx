import React, { useRef, useCallback, useEffect } from "react";
import { View, ViewProps } from "react-native";
import { requestNativeFocusWithRetry } from "@/src/utils/tvFocus";

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
  const lastFocusedRef = useRef<unknown>(null);
  const viewRef = useRef<View>(null);
  const restoreCleanupRef = useRef<(() => void) | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restoreFocus = useCallback(() => {
    if (restoreCleanupRef.current) {
      restoreCleanupRef.current();
      restoreCleanupRef.current = null;
    }
    if (lastFocusedRef.current) {
      restoreCleanupRef.current = requestNativeFocusWithRetry(lastFocusedRef.current);
    }
  }, []);

  const handleBlur = useCallback(() => {
    onFocusLost?.();
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    restoreTimerRef.current = setTimeout(restoreFocus, 120);
  }, [onFocusLost, restoreFocus]);

  useEffect(
    () => () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      if (restoreCleanupRef.current) restoreCleanupRef.current();
    },
    [],
  );

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

  return (
    <View ref={viewRef} onBlur={handleBlur} testID="focus-guide-fallback" {...rest}>
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
