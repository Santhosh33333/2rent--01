/**
 * Per-user serialisation for money paths.
 *
 * Two concurrent requests from the same account can both pass a balance
 * pre-check and then both spend the same funds. The database transaction is not
 * enough on its own because the read happens before it, so this mutex wraps the
 * whole read-then-write sequence for one user id.
 *
 * Process-local by design. A single instance is fully protected; behind more than
 * one instance this only serialises within a process, so the transactional
 * re-check inside the critical section is what actually prevents a double spend.
 * Replacing this with Redis (SET NX / a redlock) is the upgrade path.
 */

function createMutex() {
  let lock: Promise<unknown> = Promise.resolve();
  return (fn: () => Promise<unknown>) => {
    const result = lock.then(fn, fn);
    lock = result.catch(() => {});
    return result;
  };
}

const userMutexes = new Map<string, ReturnType<typeof createMutex>>();

export function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  let m = userMutexes.get(userId);
  if (!m) {
    m = createMutex();
    userMutexes.set(userId, m);
  }
  return m(fn as () => Promise<unknown>) as Promise<T>;
}