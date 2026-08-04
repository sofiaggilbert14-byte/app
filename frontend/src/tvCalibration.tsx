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
  setSide: (side: keyof TvCalibration, value: number) => void;
  reset: () => void;
};

const DEFAULT_CALIBRATION: TvCalibration = { left: 0, right: 0, top: 0, bottom: 0 };
const STORAGE_KEY = "charm_tv_calibration_v1";
const MAX_INSET = 96;
const Ctx = createContext<TvCalibrationContextValue | null>(null);

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_INSET, Math.round(value)));
}

export function TvCalibrationProvider({ children }: { children: React.ReactNode }) {
  const [calibration, setCalibration] = useState<TvCalibration>(DEFAULT_CALIBRATION);

  useEffect(() => {
    let active = true;
    storage.getItem<TvCalibration>(STORAGE_KEY, DEFAULT_CALIBRATION).then((saved) => {
      if (!active || !saved) return;
      setCalibration({
        left: clamp(saved.left),
        right: clamp(saved.right),
        top: clamp(saved.top),
        bottom: clamp(saved.bottom),
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((next: TvCalibration) => {
    setCalibration(next);
    void storage.setItem(STORAGE_KEY, next);
  }, []);

  const setSide = useCallback(
    (side: keyof TvCalibration, value: number) => {
      setCalibration((current) => {
        const next = { ...current, [side]: clamp(value) };
        void storage.setItem(STORAGE_KEY, next);
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => persist(DEFAULT_CALIBRATION), [persist]);

  const value = useMemo(() => ({ calibration, setSide, reset }), [calibration, reset, setSide]);
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
