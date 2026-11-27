import { useEffect, useRef, useState } from "react";
import { watchWork } from "../../lib/api";
import type { AgentEvent, PlanItem, WorkPlan } from "../../types/domain";

const NEW_FOR_MS = 20000;
export type StepState = { done: boolean; value: string };

/** Live work plan for a check plus the mechanic's progress on it (done marks, measured values). */
export function usePlan(workId: string | null) {
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [steps, setSteps] = useState<Record<number, StepState>>({});
  const firstSeen = useRef(new Map<number, number>());
  const [, tick] = useState(0);

  useEffect(() => {
    setPlan(null); setEvents([]); setSteps({}); firstSeen.current.clear();
    if (!workId) return;
    return watchWork(workId, p => {
      const now = Date.now();
      for (const i of [...p.tools, ...p.materials, ...p.safety, ...p.steps]) {
        // the first batch is not "new"; later additions are highlighted for a while
        if (!firstSeen.current.has(i.id)) firstSeen.current.set(i.id, p.version <= 2 ? 0 : now);
      }
      setPlan(p);
    }, e => setEvents(ev => [...ev, e]));
  }, [workId]);
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(id); }, []);

  const isNew = (i: PlanItem) => Date.now() - (firstSeen.current.get(i.id) ?? 0) < NEW_FOR_MS;
  const stepState = (id: number): StepState => steps[id] ?? { done: false, value: "" };
  const setStep = (id: number, patch: Partial<StepState>) =>
    setSteps(s => ({ ...s, [id]: { ...(s[id] ?? { done: false, value: "" }), ...patch } }));
  const doneCount = plan ? plan.steps.filter(s => steps[s.id]?.done).length : 0;
  return { plan, events, isNew, stepState, setStep, doneCount };
}

export type PlanState = ReturnType<typeof usePlan>;

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
