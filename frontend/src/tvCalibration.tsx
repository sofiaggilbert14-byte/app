import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform, StyleProp, View, ViewStyle } from "react-native";
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
const STORAGE_KEY = "charm_tv_calibration_v1";
const MAX_INSET = 96;
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

export function TvCalibrationProvider({ children }: { children: React.ReactNode }) {
  const [calibration, setCalibration] = useState<TvCalibration>(DEFAULT_CALIBRATION);
  const [draftCalibration, setDraftCalibration] = useState<TvCalibration>(DEFAULT_CALIBRATION);

  useEffect(() => {
    let active = true;
    storage.getItem<TvCalibration>(STORAGE_KEY, DEFAULT_CALIBRATION).then((saved) => {
      if (!active || !saved) return;
      const next = normalize(saved);
      setCalibration(next);
      setDraftCalibration(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const setSide = useCallback((side: keyof TvCalibration, value: number) => {
    setDraftCalibration((current) => ({ ...current, [side]: clamp(value) }));
  }, []);

  const save = useCallback(async () => {
    const next = normalize(draftCalibration);
    // Updating provider state applies the new frame padding immediately across
    // every mounted TV screen; persistence happens in the same user action.
    setCalibration(next);
    setDraftCalibration(next);
    await storage.setItem(STORAGE_KEY, next);
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

  // Overscan is primarily a TV problem. Phones/tablets keep their normal safe-area behavior.
  const calibratedStyle: StyleProp<ViewStyle> = Platform.isTV
    ? {
        flex: 1,
        paddingLeft: calibration.left,
        paddingRight: calibration.right,
        paddingTop: calibration.top,
        paddingBottom: calibration.bottom,
      }
    : { flex: 1 };

  return <View style={[calibratedStyle, style]}>{children}</View>;
}

export const TV_CALIBRATION_MAX_INSET = MAX_INSET;
