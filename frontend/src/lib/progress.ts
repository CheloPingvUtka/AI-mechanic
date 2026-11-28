import { api } from "./api";
import type { WorkProgress } from "../types/domain";

/** Saving the mechanic's progress outlives the screen. A change goes to the server ~1 s after the last one even if
 *  the mechanic has already left the work (another vehicle, another tab); leaving or hiding the page sends at once;
 *  lists of works first wait for what is still unsent. Saves of one work go one after another, never out of order. */
type Pending = { body: WorkProgress; timer: ReturnType<typeof setTimeout>; done: (ok: boolean) => void };
const pending = new Map<string, Pending>();
const chains = new Map<string, Promise<void>>();

function send(id: string): Promise<void> {
  const p = pending.get(id);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(id);
    const next = (chains.get(id) ?? Promise.resolve())
      .then(() => api.saveProgress(id, p.body)).then(() => p.done(true), () => p.done(false));
    chains.set(id, next);
    void next.finally(() => { if (chains.get(id) === next) chains.delete(id); });
  }
  return chains.get(id) ?? Promise.resolve();
}

export function queueProgress(id: string, body: WorkProgress, done: (ok: boolean) => void, delay = 1000) {
  const old = pending.get(id);
  if (old) clearTimeout(old.timer);
  pending.set(id, { body, done, timer: setTimeout(() => void send(id), delay) });
}

/** Send what is waiting (one work, or all) and wait until the server has it. */
export async function flushProgress(id?: string) {
  const ids = id ? [id] : [...new Set([...pending.keys(), ...chains.keys()])];
  await Promise.all(ids.map(send));
}

/** Forget an unsent change (the plan is being rebuilt: the old ticks are no longer valid). */
export function dropProgress(id: string) {
  const p = pending.get(id);
  if (p) { clearTimeout(p.timer); pending.delete(id); }
}

if (typeof window !== "undefined") {
  const leave = () => { for (const id of [...pending.keys()]) void send(id); };
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") leave(); });
}
