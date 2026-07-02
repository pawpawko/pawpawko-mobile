import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://cligjmfhxvazjarbvexp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MbXa-DQ33D9VSMHhHho0Xg_kZ65QHtt';

// During Expo Router's web/Node SSR prerender there is no `window`; the Supabase
// auth client's session recovery (AsyncStorage -> window) throws
// `ReferenceError: window is not defined` and hard-crashes Metro. Only attach
// persistent storage + auto-refresh in a real client (native or browser) where
// `window` exists. React Native always defines `window`, so this is a no-op there
// and only changes the behaviour of the never-actually-used Node SSR pass.
const isServer = typeof window === 'undefined';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: isServer
    ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    : {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
});
