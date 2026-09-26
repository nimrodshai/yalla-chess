// A promise-based mutex.
//
// SQLite makes each individual write atomic, but the request handlers read a
// whole collection, modify it in memory and write it back, with awaits in
// between. Two overlapping requests therefore still lose one of the two
// updates. Serialising those read-modify-write sequences is what actually
// prevents that, so every mutating handler runs inside this lock.

export function createMutex() {
  let tail = Promise.resolve();

  return function runExclusive(task) {
    // Chain onto the current tail, so tasks run strictly in arrival order.
    const result = tail.then(task, task);
    // Keep the chain alive regardless of whether this task threw.
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export const withWriteLock = createMutex();
