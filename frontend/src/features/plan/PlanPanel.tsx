import type { ReactNode } from "react";
import { BookOpen, CheckCircle2, Circle, Cog, HardHat, Loader2, Package, Send, Sparkles, Truck, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { PlanItem, WorkPlan } from "../../types/domain";
import { LiveProgress } from "../../components/ui/AgentProgress";
import { figureImage, pageImage, type PageRef } from "../../components/ui/SourceCards";
import { inNorm, normText, type PlanState, type StepState } from "./usePlan";

export function pageRef(item: PlanItem): PageRef | null {
  return item.manual_id && item.pdf_page
    ? { manual_id: item.manual_id, manual: item.manual ?? "", pdf_page: item.pdf_page, figures: item.figures, hl: item.quote }
    : null;
}

export function PlanStatus({ plan }: { plan: WorkPlan }) {
  const { t } = useTranslation();
  const label = { building: t("plan.status_building", "собирается"), ready: t("plan.status_ready", "готов"),
    failed: t("plan.status_failed", "ошибка") }[plan.status];
  return <span className={`badge ${plan.status === "ready" ? "success" : plan.status === "failed" ? "danger" : "info"}`}>
    {plan.status === "building" && <Loader2 size={12} className="spin"/>}{label}
  </span>;
}

export type Section = { key: string; title: string; icon: ReactNode; items: PlanItem[]; ordered?: boolean; danger?: boolean };

/** Plan items by section. Preliminary items are marked; new ones flash; `checkable` = a big tick list. */
export function CheckList({ p, sections, onOpen, checkable = false }: {
  p: PlanState; sections: Section[]; onOpen: (r: PageRef) => void; checkable?: boolean;
}) {
  const { t } = useTranslation();
  const shown = sections.filter(x => x.items.length);
  if (!shown.length) return null;
  const row = (i: PlanItem, text: string, icon: ReactNode) => {
    const ref = pageRef(i);
    const done = checkable && p.stepState(i.id).done;  // ticks share the step-state store (ids are unique per plan)
    return <li key={i.id} className={`prep-item ${i.preliminary ? "preliminary" : ""} ${p.isNew(i) ? "is-new" : ""} ${done ? "done" : ""}`}>
      {checkable ? <button className="prep-check" aria-pressed={done} onClick={() => p.setStep(i.id, { done: !done })}>
          {done ? <CheckCircle2 size={28}/> : <Circle size={28}/>}<span>{text}</span></button>
        : <>{icon}<span>{text}</span></>}
      {i.preliminary ? <em>{t("plan.preliminary", "предварительно")}</em>
        : ref && <button className="cite-chip" onClick={() => onOpen(ref)}>📖 {ref.pdf_page}</button>}
      {p.isNew(i) && <strong className="new-badge"><Sparkles size={11}/>{t("plan.new", "новое")}</strong>}
    </li>;
  };
  return <div className="prep-grid">{shown.map(x => <div key={x.key} className={x.danger ? "prep-danger" : ""}>
    <h3>{x.icon}{x.title}</h3>
    <ul>{x.items.map((i, n) => row(i, x.ordered ? `${n + 1}. ${i.text}` : i.text, x.icon))}</ul>
  </div>)}</div>;
}

/** Stage 1 of the work: safety first, then the vehicle and workplace, tools, parts, what to remove. */
export function prepSections(plan: WorkPlan, t: TFunction): Section[] {
  return [
    { key: "safety", title: t("plan.safety", "Безопасность"), icon: <HardHat size={18}/>, items: plan.safety, danger: true },
    { key: "prep", title: t("plan.prepCar", "Подготовка машины и места"), icon: <Truck size={18}/>, items: plan.prep ?? [], ordered: true },
    { key: "tools", title: t("plan.tools", "Инструмент"), icon: <Wrench size={18}/>, items: plan.tools },
    { key: "materials", title: t("plan.materials", "Запчасти и материалы"), icon: <Package size={18}/>, items: plan.materials },
    { key: "disassembly", title: t("plan.disassembly", "Что снять"), icon: <Cog size={18}/>, items: plan.disassembly ?? [], ordered: true },
  ];
}

export function PrepList({ p, onOpen }: { p: PlanState; onOpen: (r: PageRef) => void }) {
  const { t } = useTranslation();
  return <CheckList p={p} sections={prepSections(p.plan!, t)} onOpen={onOpen}/>;
}

/** One step: text, measurement against the manual norm, the page picture, a big done toggle. */
export function StepCard({ item, n, state, setStep, onOpen, big = false, isNew = false }: {
  item: PlanItem; n: number; state: StepState; setStep: (patch: Partial<StepState>) => void;
  onOpen: (r: PageRef) => void; big?: boolean; isNew?: boolean;
}) {
  const { t } = useTranslation();
  const ok = inNorm(item, state.value);
  const ref = pageRef(item);
  // only the drawing the model chose for this step; without one, the cited page itself (quote highlighted)
  const pic = ref && item.figure != null ? { ...ref, pdf_page: item.figure_page ?? ref.pdf_page } : null;
  return <li className={`step-card ${big ? "step-big" : ""} ${state.done ? "done" : ""} ${isNew ? "is-new" : ""}`}>
    <div className="step-num">{state.done ? <CheckCircle2 size={22}/> : n}</div>
    <div className="step-body">
      <p className="step-text">{item.text}</p>
      {item.measure && <div className={`measure ${ok === true ? "ok" : ok === false ? "bad" : ""}`}>
        <label>{item.measure.name}</label>
        <div className="measure-row">
          <input inputMode="decimal" value={state.value} placeholder="0" onChange={e => setStep({ value: e.target.value })}/>
          <span>{item.measure.unit}</span>
        </div>
        <small>{t("plan.norm", "Норма")}: {normText(item)}{ok === true ? ` — ${t("plan.ok", "в норме")}`
          : ok === false ? ` — ${t("plan.outOfNorm", "вне нормы")}` : ""}</small>
      </div>}
      {ref && (big && pic
        ? <button className="step-figure" onClick={() => onOpen(pic.pdf_page === ref.pdf_page ? ref : { ...pic, hl: null })}>
            <img src={figureImage(pic, item.figure!, 900)} alt=""/>
            <span><BookOpen size={14}/> {ref.manual}, {t("page", "стр.")} {pic.pdf_page}</span>
          </button>
        : <button className="step-source" onClick={() => onOpen(ref)}>
            <img src={pic ? figureImage(pic, item.figure!, 360) : pageImage({ ...ref, hl: null }, 360)} alt="" loading="lazy"/>
            <span><BookOpen size={13}/> {ref.manual}, {t("page", "стр.")} {pic?.pdf_page ?? ref.pdf_page}</span>
          </button>)}
    </div>
    {/* big (wizard) card: "done" is the action bar's job; here it only shows, and undoes, the mark */}
    {(!big || state.done) && <button className="step-done" onClick={() => setStep({ done: !state.done })} aria-pressed={state.done}>
      {state.done ? <CheckCircle2 size={26}/> : <Circle size={26}/>}
      <span>{state.done ? t("plan.doneYes", "Сделано") : t("plan.doneNo", "Отметить")}</span>
    </button>}
  </li>;
}

/** Text the mechanic sends back to the agent: what was done and measured. */
export function planReport(plan: WorkPlan, p: PlanState, t: (k: string, d: string) => string): string {
  const lines = plan.steps.map((s, i) => {
    const st = p.stepState(s.id);
    const value = st.value
      ? `, ${s.measure?.name}: ${st.value} ${s.measure?.unit} (${inNorm(s, st.value) ? t("plan.ok", "в норме") : t("plan.outOfNorm", "вне нормы")})`
      : "";
    return `${i + 1}. ${st.done ? "✓" : "—"} ${s.text.slice(0, 80)}${value}`;
  });
  return `${t("plan.reportHeader", "Результаты работ по плану:")}\n${lines.join("\n")}`;
}

/** Whole plan on one panel (detailed workspace). */
export default function PlanPanel({ p, onOpen, onReport }: {
  p: PlanState; onOpen: (r: PageRef) => void; onReport: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (!p.plan) return <section className="panel plan-panel"><p className="muted"><Loader2 size={14} className="spin"/> {t("plan.starting", "Готовлю рабочий план…")}</p></section>;
  const plan = p.plan;
  return <section className="panel plan-panel">
    <div className="panel-heading">
      <div><p className="eyebrow">{t("plan.eyebrow", "РАБОЧИЙ ПЛАН")}</p><h2>{t("plan.title", "Что подготовить и что делать")}</h2></div>
      <PlanStatus plan={plan}/>
    </div>
    {plan.status === "building" && <div className="plan-live"><LiveProgress events={p.events} onOpen={onOpen}/></div>}
    {plan.note && <p className="plan-note">{plan.note}</p>}
    <PrepList p={p} onOpen={onOpen}/>
    {plan.steps.length > 0 && <>
      <h3 className="steps-title">{t("plan.steps", "Шаги")} <span>{p.doneCount}/{plan.steps.length}</span></h3>
      <ol className="step-cards">{plan.steps.map((s, n) =>
        <StepCard key={s.id} item={s} n={n + 1} state={p.stepState(s.id)} setStep={patch => p.setStep(s.id, patch)}
          onOpen={onOpen} isNew={p.isNew(s)}/>)}</ol>
      <button className="button button-primary button-large" onClick={() => onReport(planReport(plan, p, t))}>
        <Send size={17}/>{t("plan.report", "Отправить результаты агенту")}</button>
    </>}
  </section>;
}
