/**
 * Tracks background work (such as voice transcriptions) per task so that finishing a task can
 * wait until everything that belongs to it has completed.
 */
export class PendingWork {
  private readonly work = new Map<number, Set<Promise<unknown>>>();

  track<T>(taskId: number, promise: Promise<T>): Promise<T> {
    let set = this.work.get(taskId);
    if (!set) {
      set = new Set();
      this.work.set(taskId, set);
    }
    const bucket = set;
    const tracked: Promise<T> = promise.finally(() => {
      bucket.delete(tracked);
      if (bucket.size === 0 && this.work.get(taskId) === bucket) this.work.delete(taskId);
    });
    bucket.add(tracked);
    // Callers may ignore the result; failures are handled by the work itself.
    tracked.catch(() => undefined);
    return tracked;
  }

  /** Resolves once all tracked work for the task has settled (successfully or not). */
  async wait(taskId: number): Promise<void> {
    // Work may enqueue more work while we wait, so loop until nothing is left.
    for (;;) {
      const set = this.work.get(taskId);
      if (!set || set.size === 0) return;
      await Promise.allSettled([...set]);
    }
  }

  count(taskId: number): number {
    return this.work.get(taskId)?.size ?? 0;
  }
}
