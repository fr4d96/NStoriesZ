/**
 * Client-side serialized async mutation queue for the authoring form.
 *
 * The authoring form issues many small mutations as the contributor types/
 * reorders/toggles things (title, content, locations, work types, tags,
 * media captions, reorder, cover selection...). Every mutation RPC takes an
 * `expectedVersion` for optimistic concurrency (Engineering Rule — never
 * trust client state as authoritative; the DB is the source of truth), so
 * two of those RPCs must never race each other in flight, or the second one
 * to *arrive* (not the second one to be *sent*) would silently win with a
 * stale expected version and get rejected, or worse, momentarily appear to
 * succeed out of order.
 *
 * Design:
 *  - Every enqueued mutation is tagged with a "slot" (e.g. "fields",
 *    "locations", "workTypes", "tags", `media-caption:${mediaId}`).
 *    Enqueuing a new mutation for a slot that already has one pending
 *    (queued but not yet sent) REPLACES it — coalescing rapid-fire changes
 *    (e.g. every keystroke in the title field) into a single network call
 *    of the latest value, rather than firing one request per keystroke.
 *  - All mutations, across all slots, run strictly one at a time, in the
 *    order their slot was first scheduled — never concurrently — so a
 *    later mutation always observes the version the previous one produced.
 *  - A stale-version conflict (the RPC's "Stale version for ..." error) is
 *    reported via onVersionConflict and the queue keeps running — it never
 *    throws away the caller's in-memory form state. The caller decides how
 *    to recover (e.g. show a "this draft changed elsewhere, reload to
 *    continue" banner); silently discarding local edits on a conflict would
 *    be worse than surfacing it.
 *  - flush() awaits every mutation that is queued or in flight at the
 *    moment it's called, INCLUDING any that get enqueued while it's
 *    waiting (e.g. a debounced field-save fires while flush() is already
 *    in progress) — submission calls this before its own final save so it
 *    never races an in-flight autosave.
 */

import { getErrorMessage } from "@/lib/errors";

export type MutationQueueOptions = {
  onVersionConflict?: (slot: string, error: unknown) => void;
  onError?: (slot: string, error: unknown) => void;
  onSettled?: (slot: string) => void;
};

const STALE_VERSION_PATTERN = /stale version/i;

export function isStaleVersionConflict(error: unknown): boolean {
  if (!error) return false;
  return STALE_VERSION_PATTERN.test(getErrorMessage(error, String(error)));
}

export class MutationQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = new Map<string, () => Promise<unknown>>();

  constructor(private readonly options: MutationQueueOptions = {}) {}

  /**
   * Queues `fn` under `slot`, replacing any not-yet-started mutation
   * already queued for that slot. Never awaited by the caller — mutations
   * are fire-and-forget from the UI's perspective; use flush() to wait for
   * everything to settle.
   */
  enqueue(slot: string, fn: () => Promise<unknown>): void {
    this.pending.set(slot, fn);
    this.tail = this.tail.then(() => this.drainOnce());
  }

  /**
   * Drains every mutation currently in `pending`. Chained onto `tail` once
   * per enqueue() call, but idempotent-safe to run redundantly: a step that
   * finds the map already emptied by an earlier chained step simply
   * returns — this is what makes same-slot coalescing free of extra
   * network calls rather than merely deduplicating a scheduling flag.
   */
  private async drainOnce(): Promise<void> {
    while (this.pending.size > 0) {
      const next = this.pending.entries().next().value;
      if (!next) break;
      const [slot, fn] = next;
      this.pending.delete(slot);
      try {
        await fn();
      } catch (error) {
        if (isStaleVersionConflict(error)) {
          this.options.onVersionConflict?.(slot, error);
        } else {
          this.options.onError?.(slot, error);
        }
      } finally {
        this.options.onSettled?.(slot);
      }
    }
  }

  /** True if `slot` (or, with no argument, any slot) has a mutation queued but not yet started. */
  hasPending(slot?: string): boolean {
    return slot ? this.pending.has(slot) : this.pending.size > 0;
  }

  /**
   * Resolves once every mutation queued or in flight at call time has
   * settled — including ones enqueued while flush() itself was waiting.
   * Never rejects: individual mutation failures are reported via the
   * onVersionConflict/onError callbacks, not thrown here.
   */
  async flush(): Promise<void> {
    let observedTail: Promise<void> | null = null;
    while (observedTail !== this.tail || this.pending.size > 0) {
      observedTail = this.tail;
      await observedTail;
    }
  }
}
