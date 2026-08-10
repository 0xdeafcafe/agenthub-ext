/**
 * Error containment primitives. Content scripts run in an isolated world, so
 * a throw can never break GitHub's own JS - but an unhandled rejection or a
 * dead feature loop can leave the page half-augmented. Every entry point
 * (init, observer callback, event listener, async continuation) goes through
 * `guarded`, so one feature failing never takes the others down.
 */

export function logError(context: string, error: unknown): void {
  console.error('[PR Impact]', context, error);
}

export function guarded<A extends unknown[]>(context: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (error) {
      logError(context, error);
    }
  };
}

/** Coalesces repeated calls into at most one DOM write per animation frame. */
export function rafThrottled(fn: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        fn();
      } catch (error) {
        logError('raf callback', error);
      }
    });
  };
}
