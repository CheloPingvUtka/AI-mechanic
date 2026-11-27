import { AlertTriangle, BookOpen, BookOpenCheck, Camera, CheckCircle2, ChevronDown, ClipboardList, FileSearch, Image, Loader2, ScanSearch, Scale, Stethoscope, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AgentEvent } from "../../types/domain";
import type { PageRef } from "./SourceCards";

type Found = { manual_id?: string; manual: string; pdf_page: number };
type Line = { icon: ReactNode; title: string; detail?: string; result?: string; pages?: Found[]; done: boolean; bad?: boolean;
  key?: string; tool?: boolean };
type Tokens = Extract<AgentEvent, { type: "tokens" }>;

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
      lines.push({ icon, title, detail: e.name === "search_manual" ? String(e.args.query ?? "") : undefined, done: false, tool: true });
    } else if (e.type === "tool_result") {
      // the call it answers (picture lines of the plan builder may come in between)
      const last = [...lines].reverse().find(l => l.tool && !l.done);
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
    } else if (e.type === "figures") {
      lines.push({ icon: <Image size={16}/>, title: t("progress.figures", "Подбираю рисунки к шагам"), done: true });
    } else if (e.type === "figures_look") {
      lines.push({ key: e.id, icon: <Image size={16}/>, done: false,
        title: e.second ? t("progress.figuresElsewhere", "Ищу рисунки в других местах руководства") : t("progress.figuresLook", "Смотрю рисунки"),
        detail: t("progress.figuresCount", "{{n}} шт. для шагов: {{s}}", { n: e.count, s: e.steps }),
        pages: e.pages.map(pdf_page => ({ manual_id: e.manual_id, manual: e.manual, pdf_page })) });
    } else if (e.type === "figures_seen") {
      const line = lines.find(l => l.key === e.id);
      if (line) { line.done = true; line.result = t("progress.figuresPicked", "подошло: {{n}}", { n: e.picked }); }
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
      <span><b>{l.title}</b>{l.detail && <> {l.tool ? `«${l.detail}»` : l.detail}</>}{l.result && <em> — {l.result}</em>}</span>
      {!!l.pages?.length && <PageChips pages={l.pages} onOpen={onOpen}/>}
    </div>
  </div>)}</div>;
}

const pageCount = (lines: Line[]) => lines.reduce((n, l) => n + (l.pages?.length ?? 0), 0);

const STALL_MS = 15000;  // the server pings every 5 s: this long without anything means the link is gone
const short = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`);
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** ↑ tokens sent to the model, ↓ received (its reasoning included), like a console agent's counter. */
function TokenStats({ tokens, ms }: { tokens?: Tokens; ms?: number }) {
  const { t } = useTranslation();
  if (!tokens && ms === undefined) return null;
  return <span className="progress-stats" title={t("progress.tokensHint", "↑ отправлено модели (без закэшированного), ↓ получено от неё (из них размышления: {{r}}) — в токенах", { r: tokens?.reasoning ?? 0 })}>
    {tokens && <>↑ {short(tokens.up)} ↓ {short(tokens.down)}</>}{ms !== undefined && <> · {clock(ms)}</>}
  </span>;
}

const lastTokens = (events: AgentEvent[]) => [...events].reverse().find((e): e is Tokens => e.type === "tokens");

/** While the agent works: what it does now, ↑↓ tokens and time; warns when the server went quiet. The list folds out. */
export function LiveProgress({ events, onOpen }: { events: AgentEvent[]; onOpen?: (r: PageRef) => void }) {
  const { t } = useTranslation();
  const lines = useLines(events);
  const mounted = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const started = events[0]?.at ?? mounted.current;
  const lastAt = Math.max(mounted.current, ...events.map(e => e.at ?? 0));
  const quiet = now - lastAt;
  const current = [...lines].reverse().find(l => !l.done);
  const doing = current ? current.title + (current.detail ? ` ${current.tool ? `«${current.detail}»` : current.detail}` : "")
    : events.filter(e => e.type !== "tokens" && e.type !== "ping").pop()?.type === "thinking" || !events.length
      ? t("progress.thinking", "Думаю…") : t("progress.working", "Работаю…");
  const head = quiet > STALL_MS
    ? <><WifiOff size={16} className="stall-icon"/><span className="progress-now progress-stall">{t("progress.stall", "Нет ответа от сервера {{n}} с — проверьте связь", { n: Math.round(quiet / 1000) })}</span></>
    : <><Loader2 size={16} className="spin"/><span className="progress-now">{doing}</span></>;
  const stats = <TokenStats tokens={lastTokens(events)} ms={now - started}/>;
  if (!lines.length) return <div className="progress-live"><div className="progress-summary">{head}{stats}</div></div>;
  return <details className="progress-live">
    <summary className="progress-summary">{head}{stats}
      <span className="progress-more">{t("progress.stepsN", "шагов: {{n}}", { n: lines.length })}<ChevronDown size={14}/></span></summary>
    <Lines lines={lines} onOpen={onOpen}/>
  </details>;
}

/** After the answer: how it was found, folded, with the tokens and time it took. */
export function ProgressLog({ events, onOpen }: { events: AgentEvent[]; onOpen?: (r: PageRef) => void }) {
  const { t } = useTranslation();
  const lines = useLines(events);
  if (!lines.length) return null;
  const pages = pageCount(lines);
  const times = events.map(e => e.at).filter((x): x is number => !!x);
  return <details className="progress-log">
    <summary className="progress-summary"><FileSearch size={16}/>
      <span className="progress-now">{t("progress.how", "Как я искал ответ")}</span>
      <TokenStats tokens={lastTokens(events)} ms={times.length > 1 ? times[times.length - 1] - times[0] : undefined}/>
      <span className="progress-more">{pages ? t("progress.pagesN", "страниц: {{n}}", { n: pages }) : t("progress.stepsN", "шагов: {{n}}", { n: lines.length })}<ChevronDown size={14}/></span>
    </summary>
    <Lines lines={lines} onOpen={onOpen}/>
  </details>;
}
