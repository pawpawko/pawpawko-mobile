import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from './auth';
import { getIsOnline, onConnectivityChange } from './connectivity';
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Write-side outbox / mutation queue.
//
// Card edits in the user's own binders (add / update / remove / reorder /
// "Got it") are applied optimistically to the UI and appended here as ops.
// The queue is persisted to AsyncStorage and replayed FIFO whenever we're
// online (on launch, app-foreground, reconnect, and right after enqueue when
// already online — so the good-connection path is unchanged).
//
// Conflict policy: last-write-wins. We replay ops verbatim with no version
// checks. Idempotency: `add` carries a client-generated listing id so a retried
// insert collides on the PK and is treated as success (no dupes); update/remove
// are keyed by id; reorder is an upsert; markReceived re-reads at flush time.
// ---------------------------------------------------------------------------

export type ReorderRow = {
  id: string;
  sort_order: number;
  card_code: string;
  quantity: number;
  listing_type: string;
};

export type OutboxOp =
  | { kind: 'add'; binderId: string; listingId: string; cardCode: string; quantity: number; listingType: string }
  | { kind: 'update'; binderId: string; listingId: string; quantity: number; listingType: string }
  | { kind: 'remove'; binderId: string; listingId: string }
  | { kind: 'removeAllForCard'; binderId: string; cardCode: string }
  | { kind: 'reorder'; binderId: string; order: ReorderRow[] }
  | { kind: 'markReceived'; binderId: string; listingId: string; cardCode: string; deckId: string | null };

type QueuedOp = OutboxOp & { opId: string; createdAt: number; attempts: number; lastError?: string };

export type SyncSnapshot = { pending: number; syncing: boolean; failed: QueuedOp[] };

const OUTBOX_KEY = (uid: string) => `pawpaw:outbox:${uid}`;
const DLQ_KEY = (uid: string) => `pawpaw:outbox:dead:${uid}`;

let activeUid: string | null = null;
let queue: QueuedOp[] = [];
let failed: QueuedOp[] = [];
let flushing = false;
let connSub: (() => void) | null = null;
const subs = new Set<(s: SyncSnapshot) => void>();

/** Client-generated id — use for new listing rows so optimistic UI + the op
 *  share the same primary key (and replays stay idempotent). */
export function newId(): string {
  return randomUUID();
}

function snapshot(): SyncSnapshot {
  return { pending: queue.length, syncing: flushing, failed: [...failed] };
}

function notify() {
  const s = snapshot();
  subs.forEach((f) => f(s));
}

export function subscribeSync(cb: (s: SyncSnapshot) => void): () => void {
  subs.add(cb);
  cb(snapshot());
  return () => {
    subs.delete(cb);
  };
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot();
}

/** Number of un-synced ops touching a binder — drives the per-binder indicator
 *  and the merge-on-refresh guard (so a server reload can't revert them). */
export function pendingForBinder(binderId: string): number {
  return queue.filter((o) => o.binderId === binderId).length;
}

async function persist() {
  if (!activeUid) return;
  try {
    await AsyncStorage.multiSet([
      [OUTBOX_KEY(activeUid), JSON.stringify(queue)],
      [DLQ_KEY(activeUid), JSON.stringify(failed)],
    ]);
  } catch {
    // best-effort
  }
}

/** Bind the queue to a user (call on session change). Loads their persisted
 *  outbox and kicks a flush. A null uid (sign-out) detaches. */
export async function initSync(uid: string | null): Promise<void> {
  if (uid === activeUid) return;
  activeUid = uid;
  queue = [];
  failed = [];
  if (uid) {
    try {
      const pairs = await AsyncStorage.multiGet([OUTBOX_KEY(uid), DLQ_KEY(uid)]);
      const q = pairs.find(([k]) => k === OUTBOX_KEY(uid))?.[1];
      const d = pairs.find(([k]) => k === DLQ_KEY(uid))?.[1];
      queue = q ? (JSON.parse(q) as QueuedOp[]) : [];
      failed = d ? (JSON.parse(d) as QueuedOp[]) : [];
    } catch {
      queue = [];
      failed = [];
    }
  }
  if (!connSub) {
    connSub = onConnectivityChange((online) => {
      if (online) void flush();
    });
  }
  notify();
  void flush();
}

export async function enqueue(op: OutboxOp): Promise<void> {
  const queued: QueuedOp = { ...op, opId: newId(), createdAt: Date.now(), attempts: 0 };
  queue.push(coalesce(queued));
  await persist();
  notify();
  void flush();
}

// Light coalescing: collapse a run of reorders on the same binder to the
// latest (only the final order matters). More aggressive collapsing (e.g. an
// add then remove of the same un-synced listing) is a future refinement.
function coalesce(next: QueuedOp): QueuedOp {
  if (next.kind === 'reorder') {
    for (let i = queue.length - 1; i >= 0; i--) {
      const o = queue[i];
      if (o.binderId === next.binderId && o.kind === 'reorder') {
        queue.splice(i, 1);
      }
    }
  }
  return next;
}

// Remove a specific op by id — safe even if coalescing spliced the array
// during an in-flight await (so we never shift the wrong element).
function removeOp(opId: string) {
  const i = queue.findIndex((o) => o.opId === opId);
  if (i >= 0) queue.splice(i, 1);
}

/** Public trigger used by the provider (launch / foreground). */
export function triggerFlush(): void {
  void flush();
}

export function clearFailed(): void {
  failed = [];
  void persist();
  notify();
}

async function flush(): Promise<void> {
  if (flushing || !activeUid || queue.length === 0) return;
  if (!getIsOnline()) return;
  flushing = true;
  notify();
  try {
    while (queue.length > 0 && getIsOnline()) {
      const op = queue[0];
      try {
        const ok = await runOp(op);
        if (!ok) {
          // Permanent failure (RLS / validation): dead-letter it and move on
          // rather than wedging the whole queue behind one bad op.
          op.attempts += 1;
          failed.push(op);
          removeOp(op.opId);
          await persist();
          notify();
          continue;
        }
        removeOp(op.opId);
        await persist();
        notify();
      } catch (e) {
        // Transport/network error — stop and retry on the next trigger,
        // preserving FIFO order so causal ops (add → reorder) stay ordered.
        op.attempts += 1;
        op.lastError = e instanceof Error ? e.message : String(e);
        await persist();
        break;
      }
    }
  } finally {
    flushing = false;
    notify();
  }
}

// Returns true on success (incl. idempotent no-ops), false on a permanent
// error. Throws on a network/transport error (caller retries).
async function runOp(op: QueuedOp): Promise<boolean> {
  switch (op.kind) {
    case 'add': {
      const { error } = await supabase.from('listings').insert({
        id: op.listingId,
        binder_id: op.binderId,
        card_code: op.cardCode,
        quantity: op.quantity,
        listing_type: op.listingType,
      });
      if (error) {
        if (error.code === '23505') return true; // already inserted on a prior replay
        op.lastError = error.message;
        return false;
      }
      return true;
    }
    case 'update': {
      const { error } = await supabase
        .from('listings')
        .update({ quantity: op.quantity, listing_type: op.listingType })
        .eq('id', op.listingId);
      if (error) {
        op.lastError = error.message;
        return false;
      }
      return true;
    }
    case 'remove': {
      const { error } = await supabase.from('listings').delete().eq('id', op.listingId);
      if (error) {
        op.lastError = error.message;
        return false;
      }
      return true;
    }
    case 'removeAllForCard': {
      const { error } = await supabase
        .from('listings')
        .delete()
        .eq('binder_id', op.binderId)
        .eq('card_code', op.cardCode);
      if (error) {
        op.lastError = error.message;
        return false;
      }
      return true;
    }
    case 'reorder': {
      const { error } = await supabase.from('listings').upsert(
        op.order.map((r) => ({
          id: r.id,
          sort_order: r.sort_order,
          binder_id: op.binderId,
          card_code: r.card_code,
          quantity: r.quantity,
          listing_type: r.listing_type,
        })),
        { onConflict: 'id' },
      );
      if (error) {
        op.lastError = error.message;
        return false;
      }
      return true;
    }
    case 'markReceived': {
      // Re-read current server state at flush time (don't snapshot the
      // decrement) so concurrent collects compose correctly under last-write-wins.
      if (op.deckId) {
        const { data: dc, error: dcErr } = await supabase
          .from('deck_cards')
          .select('quantity, owned')
          .eq('deck_id', op.deckId)
          .eq('card_code', op.cardCode)
          .maybeSingle();
        if (dcErr) {
          op.lastError = dcErr.message;
          return false;
        }
        if (dc) {
          const newOwned = Math.min(dc.quantity, (dc.owned ?? 0) + 1);
          const { error } = await supabase
            .from('deck_cards')
            .update({ owned: newOwned })
            .eq('deck_id', op.deckId)
            .eq('card_code', op.cardCode);
          if (error) {
            op.lastError = error.message;
            return false;
          }
        } else {
          const { error } = await supabase.from('listings').delete().eq('id', op.listingId);
          if (error) {
            op.lastError = error.message;
            return false;
          }
        }
      } else {
        const { data: cur, error: curErr } = await supabase
          .from('listings')
          .select('quantity')
          .eq('id', op.listingId)
          .maybeSingle();
        if (curErr) {
          op.lastError = curErr.message;
          return false;
        }
        if (!cur) return true; // row already gone — collected on a prior replay
        if ((cur.quantity ?? 1) > 1) {
          const { error } = await supabase
            .from('listings')
            .update({ quantity: cur.quantity - 1 })
            .eq('id', op.listingId);
          if (error) {
            op.lastError = error.message;
            return false;
          }
        } else {
          const { error } = await supabase.from('listings').delete().eq('id', op.listingId);
          if (error) {
            op.lastError = error.message;
            return false;
          }
        }
      }
      return true;
    }
  }
}

// --- React glue -----------------------------------------------------------

/** Binds the queue to the signed-in user and flushes on launch + foreground.
 *  Mount once, inside AuthProvider. Renders children unchanged. */
export function SyncProvider({ children }: { children: ReactNode }): ReactNode {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;

  useEffect(() => {
    void initSync(uid);
  }, [uid]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') triggerFlush();
    });
    return () => sub.remove();
  }, []);

  return children;
}

export function usePendingSync(): SyncSnapshot {
  const [snap, setSnap] = useState<SyncSnapshot>(getSyncSnapshot);
  useEffect(() => subscribeSync(setSnap), []);
  return snap;
}
