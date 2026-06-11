import * as Location from 'expo-location';

import { supabase } from './supabase';

export type NearbyTradeBinder = {
  binder_id: string;
  user_id: string;
  display_name: string | null;
  binder_name: string | null;
  binder_description: string | null;
  sleeve_image_url: string | null;
  flair: string;
  category: string;
  last_updated_at: string | null;
  distance_m: number;
};

export type WishlistMatch = {
  binder_id: string;
  owner_user_id: string;
  owner_display_name: string | null;
  category: string;
  matched_card_codes: string[];
};

export type StartResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: 'permission-denied' | 'location-unavailable' | 'rpc-error'; message?: string };

// Request foreground location permission. Returns true on grant.
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

// Fetch the current device location. Returns null if it can't be obtained.
async function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

// Upsert a presence ping for the current session.
export async function pingPresence(eventCode: string | null): Promise<StartResult> {
  const granted = await requestLocationPermission();
  if (!granted) return { ok: false, reason: 'permission-denied' };
  const coords = await getCurrentCoords();
  if (!coords) return { ok: false, reason: 'location-unavailable' };

  const { error } = await supabase.rpc('upsert_presence', {
    p_lat: coords.lat,
    p_lng: coords.lng,
    p_event_code: eventCode,
  });
  if (error) {
    console.warn('upsert_presence', error.message);
    return { ok: false, reason: 'rpc-error', message: error.message };
  }
  return { ok: true, lat: coords.lat, lng: coords.lng };
}

// Force-clear the caller's presence row.
export async function clearPresence(): Promise<void> {
  const { error } = await supabase.rpc('clear_presence');
  if (error) console.warn('clear_presence', error.message);
}

// Query nearby trade binders (hybrid 500m GPS OR event_code within 2mi).
export async function fetchNearbyTradeBinders(
  lat: number,
  lng: number,
  eventCode: string | null,
): Promise<NearbyTradeBinder[]> {
  const { data, error } = await supabase.rpc('nearby_trade_binders', {
    p_lat: lat,
    p_lng: lng,
    p_event_code: eventCode,
  });
  if (error) {
    console.warn('nearby_trade_binders', error.message);
    return [];
  }
  return (data ?? []) as NearbyTradeBinder[];
}

// Phase 2: wishlist matches across the same hybrid set.
export async function fetchWishlistMatches(
  lat: number,
  lng: number,
  eventCode: string | null,
): Promise<WishlistMatch[]> {
  const { data, error } = await supabase.rpc('nearby_wishlist_matches', {
    p_lat: lat,
    p_lng: lng,
    p_event_code: eventCode,
  });
  if (error) {
    console.warn('nearby_wishlist_matches', error.message);
    return [];
  }
  return (data ?? []) as WishlistMatch[];
}
