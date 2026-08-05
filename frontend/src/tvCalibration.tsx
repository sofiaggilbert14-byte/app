import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleProp, useWindowDimensions, View, ViewStyle } from "react-native";
import { storage } from "@/src/utils/storage";

export type TvCalibration = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type TvCalibrationContextValue = {
  calibration: TvCalibration;
  draftCalibration: TvCalibration;
  setSide: (side: keyof TvCalibration, value: number) => void;
  save: () => Promise<void>;
  reset: () => void;
  discard: () => void;
  hasChanges: boolean;
};

const DEFAULT_CALIBRATION: TvCalibration = { left: 0, right: 0, top: 0, bottom: 0 };
const STORAGE_KEY = "charm_tv_calibration_v2";
const LEGACY_STORAGE_KEY = "charm_tv_calibration_v1";
const MAX_INSET = 64;
const Ctx = createContext<TvCalibrationContextValue | null>(null);

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_INSET, Math.round(value)));
}

function normalize(value: TvCalibration): TvCalibration {
  return {
    left: clamp(value.left),
    right: clamp(value.right),
    top: clamp(value.top),
    bottom: clamp(value.bottom),
  };
}

function sameCalibration(a: TvCalibration, b: TvCalibration): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
}

export function getTvCalibrationLimit(side: keyof TvCalibration, width: number, height: number): number {
  const horizontal = Math.max(12, Math.min(48, Math.round(Math.max(1, width) * 0.05)));
  const vertical = Math.max(10, Math.min(32, Math.round(Math.max(1, height) * 0.05)));
  return side === "left" || side === "right" ? horizontal : vertical;
}

export function TvCalibrationProvider({ children }: { children: React.ReactNode }) {
  const [calibration, setCalibration] = useState<TvCalibration>(DEFAULT_CALIBRATION);
  const [draftCalibration, setDraftCalibration] = useState<TvCalibration>(DEFAULT_CALIBRATION);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = await storage.getItem<TvCalibration | null>(STORAGE_KEY, null);
      const legacy = saved || (await storage.getItem<TvCalibration | null>(LEGACY_STORAGE_KEY, null));
      if (!active || !legacy) return;
      const next = normalize(legacy);
      setCalibration(next);
      setDraftCalibration(next);
      if (!saved) {
        await storage.setItem(STORAGE_KEY, next);
        await storage.removeItem(LEGACY_STORAGE_KEY);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setSide = useCallback((side: keyof TvCalibration, value: number) => {
    setDraftCalibration((current) => ({ ...current, [side]: clamp(value) }));
  }, []);

  const save = useCallback(async () => {
    // A held OK button can fire two presses before React paints `saving=true` in
    // the controls. Keep an independent synchronous guard here so calibration
    // can never apply twice concurrently to the root TV frame.
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    try {
      const next = normalize(draftCalibration);
      setCalibration(next);
      setDraftCalibration(next);
      await storage.setItem(STORAGE_KEY, next);
    } finally {
      saveInFlightRef.current = false;
    }
  }, [draftCalibration]);

  const reset = useCallback(() => {
    setDraftCalibration(DEFAULT_CALIBRATION);
  }, []);

  const discard = useCallback(() => {
    setDraftCalibration(calibration);
  }, [calibration]);

  const hasChanges = useMemo(
    () => !sameCalibration(calibration, draftCalibration),
    [calibration, draftCalibration],
  );

  const value = useMemo(
    () => ({ calibration, draftCalibration, setSide, save, reset, discard, hasChanges }),
    [calibration, discard, draftCalibration, hasChanges, reset, save, setSide],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTvCalibration(): TvCalibrationContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useTvCalibration must be used inside TvCalibrationProvider");
  return value;
}

export function TvCalibrationFrame({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { calibration } = useTvCalibration();
  const { width, height } = useWindowDimensions();

  // Hardware TV overscan itself is not exposed to Android. The automatic safe
  // zone is handled by getTvSafeInsets(); this frame is only the user's extra
  // correction. Clamp it against the current window so repeated adjustments can
  // never collapse the root content area or destabilize TV focus/layout.
  const calibratedStyle: StyleProp<ViewStyle> = Platform.isTV
    ? {
        flex: 1,
        paddingLeft: Math.min(calibration.left, getTvCalibrationLimit("left", width, height)),
        paddingRight: Math.min(calibration.right, getTvCalibrationLimit("right", width, height)),
        paddingTop: Math.min(calibration.top, getTvCalibrationLimit("top", width, height)),
        paddingBottom: Math.min(calibration.bottom, getTvCalibrationLimit("bottom", width, height)),
      }
    : { flex: 1 };

  return <View style={[calibratedStyle, style]}>{children}</View>;
}

export const TV_CALIBRATION_MAX_INSET = MAX_INSET;
