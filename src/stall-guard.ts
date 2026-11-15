/**
 * A time limit for one queued photo, so a reading step that never answers cannot hold the whole queue (and the phone's wake lock) forever.
 *
 * Conservative on purpose: the limit is long (a big multi-label photo on a slow phone takes about a minute), it only ever
 * marks the one photo as failed (it stays in the queue and can be retried, nothing is deleted), and a result that arrives after the
 * limit is ignored (check() throws) so a photo declared failed can never replace its original later.
 */

/** How long one queued photo may take before it is set aside. */
export const QUEUE_ITEM_LIMIT_MS = 5 * 60 * 1000;

export class StallError extends Error {
  constructor(message: string) { super(message); this.name = 'StallError'; }
}

export type StallGuard = {
  /** Settles like the work, or rejects with a StallError when the limit passes first. */
  race<T>(work: Promise<T>): Promise<T>;
  /** True once the limit has passed. */
  stalled(): boolean;
  /** Call before every step that changes data: throws when the limit has passed, so late work stops. */
  check(): void;
  /** Stops the clock (the work finished or failed on its own). */
  cancel(): void;
};

export function createStallGuard(limitMs: number, message: string): StallGuard {
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { stalled = true; reject(new StallError(message)); }, limitMs);
  });
  // The race below always handles the timeout; this keeps a never-used guard from raising an unhandled rejection.
  timeout.catch(() => undefined);
  return {
    race: work => { work.catch(() => undefined); return Promise.race([work, timeout]); },
    stalled: () => stalled,
    check: () => { if (stalled) throw new StallError(message); },
    cancel: () => { if (timer) clearTimeout(timer); }
  };
}
