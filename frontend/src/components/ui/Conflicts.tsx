import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, ExternalLink, Info, Lightbulb, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Conflict, PlanItem } from "../../types/domain";
import type { PageRef } from "./SourceCards";

// Conflicts the mechanic closed stay closed (on this device); they remain in the disputes journal.
const HIDDEN_KEY = "dm.hiddenConflicts";
const signature = (c: Conflict) => c.note + "|" + c.sides.map(s => `${s.manual_id}:${s.pdf_page}`).join(",");
function readHidden(): string[] {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); } catch { return []; }
}
function writeHidden(list: string[]) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(list.slice(-200))); } catch { /* private mode: only for now */ }
}

/** Does the conflict concern this step: the same manual page, or the same words quoted. */
export function concerns(c: Conflict, step: PlanItem): boolean {
  const quote = (step.quote ?? "").toLowerCase();
  return c.sides.some(s => (s.manual_id === step.manual_id && s.pdf_page === step.pdf_page)
    || (!!quote && (s.quote.toLowerCase().includes(quote) || quote.includes(s.quote.toLowerCase()))));
}

function Sides({ c, onOpen }: { c: Conflict; onOpen: (r: PageRef) => void }) {
  const { t } = useTranslation();
  return <>{c.sides.map(x => <button key={x.manual_id + x.pdf_page} className="conflict-side"
    onClick={() => onOpen({ manual_id: x.manual_id, manual: x.manual, pdf_page: x.pdf_page, figures: 0, hl: x.quote })}>
    <q>{x.quote}</q><span><BookOpen size={15}/>{x.manual}, {t("page", "стр.")} {x.pdf_page}</span>
  </button>)}</>;
}

/** Manuals disagree. Important ones (a different norm, order or ban): a yellow block with both quotes and the
 *  manufacturer's links, which can be closed. Minor ones (the same norm rounded or in other units): one folded line. */
function Recommendation({ c }: { c: Conflict }) {
  const { t } = useTranslation();
  return c.recommendation ? <p className="conflict-rec"><Lightbulb size={18}/>
    <span><b>{t("conflict.recommendation", "Рекомендация ИИ (не из руководства)")}:</b> {c.recommendation}</span></p> : null;
}

/** `focus`: the note of a conflict opened from the disputes journal; it is shown (even if closed) and scrolled to. */
export default function Conflicts({ items, onOpen, focus }: { items?: Conflict[]; onOpen: (r: PageRef) => void; focus?: string | null }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(readHidden);
  const focused = useRef<HTMLDivElement>(null);
  useEffect(() => { focused.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus, items?.length]);
  if (!items?.length) return null;
  const hide = (c: Conflict) => { const next = [...hidden, signature(c)]; setHidden(next); writeHidden(next); };
  const showAll = () => { const mine = new Set(items.map(signature)); const next = hidden.filter(h => !mine.has(h)); setHidden(next); writeHidden(next); };
  const shown = items.filter(c => c.note === focus || !hidden.includes(signature(c)));
  const critical = shown.filter(c => c.severity !== "minor");
  const minor = shown.filter(c => c.severity === "minor");
  const closed = items.length - shown.length;
  return <>
    {critical.map(c => <div key={signature(c)} className={`conflict ${c.note === focus ? "focus" : ""}`} ref={c.note === focus ? focused : undefined}>
      <AlertTriangle size={28}/>
      <div>
        <b>{t("conflict.title", "Руководства говорят по-разному")}</b>
        {c.note && <p>{c.note}</p>}
        <Sides c={c} onOpen={onOpen}/>
        <Recommendation c={c}/>
        {c.official.length > 0 && <p className="conflict-official">{t("conflict.ask", "Уточните у производителя:")}
          {c.official.map(o => <a key={o.url} href={o.url} target="_blank" rel="noreferrer">{o.manual}<ExternalLink size={14}/></a>)}</p>}
      </div>
      <button className="conflict-close" onClick={() => hide(c)} aria-label={t("conflict.hide", "Скрыть")} title={t("conflict.hide", "Скрыть")}><X size={22}/></button>
    </div>)}
    {minor.length > 0 && <details className="conflict-minor" open={minor.some(c => c.note === focus) || undefined}>
      <summary><Info size={18}/>{t("conflict.minor", "Мелкие расхождения в руководствах: {{n}} — норма та же, округлена по-разному", { n: minor.length })}</summary>
      {minor.map(c => <div key={signature(c)} className={`conflict-minor-item ${c.note === focus ? "focus" : ""}`} ref={c.note === focus ? focused : undefined}>
        {c.note && <p>{c.note}</p>}
        <Sides c={c} onOpen={onOpen}/>
        <Recommendation c={c}/>
        <button className="conflict-hide-link" onClick={() => hide(c)}>{t("conflict.hide", "Скрыть")}</button>
      </div>)}
    </details>}
    {closed > 0 && <button className="conflict-hidden-link" onClick={showAll}>
      {t("conflict.hiddenN", "Скрытые расхождения: {{n}} — показать", { n: closed })}</button>}
  </>;
}
