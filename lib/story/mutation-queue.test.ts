import { describe, expect, it, vi } from "vitest";
import {
  MutationQueue,
  isStaleVersionConflict,
} from "@/lib/story/mutation-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("isStaleVersionConflict", () => {
  it("matches the RPC's 'Stale version for ...' error message", () => {
    expect(
      isStaleVersionConflict(
        new Error("Stale version for story abc (expected 1, got 2)"),
      ),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isStaleVersionConflict(new Error("network error"))).toBe(false);
    expect(isStaleVersionConflict(null)).toBe(false);
  });
});

describe("MutationQueue coalescing", () => {
  it("only sends the latest mutation queued for a slot before it starts", async () => {
    const queue = new MutationQueue();
    const calls: number[] = [];

    // Enqueue three updates to the same slot synchronously, before any of
    // them has had a chance to start — only the last should ever run.
    queue.enqueue("title", () => {
      calls.push(1);
      return Promise.resolve();
    });
    queue.enqueue("title", () => {
      calls.push(2);
      return Promise.resolve();
    });
    queue.enqueue("title", () => {
      calls.push(3);
      return Promise.resolve();
    });

    await queue.flush();
    expect(calls).toEqual([3]);
  });

  it("runs mutations for different slots serially, never concurrently", async () => {
    const queue = new MutationQueue();
    const order: string[] = [];
    let inFlight = 0;
    let maxConcurrent = 0;

    const makeMutation = (label: string, delayMs: number) => async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      order.push(label);
      inFlight -= 1;
    };

    queue.enqueue("a", makeMutation("a", 10));
    queue.enqueue("b", makeMutation("b", 1));
    queue.enqueue("c", makeMutation("c", 1));

    await queue.flush();
    expect(order).toEqual(["a", "b", "c"]);
    expect(maxConcurrent).toBe(1);
  });
});

describe("MutationQueue conflict handling", () => {
  it("reports a stale-version conflict without throwing and keeps draining", async () => {
    const onVersionConflict = vi.fn();
    const onError = vi.fn();
    const queue = new MutationQueue({ onVersionConflict, onError });

    queue.enqueue("locations", () =>
      Promise.reject(
        new Error("Stale version for revision x (expected 1, got 2)"),
      ),
    );
    let secondRan = false;
    queue.enqueue("tags", () => {
      secondRan = true;
      return Promise.resolve();
    });

    await queue.flush();

    expect(onVersionConflict).toHaveBeenCalledTimes(1);
    expect(onVersionConflict.mock.calls[0][0]).toBe("locations");
    expect(onError).not.toHaveBeenCalled();
    expect(secondRan).toBe(true);
  });

  it("reports a non-version error via onError", async () => {
    const onError = vi.fn();
    const queue = new MutationQueue({ onError });

    queue.enqueue("workTypes", () => Promise.reject(new Error("network down")));

    await queue.flush();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("MutationQueue.hasPending across concurrent slots (R6-7)", () => {
  // Regression test for a real bug in components/story/story-edit-form.tsx:
  // its MutationQueue was constructed with `onSettled: () => setSaving(false)`,
  // which could flip the "Saving.../Saved" indicator to "Saved" the instant
  // ONE slot's mutation finished even if a DIFFERENT slot still had work
  // queued or in flight. The fix reads queue.hasPending() at the moment of
  // settling instead of hardcoding false. This test proves the underlying
  // primitive (hasPending()) already reports the right thing at exactly the
  // moment each mutation settles -- the bug was in the consumer trusting a
  // hardcoded value instead of asking the queue.
  it("still reports pending work after one of two concurrently-queued slots resolves", async () => {
    const settledSlots: string[] = [];
    const pendingAtSettle: boolean[] = [];
    const queue = new MutationQueue({
      onSettled: (slot) => {
        settledSlots.push(slot);
        pendingAtSettle.push(queue.hasPending());
      },
    });

    const locations = deferred<void>();
    const fields = deferred<void>();

    // Enqueue both, synchronously, before either has started -- two
    // different slots, both genuinely pending at once.
    queue.enqueue("locations", () => locations.promise);
    queue.enqueue("fields", () => fields.promise);

    // Let microtasks run so the queue actually starts draining and is
    // sitting inside the first mutation's await.
    await Promise.resolve();
    expect(queue.hasPending("fields")).toBe(true);

    // Resolve the first (locations) mutation. At the moment it settles, the
    // second (fields) mutation is still queued -- hasPending() must be
    // true, proving `saving` should stay true across this gap.
    locations.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settledSlots).toEqual(["locations"]);
    expect(pendingAtSettle).toEqual([true]);

    // Now resolve the second mutation. Once IT settles, nothing remains
    // queued or in flight -- hasPending() must be false.
    fields.resolve();
    await queue.flush();
    expect(settledSlots).toEqual(["locations", "fields"]);
    expect(pendingAtSettle).toEqual([true, false]);
  });
});

describe("MutationQueue.flush", () => {
  it("waits for mutations enqueued while flush() is already waiting", async () => {
    const queue = new MutationQueue();
    const d1 = deferred<void>();
    const order: string[] = [];

    queue.enqueue("a", () => d1.promise.then(() => order.push("a")));

    const flushPromise = queue.flush();

    // Enqueue more work while flush() is in progress — flush() must not
    // resolve until this settles too.
    queue.enqueue("b", async () => {
      order.push("b");
    });

    d1.resolve();
    await flushPromise;

    expect(order).toEqual(["a", "b"]);
  });

  it("never rejects even when every mutation fails", async () => {
    const queue = new MutationQueue();
    queue.enqueue("x", () => Promise.reject(new Error("boom")));
    await expect(queue.flush()).resolves.toBeUndefined();
  });
});
