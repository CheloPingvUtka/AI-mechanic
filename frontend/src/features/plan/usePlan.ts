import { useEffect, useRef, useState } from "react";
import { api, pushEvent, watchWork } from "../../lib/api";
import { dropProgress, flushProgress, queueProgress } from "../../lib/progress";
import type { AgentEvent, PlanItem, Stage, WorkPlan, WorkProgress } from "../../types/domain";

const NEW_FOR_MS = 20000;
// skipped: a step with a measurement the mechanic went past without entering the value (logged as such, not as done)
export type StepState = { done: boolean; value: string; skipped?: boolean };

/** Live work plan for a check plus the mechanic's progress on it (done marks, ticks, measured values, stage, the
 *  step he is on), restored from the server and saved back about a second after every change (lib/progress). */
export function usePlan(workId: string | null) {
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [steps, setSteps] = useState<Record<number, StepState>>({});  // steps and checklist ticks, by item id
  const [stage, setStage] = useState<Stage>("prep");
  const [finished, setFinished] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [round, setRound] = useState(0);
  const [loaded, setLoaded] = useState(false);  // the saved progress (stage, ticks) is in
  const [at, setAt] = useState(0);  // the step on screen (index in plan.steps)
  const restored = useRef(false);  // saving starts only once the saved state came back, so it is never overwritten with nothing
  const savedStep = useRef<number | null>(null);
  const placed = useRef(false);
  const firstSeen = useRef(new Map<number, number>());
  const [, tick] = useState(0);

  useEffect(() => {
    setPlan(null); setEvents([]); setSteps({}); setStage("prep"); setFinished(false); setSaveFailed(false); setAt(0);
    restored.current = false; firstSeen.current.clear(); setLoaded(false); savedStep.current = null; placed.current = false;
    if (!workId) return;
    let live = true;
    // Saved progress first (resuming a work), then the live plan. Unsent changes of this work are sent first.
    flushProgress(workId).then(() => api.work(workId)).then(w => {
      if (!live) return;
      const p = w.progress;
      savedStep.current = p?.step ?? null;
      if (p) setSteps({
        ...Object.fromEntries(Object.entries(p.checks ?? {}).map(([id, done]) => [id, { done: !!done, value: "" }])),
        ...Object.fromEntries(Object.entries(p.steps ?? {}).map(([id, x]) => [id, { done: !!x.done, value: x.value ?? "", skipped: !!x.skipped }])),
      });
      if (p?.stage) setStage(p.stage);
      setFinished(w.status === "done");
      restored.current = true;
    }).catch(() => { if (live) setSaveFailed(true); })  // not loaded: nothing is saved over what the server has
      .finally(() => { if (live) setLoaded(true); });
    let initial = true;
    const stop = watchWork(workId, p => {
      const now = Date.now();
      for (const i of allItems(p)) {
        // what is there when the plan opens is not "new"; later additions are highlighted for a while
        // (added_at guards against the replay of an old build's history)
        const recent = !initial && p.version > 2 && (!i.added_at || now / 1000 - i.added_at < NEW_FOR_MS / 1000);
        if (!firstSeen.current.has(i.id)) firstSeen.current.set(i.id, recent ? now : 0);
      }
      initial = false;
      setPlan(p);
    }, e => setEvents(ev => pushEvent(ev, e)));
    return () => { live = false; stop(); };
  }, [workId, round]);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(id); }, []);
  // Once the saved progress and the steps are both in: the step the mechanic stopped at (older saves: the first
  // step neither done nor skipped).
  useEffect(() => {
    if (placed.current || !loaded || !plan?.steps.length) return;
    placed.current = true;
    const saved = plan.steps.findIndex(s => s.id === savedStep.current);
    const open = plan.steps.findIndex(s => !steps[s.id]?.done && !steps[s.id]?.skipped);
    setAt(saved >= 0 ? saved : open >= 0 ? open : plan.steps.length - 1);
  }, [loaded, plan?.steps.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  const progress = (): WorkProgress => {
    const stepIds = new Set(plan?.steps.map(s => String(s.id)));
    const out: WorkProgress = { steps: {}, checks: {}, stage, step: plan?.steps[Math.min(at, plan.steps.length - 1)]?.id ?? null };
    for (const [id, s] of Object.entries(steps)) {
      if (stepIds.has(id)) out.steps[id] = s;
      else if (s.done) out.checks[id] = true;
    }
    return out;
  };
  // Every change is queued and sent ~1 s after the last one; leaving the work does not cancel it.
  useEffect(() => {
    if (!workId || !restored.current || !plan || finished) return;
    queueProgress(workId, progress(), ok => setSaveFailed(!ok));
  }, [steps, stage, at]);  // eslint-disable-line react-hooks/exhaustive-deps

  /** Ends the diagnosis: the server writes measurements, done checks and recommendations into the service book. */
  async function finish() {
    if (!workId) return;
    queueProgress(workId, progress(), ok => setSaveFailed(!ok), 0);
    await flushProgress(workId);
    await api.finishWork(workId);
    setFinished(true);
  }

  /** A failed plan is built again from scratch (its old ticks are dropped on the server). */
  async function rebuild() {
    if (!workId) return;
    dropProgress(workId);
    await api.rebuildWork(workId);
    setRound(r => r + 1);
  }

  const isNew = (i: PlanItem) => Date.now() - (firstSeen.current.get(i.id) ?? 0) < NEW_FOR_MS;
  const stepState = (id: number): StepState => steps[id] ?? { done: false, value: "" };
  const setStep = (id: number, patch: Partial<StepState>) =>
    setSteps(s => ({ ...s, [id]: { ...(s[id] ?? { done: false, value: "" }), ...patch,
      ...(patch.value?.trim() || patch.done ? { skipped: false } : {}) } }));  // a value entered later: no longer skipped
  const doneCount = plan ? plan.steps.filter(s => steps[s.id]?.done).length : 0;
  const skippedCount = plan ? plan.steps.filter(s => steps[s.id]?.skipped).length : 0;
  return { plan, events, isNew, stepState, setStep, doneCount, stage, setStage, finished, finish, saveFailed, rebuild, loaded, skippedCount,
    at, setAt };
}

export type PlanState = ReturnType<typeof usePlan>;

const allItems = (p: WorkPlan) => [...p.tools, ...p.materials, ...p.safety, ...p.steps,
  ...(p.disassembly ?? []), ...(p.prep ?? []), ...(p.quality ?? []), ...(p.aftercare ?? [])];

/** Is a measured value inside the manual's range? null = nothing to judge yet. */
export function inNorm(item: PlanItem, value: string): boolean | null {
  const v = Number(value.replace(",", "."));
  if (!item.measure || !value.trim() || Number.isNaN(v)) return null;
  const { min, max } = item.measure;
  return (min === null || v >= min) && (max === null || v <= max);
}

export function normText(item: PlanItem): string {
  const m = item.measure;
  if (!m) return "";
  const range = m.min !== null && m.max !== null ? (m.min === m.max ? `${m.min}` : `${m.min}–${m.max}`)
    : m.min !== null ? `≥ ${m.min}` : `≤ ${m.max}`;
  return `${range} ${m.unit}`;
}
