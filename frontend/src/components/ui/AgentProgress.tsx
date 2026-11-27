import { AlertTriangle, BookOpen, BookOpenCheck, Camera, CheckCircle2, ChevronDown, ClipboardList, FileSearch, Loader2, ScanSearch, Scale, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AgentEvent } from "../../types/domain";
import type { PageRef } from "./SourceCards";

type Found = { manual_id?: string; manual: string; pdf_page: number };
type Line = { icon: ReactNode; title: string; detail?: string; result?: string; pages?: Found[]; done: boolean; bad?: boolean };

/** Turns the agent's event stream into plain lines: what it does, what it looked for, which pages it found. */
function useLines(events: AgentEvent[]): Line[] {
  const { t } = useTranslation();
  const lines: Line[] = [];
  for (const e of events) {
    if (e.type === "tool") {
      const tool: Record<string, [ReactNode, string]> = {
        search_manual: [<FileSearch size={16}/>, t("progress.searchTitle", "Ищу в руководстве")],
        get_diagnosis: [<Stethoscope size={16}/>, t("progress.diagnosis", "Запрашиваю результат проверки")],
        create_ticket: [<ClipboardList size={16}/>, t("progress.ticket", "Формирую заявку в ТОиР")],
        view_page: [<ScanSearch size={16}/>, t("progress.viewTitle", "Смотрю страницу с рисунком")],
        check_photo: [<Camera size={16}/>, t("progress.photo", "Сравниваю фото с рисунками руководства")],
        report_contradiction: [<Scale size={16}/>, t("progress.contradiction", "Нашёл расхождение в руководствах")],
      };
      const [icon, title] = tool[e.name] ?? [<Loader2 size={16}/>, t("progress.working", "Работаю…")];
      lines.push({ icon, title, detail: e.name === "search_manual" ? String(e.args.query ?? "") : undefined, done: false });
    } else if (e.type === "tool_result") {
      const last = lines[lines.length - 1];
      if (!last) continue;
      last.done = true;
      if (e.error) { last.bad = true; last.result = e.error; }
      else if (e.found) {
        const seen = new Set<string>();
        last.pages = e.found.filter(f => !seen.has(`${f.manual}:${f.pdf_page}`) && !!seen.add(`${f.manual}:${f.pdf_page}`));
        if (e.name === "search_manual") last.result = last.pages.length
          ? t("progress.foundN", "нашёл страниц: {{n}}", { n: last.pages.length }) : t("progress.notFound", "в руководстве не найдено");
      }
      else if (e.ticket_id) last.result = t("progress.ticketDone", "заявка {{id}} создана", { id: e.ticket_id });
      else if (e.status) last.result = t(e.status);
    } else if (e.type === "checking") {
      lines.push({ icon: <BookOpenCheck size={16}/>, title: t("progress.checking", "Сверяю числа с найденными страницами руководства"), done: true });
    } else if (e.type === "fixing") {
      lines.push({ icon: <AlertTriangle size={16}/>, title: t("progress.fixing", "Нашёл число без источника — переписываю ответ"), done: false, bad: true });
    }
  }
  return lines;
}

/** Found pages, one group per manual; a page number opens that page. */
function PageChips({ pages, onOpen }: { pages: Found[]; onOpen?: (r: PageRef) => void }) {
  const { t } = useTranslation();
  const groups = pages.reduce<Record<string, Found[]>>((acc, p) => { (acc[p.manual] ??= []).push(p); return acc; }, {});
  return <div className="progress-pages">{Object.entries(groups).map(([manual, list]) => <div key={manual}>
    <small><BookOpen size={12}/>{manual}</small>
    {list.map(p => onOpen && p.manual_id
      ? <button key={p.pdf_page} className="cite-chip" title={t("progress.tapPage", "Открыть страницу")}
          onClick={() => onOpen({ manual_id: p.manual_id!, manual: p.manual, pdf_page: p.pdf_page, figures: 0 })}>{t("page", "стр.")} {p.pdf_page}</button>
      : <span key={p.pdf_page} className="cite-chip">{t("page", "стр.")} {p.pdf_page}</span>)}
  </div>)}</div>;
}

function Lines({ lines, onOpen }: { lines: Line[]; onOpen?: (r: PageRef) => void }) {
  return <div className="progress-lines">{lines.map((l, i) => <div key={i} className={`progress-line ${l.bad ? "bad" : ""}`}>
    {l.done && !l.bad ? <CheckCircle2 size={16}/> : l.icon}
    <div className="progress-text">
      <span><b>{l.title}</b>{l.detail && <> «{l.detail}»</>}{l.result && <em> — {l.result}</em>}</span>
      {!!l.pages?.length && <PageChips pages={l.pages} onOpen={onOpen}/>}
    </div>
  </div>)}</div>;
}

const pageCount = (lines: Line[]) => lines.reduce((n, l) => n + (l.pages?.length ?? 0), 0);

/** While the agent works: one line with what it is doing now; the full list folds out. */
export function LiveProgress({ events, onOpen }: { events: AgentEvent[]; onOpen?: (r: PageRef) => void }) {
  const { t } = useTranslation();
  const lines = useLines(events);
  const current = lines[lines.length - 1];
  const now = current && !current.done ? current.title + (current.detail ? ` «${current.detail}»` : "")
    : events[events.length - 1]?.type === "thinking" || !events.length ? t("progress.thinking", "Думаю…") : t("progress.working", "Работаю…");
  const head = <><Loader2 size={16} className="spin"/><span className="progress-now">{now}</span></>;
  if (!lines.length) return <div className="progress-live"><div className="progress-summary">{head}</div></div>;
  return <details className="progress-live">
    <summary className="progress-summary">{head}
      <span className="progress-more">{t("progress.stepsN", "шагов: {{n}}", { n: lines.length })}<ChevronDown size={14}/></span></summary>
    <Lines lines={lines} onOpen={onOpen}/>
  </details>;
}

/** After the answer: how it was found, folded. */
export function ProgressLog({ events, onOpen }: { events: AgentEvent[]; onOpen?: (r: PageRef) => void }) {
  const { t } = useTranslation();
  const lines = useLines(events);
  if (!lines.length) return null;
  const pages = pageCount(lines);
  return <details className="progress-log">
    <summary className="progress-summary"><FileSearch size={16}/>
      <span className="progress-now">{t("progress.how", "Как я искал ответ")}</span>
      <span className="progress-more">{pages ? t("progress.pagesN", "страниц: {{n}}", { n: pages }) : t("progress.stepsN", "шагов: {{n}}", { n: lines.length })}<ChevronDown size={14}/></span>
    </summary>
    <Lines lines={lines} onOpen={onOpen}/>
  </details>;
}
