import { useEffect, useRef, useState } from "react";
import { api, pushEvent, watchWork } from "../../lib/api";
import type { AgentEvent, PlanItem, Stage, WorkPlan, WorkProgress } from "../../types/domain";

const NEW_FOR_MS = 20000;
export type StepState = { done: boolean; value: string };

/** Live work plan for a check plus the mechanic's progress on it (done marks, ticks, measured values, stage),
 *  restored from the server and saved back about a second after every change. */
export function usePlan(workId: string | null) {
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [steps, setSteps] = useState<Record<number, StepState>>({});  // steps and checklist ticks, by item id
  const [stage, setStage] = useState<Stage>("prep");
  const [finished, setFinished] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [round, setRound] = useState(0);  // bumped by rebuild(): subscribe to the new build
  const restored = useRef(false);
  const firstSeen = useRef(new Map<number, number>());
  const [, tick] = useState(0);

  useEffect(() => {
    setPlan(null); setEvents([]); setSteps({}); setStage("prep"); setFinished(false); setSaveFailed(false);
    restored.current = false; firstSeen.current.clear();
    if (!workId) return;
    let live = true;
    // Saved progress first (resuming a repair), then the live plan.
    api.work(workId).then(w => {
      if (!live) return;
      const p = w.progress;
      if (p) setSteps({
        ...Object.fromEntries(Object.entries(p.checks ?? {}).map(([id, done]) => [id, { done: !!done, value: "" }])),
        ...Object.fromEntries(Object.entries(p.steps ?? {}).map(([id, x]) => [id, { done: !!x.done, value: x.value ?? "" }])),
      });
      if (p?.stage) setStage(p.stage);
      setFinished(w.status === "done");
    }).catch(() => { /* new work: nothing saved yet */ }).finally(() => { if (live) restored.current = true; });
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

  const progress = (): WorkProgress => {
    const stepIds = new Set(plan?.steps.map(s => String(s.id)));
    const out: WorkProgress = { steps: {}, checks: {}, stage };
    for (const [id, s] of Object.entries(steps)) {
      if (stepIds.has(id)) out.steps[id] = s;
      else if (s.done) out.checks[id] = true;
    }
    return out;
  };
  const save = () => workId ? api.saveProgress(workId, progress()).then(() => setSaveFailed(false), () => setSaveFailed(true)) : Promise.resolve();
  // Save every change, ~1 s after the last one (only after the saved state was loaded, so it is never overwritten with nothing).
  useEffect(() => {
    if (!restored.current || !plan || finished) return;
    const timer = setTimeout(() => void save(), 1000);
    return () => clearTimeout(timer);
  }, [steps, stage]);  // eslint-disable-line react-hooks/exhaustive-deps

  /** Ends the repair: the server writes defects, done work and recommendations into the service book. */
  async function finish() {
    if (!workId) return;
    await save();
    await api.finishWork(workId);
    setFinished(true);
  }

  /** A failed plan is built again from scratch (its old ticks are dropped on the server). */
  async function rebuild() {
    if (!workId) return;
    await api.rebuildWork(workId);
    setRound(r => r + 1);
  }

  const isNew = (i: PlanItem) => Date.now() - (firstSeen.current.get(i.id) ?? 0) < NEW_FOR_MS;
  const stepState = (id: number): StepState => steps[id] ?? { done: false, value: "" };
  const setStep = (id: number, patch: Partial<StepState>) =>
    setSteps(s => ({ ...s, [id]: { ...(s[id] ?? { done: false, value: "" }), ...patch } }));
  const doneCount = plan ? plan.steps.filter(s => steps[s.id]?.done).length : 0;
  return { plan, events, isNew, stepState, setStep, doneCount, stage, setStage, finished, finish, saveFailed, rebuild };
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
