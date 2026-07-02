import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { clearPresence, fetchNearbyTradeBinders, pingPresence, type StartResult } from './presence';

type AutoSearchState = {
  active: boolean;
  since: number | null; // ms epoch when the current session started
  expiresAt: number | null; // ms epoch; presence row expires here
  eventCode: string | null; // current code (lowercased), null = none
  lastLat: number | null;
  lastLng: number | null;
  nearbyCount: number | null; // last-known nearby trade-binder count
  start: (eventCode?: string | null) => Promise<StartResult>;
  stop: () => Promise<void>;
  extend: () => Promise<StartResult>;
  setEventCode: (code: string | null) => Promise<void>;
};

const STORAGE_KEY = 'pawpaw:autoSearch';
const PING_INTERVAL_MS = 60_000; // re-ping every minute while active
const SESSION_TTL_MS_NO_CODE = 60 * 60 * 1000; // 1 hour for ad-hoc / GPS-only
const SESSION_TTL_MS_WITH_CODE = 4 * 60 * 60 * 1000; // 4 hours when at an event

function ttlForCode(code: string | null): number {
  return code ? SESSION_TTL_MS_WITH_CODE : SESSION_TTL_MS_NO_CODE;
}

type Stored = {
  since: number;
  expiresAt: number;
  eventCode: string | null;
};

const AutoSearchContext = createContext<AutoSearchState | null>(null);

export function AutoSearchProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [eventCode, setEventCodeState] = useState<string | null>(null);
  const [lastLat, setLastLat] = useState<number | null>(null);
  const [lastLng, setLastLng] = useState<number | null>(null);
  const [nearbyCount, setNearbyCount] = useState<number | null>(null);

  // Keep timer + latest event-code in refs so the interval callback always
  // reads the current value without re-creating the timer on every change.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventCodeRef = useRef<string | null>(null);
  const expiresAtRef = useRef<number | null>(null);

  const persist = useCallback(async (next: Stored | null) => {
    if (next) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshNearbyCount = useCallback(async (lat: number, lng: number, code: string | null) => {
    const rows = await fetchNearbyTradeBinders(lat, lng, code);
    setNearbyCount(rows.length);
  }, []);

  const stopInternal = useCallback(
    async (purgeRemote: boolean) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setActive(false);
      setSince(null);
      setExpiresAt(null);
      setNearbyCount(null);
      expiresAtRef.current = null;
      await persist(null);
      if (purgeRemote) {
        await clearPresence();
      }
    },
    [persist],
  );

  const startPingLoop = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(async () => {
      // Stop ourselves if the TTL has passed without an extend.
      if (expiresAtRef.current !== null && Date.now() > expiresAtRef.current) {
        await stopInternal(true);
        return;
      }
      const result = await pingPresence(eventCodeRef.current);
      if (result.ok) {
        setLastLat(result.lat);
        setLastLng(result.lng);
        refreshNearbyCount(result.lat, result.lng, eventCodeRef.current);
      } else if (result.reason === 'permission-denied') {
        await stopInternal(false);
      }
    }, PING_INTERVAL_MS);
  }, [refreshNearbyCount, stopInternal]);

  const startOrExtend = useCallback(
    async (code: string | null | undefined): Promise<StartResult> => {
      const trimmed = typeof code === 'string' ? code.trim().toLowerCase() : null;
      const next = trimmed && trimmed.length > 0 ? trimmed : null;

      // Fire the ping immediately so the user sees a fast response. The
      // server-side upsert refreshes expires_at on every call, so this
      // doubles as "extend" when already active.
      const result = await pingPresence(next);
      if (!result.ok) return result;

      const now = Date.now();
      const newExpiresAt = now + ttlForCode(next);

      setEventCodeState(next);
      eventCodeRef.current = next;
      setLastLat(result.lat);
      setLastLng(result.lng);
      setActive(true);
      setSince((prev) => prev ?? now);
      setExpiresAt(newExpiresAt);
      expiresAtRef.current = newExpiresAt;
      await persist({ since: since ?? now, expiresAt: newExpiresAt, eventCode: next });
      refreshNearbyCount(result.lat, result.lng, next);
      startPingLoop();
      return result;
    },
    [persist, refreshNearbyCount, since, startPingLoop],
  );

  const start = useCallback(
    (code?: string | null) => startOrExtend(code ?? eventCodeRef.current),
    [startOrExtend],
  );

  const extend = useCallback(() => startOrExtend(eventCodeRef.current), [startOrExtend]);

  const stop = useCallback(() => stopInternal(true), [stopInternal]);

  const setEventCode = useCallback(
    async (code: string | null) => {
      if (active) {
        await startOrExtend(code);
      } else {
        const trimmed = typeof code === 'string' ? code.trim().toLowerCase() : null;
        const next = trimmed && trimmed.length > 0 ? trimmed : null;
        setEventCodeState(next);
        eventCodeRef.current = next;
      }
    },
    [active, startOrExtend],
  );

  // Restore on cold start if a persisted session hasn't expired yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Stored;
        if (!parsed?.expiresAt || Date.now() > parsed.expiresAt) {
          await AsyncStorage.removeItem(STORAGE_KEY);
          return;
        }
        if (cancelled) return;
        // Re-arm the loop. Don't await — fire-and-forget is fine on cold start.
        eventCodeRef.current = parsed.eventCode ?? null;
        setEventCodeState(parsed.eventCode ?? null);
        setSince(parsed.since);
        setExpiresAt(parsed.expiresAt);
        expiresAtRef.current = parsed.expiresAt;
        setActive(true);
        startPingLoop();
        pingPresence(parsed.eventCode ?? null).catch(() => {});
      } catch {
        // Ignore — bad persisted value, just stay off.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startPingLoop]);

  // Pause ping loop while app is backgrounded; resume on foreground.
  useEffect(() => {
    function onChange(state: AppStateStatus) {
      if (!active) return;
      if (state === 'active') {
        // Resume: immediate ping + restart timer.
        if (expiresAtRef.current !== null && Date.now() > expiresAtRef.current) {
          stopInternal(true);
          return;
        }
        pingPresence(eventCodeRef.current).then((r) => {
          if (r.ok) {
            setLastLat(r.lat);
            setLastLng(r.lng);
            refreshNearbyCount(r.lat, r.lng, eventCodeRef.current);
          }
        });
        startPingLoop();
      } else if (state === 'background' || state === 'inactive') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [active, refreshNearbyCount, startPingLoop, stopInternal]);

  // Cleanup interval on unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Memoized so consumers (e.g. the header jolly icon) don't re-render — and
  // reload their image, which reads as a flicker — on unrelated provider renders.
  const value = useMemo<AutoSearchState>(
    () => ({
      active,
      since,
      expiresAt,
      eventCode,
      lastLat,
      lastLng,
      nearbyCount,
      start,
      stop,
      extend,
      setEventCode,
    }),
    [active, since, expiresAt, eventCode, lastLat, lastLng, nearbyCount, start, stop, extend, setEventCode],
  );

  return <AutoSearchContext.Provider value={value}>{children}</AutoSearchContext.Provider>;
}

export function useAutoSearch(): AutoSearchState {
  const ctx = useContext(AutoSearchContext);
  if (!ctx) throw new Error('useAutoSearch must be used within AutoSearchProvider');
  return ctx;
}
