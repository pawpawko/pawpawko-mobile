import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from './auth';
import { supabase } from './supabase';

// Mirrors the web notifications system (js/main.js): binder/deck share invites,
// accepted/declined notices, and shared-deck "card collected" notices. Writes go
// through SECURITY DEFINER RPCs (respond_*_invite, dismiss_notification,
// mark_notifications_read, prune_notifications). Realtime is added in a later
// mobile-parity step; for now a 60s poll keeps the badge fresh.
export type AppNotification = {
  id: string;
  type: string;
  status: string;
  data: Record<string, any>;
  read: boolean;
  created_at: string;
};

type NotificationsState = {
  items: AppNotification[];
  unread: number;
  reload: () => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  // Returns an error message to surface, or null on success.
  respond: (id: string, accept: boolean, kind: 'binder' | 'deck') => Promise<string | null>;
};

const NotificationsContext = createContext<NotificationsState>({
  items: [],
  unread: 0,
  reload: async () => {},
  markAllRead: async () => {},
  dismiss: async () => {},
  respond: async () => null,
});

const POLL_MS = 60_000;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [items, setItems] = useState<AppNotification[]>([]);

  const reload = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    setItems(error ? [] : ((data as AppNotification[]) ?? []));
  }, [userId]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    await supabase.rpc('mark_notifications_read');
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [userId]);

  const dismiss = useCallback(async (id: string) => {
    const { error } = await supabase.rpc('dismiss_notification', { p_notification_id: id });
    if (!error) setItems((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const respond = useCallback(
    async (id: string, accept: boolean, kind: 'binder' | 'deck') => {
      const fn = kind === 'deck' ? 'respond_deck_invite' : 'respond_binder_invite';
      const { error } = await supabase.rpc(fn, { p_notification_id: id, p_accept: accept });
      if (error) return error.message;
      await reload();
      return null;
    },
    [reload],
  );

  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }
    // Best-effort prune of >2wk-read notices. The supabase builder is a thenable
    // without .catch(), so swallow errors via then's 2nd arg.
    supabase.rpc('prune_notifications').then(
      () => {},
      () => {},
    );
    reload();
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [userId, reload]);

  const unread = items.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider value={{ items, unread, reload, markAllRead, dismiss, respond }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
