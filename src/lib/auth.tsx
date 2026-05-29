import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  loading: boolean;
  // True when the user is signed in but hasn't yet confirmed a display name
  // (profile.display_name_set is false). Used by AuthGate to route them to
  // the profile setup screen and block other navigation. Null while we're
  // still resolving the profile row, so AuthGate can wait.
  needsSetup: boolean | null;
  // Call after the profile is saved to clear the gate without waiting for
  // the onAuthStateChange ping.
  refreshSetup: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  needsSetup: null,
  refreshSetup: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  const fetchSetup = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setNeedsSetup(null);
      return;
    }
    setNeedsSetup(null);
    const { data } = await supabase
      .from('profiles')
      .select('display_name_set')
      .eq('user_id', userId)
      .maybeSingle();
    setNeedsSetup(!data || data.display_name_set !== true);
  }, []);

  const refreshSetup = useCallback(async () => {
    await fetchSetup(session?.user.id);
  }, [session, fetchSetup]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      fetchSetup(data.session?.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      fetchSetup(s?.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchSetup]);

  return (
    <AuthContext.Provider value={{ session, loading, needsSetup, refreshSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
