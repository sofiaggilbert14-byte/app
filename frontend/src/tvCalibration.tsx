import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { usePathname } from "expo-router";
import { storage } from "@/src/utils/storage";
import { combineTvEdgeInsets } from "@/src/utils/tvLayout";

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
const STORAGE_KEY = "charm_tv_calibration_v3";
export const TV_CALIBRATION_MIN_OFFSET = -96;
export const TV_CALIBRATION_MAX_OFFSET = 96;
const Ctx = createContext<TvCalibrationContextValue | null>(null);

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(TV_CALIBRATION_MIN_OFFSET, Math.min(TV_CALIBRATION_MAX_OFFSET, Math.round(value)));
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
  const saveInFlightRef = useRef(false);
  const hydrationMutationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const loadEpoch = hydrationMutationRef.current;
    storage.getItem<TvCalibration>(STORAGE_KEY, DEFAULT_CALIBRATION).then((saved) => {
      if (!active || !saved || loadEpoch !== hydrationMutationRef.current) return;
      const next = normalize(saved);
      setCalibration(next);
      setDraftCalibration(next);
    });
    return () => { active = false; };
  }, []);

  const setSide = useCallback((side: keyof TvCalibration, value: number) => {
    hydrationMutationRef.current += 1;
    setDraftCalibration((current) => ({ ...current, [side]: clamp(value) }));
  }, []);

  const save = useCallback(async () => {
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

  const reset = useCallback(() => { hydrationMutationRef.current += 1; setDraftCalibration(DEFAULT_CALIBRATION); }, []);
  const discard = useCallback(() => { hydrationMutationRef.current += 1; setDraftCalibration(calibration); }, [calibration]);
  const hasChanges = useMemo(() => !sameCalibration(calibration, draftCalibration), [calibration, draftCalibration]);
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
  const pathname = usePathname();
  const { calibration } = useTvCalibration();
  const playerEdges = useMemo(
    () => combineTvEdgeInsets({ top: 0, right: 0, bottom: 0, left: 0 }, calibration),
    [calibration],
  );
  const fullscreenPlayer = pathname === "/player" || pathname.startsWith("/player/");
  const playerStyle = fullscreenPlayer
    ? {
        paddingTop: playerEdges.padding.top,
        paddingRight: playerEdges.padding.right,
        paddingBottom: playerEdges.padding.bottom,
        paddingLeft: playerEdges.padding.left,
        marginTop: playerEdges.margin.top,
        marginRight: playerEdges.margin.right,
        marginBottom: playerEdges.margin.bottom,
        marginLeft: playerEdges.margin.left,
      }
    : null;
  return <View style={[{ flex: 1, overflow: "hidden" }, playerStyle, style]}>{children}</View>;
}
