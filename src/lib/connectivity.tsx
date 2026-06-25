import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius } from './theme';

// ---------------------------------------------------------------------------
// Connectivity tracking.
//
// We expose both a React hook (`useIsOnline`) for UI and a plain getter
// (`getIsOnline`) + subscription (`onConnectivityChange`) so the non-React
// sync engine can gate / trigger flushes without a component in the loop.
//
// `isInternetReachable` starts `null` right after boot (NetInfo hasn't probed
// yet). We treat `null` as ONLINE so a cold start never wrongly blocks writes
// before the first probe resolves — better to optimistically try the network
// and let the request fail than to refuse a write on a healthy connection.
// ---------------------------------------------------------------------------

function deriveOnline(s: NetInfoState): boolean {
  if (s.isConnected === false) return false;
  if (s.isInternetReachable === false) return false;
  return true;
}

let online = true;
let started = false;
const listeners = new Set<(online: boolean) => void>();

function setOnline(next: boolean) {
  if (next === online) return;
  online = next;
  listeners.forEach((l) => l(next));
}

// Lazily attach the NetInfo subscription the first time anyone asks. Safe to
// call repeatedly; only the first call wires it up.
function ensureStarted() {
  if (started) return;
  started = true;
  NetInfo.fetch().then((s) => setOnline(deriveOnline(s)));
  NetInfo.addEventListener((s) => setOnline(deriveOnline(s)));
}

export function getIsOnline(): boolean {
  ensureStarted();
  return online;
}

export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  ensureStarted();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const OnlineContext = createContext(true);
export const useIsOnline = () => useContext(OnlineContext);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(() => getIsOnline());
  useEffect(() => onConnectivityChange(setIsOnline), []);

  return (
    <OnlineContext.Provider value={isOnline}>
      {children}
      {!isOnline ? <OfflineBanner /> : null}
    </OnlineContext.Provider>
  );
}

// Thin app-wide pill shown while offline. pointerEvents=none so it never traps
// taps over the UI underneath.
function OfflineBanner() {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.pill}>
        <Text style={styles.text}>OFFLINE · changes will sync when you reconnect</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
  },
  pill: {
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  text: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
