/**
 * One import at a time *per account*, whatever its origin: a background Flex sync, a manual
 * file drop and an agent pass must not compute their plans against the same stale view of
 * that account's ledger. Two accounts never wait for each other: a slow statement import on
 * one must not delay the five-minute agent cadence of another.
 *
 * An uncontended call starts `run` synchronously, like acquiring a free lock. A contended
 * call is queued and started once every earlier one of the same account has settled, success
 * or failure alike, so one throwing import never wedges the ones behind it.
 */
interface Lane {
  queue: Array<() => void>;
  running: boolean;
}

const lanes = new Map<string, Lane>();

function drain(lane: Lane) {
  const task = lane.queue.shift();
  if (task) {
    task();
  } else {
    lane.running = false;
  }
}

export function withImportLock<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  let lane = lanes.get(accountId);
  if (!lane) {
    lane = { queue: [], running: false };
    lanes.set(accountId, lane);
  }
  const current = lane;
  return new Promise<T>((resolve, reject) => {
    current.queue.push(() => {
      run().then(resolve, reject).finally(() => drain(current));
    });
    if (!current.running) {
      current.running = true;
      drain(current);
    }
  });
}
