import { AlertTriangle, BookOpenCheck, CheckCircle2, ClipboardList, FileSearch, Loader2, ScanSearch, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AgentEvent } from "../../types/domain";

type Line = { icon: ReactNode; text: string; done: boolean; bad?: boolean };

/** Turns the agent's event stream into readable lines: one per tool call (updated with its result). */
function useLines(events: AgentEvent[]): Line[] {
  const { t } = useTranslation();
  const lines: Line[] = [];
  for (const e of events) {
    if (e.type === "tool") {
      const q = String(e.args.query ?? e.args.session_id ?? "");
      lines.push(e.name === "search_manual" ? { icon: <FileSearch size={14}/>, text: t("progress.search", { q }), done: false }
        : e.name === "get_diagnosis" ? { icon: <Stethoscope size={14}/>, text: t("progress.diagnosis"), done: false }
        : e.name === "create_ticket" ? { icon: <ClipboardList size={14}/>, text: t("progress.ticket"), done: false }
        : e.name === "view_page" ? { icon: <ScanSearch size={14}/>, text: t("progress.viewPage", { page: e.args.ref ?? "" }), done: false }
        : { icon: <Loader2 size={14}/>, text: e.name, done: false });
    } else if (e.type === "tool_result") {
      const last = lines[lines.length - 1];
      if (!last) continue;
      last.done = true;
      if (e.error) { last.bad = true; last.text += ` — ${e.error}`; }
      else if (e.found) last.text += " — " + (e.found.length
        ? t("progress.found", { pages: e.found.map(f => `${f.manual}, ${t("page")} ${f.pdf_page}`).join("; ") })
        : t("progress.notFound"));
      else if (e.ticket_id) last.text += " — " + t("progress.ticketDone", { id: e.ticket_id });
      else if (e.status) last.text += ` — ${t(e.status)}`;
    } else if (e.type === "checking") {
      lines.push({ icon: <BookOpenCheck size={14}/>, text: t("progress.checking"), done: true });
    } else if (e.type === "fixing") {
      lines.push({ icon: <AlertTriangle size={14}/>, text: t("progress.fixing"), done: false, bad: true });
    }
  }
  return lines;
}

/** Live view while the agent works. */
export function LiveProgress({ events }: { events: AgentEvent[] }) {
  const { t } = useTranslation();
  const lines = useLines(events);
  const last = events[events.length - 1];
  return <div className="progress-live">
    {lines.map((l, i) => <div key={i} className={`progress-line ${l.bad ? "bad" : ""}`}>{l.done ? <CheckCircle2 size={14}/> : l.icon}<span>{l.text}</span></div>)}
    <div className="progress-line current"><Loader2 size={14} className="spin"/><span>{!last || last.type === "thinking" ? t("progress.thinking") : t("progress.working")}</span></div>
  </div>;
}

/** After the answer: the same steps, folded. */
export function ProgressLog({ events }: { events: AgentEvent[] }) {
  const { t } = useTranslation();
  const lines = useLines(events);
  if (!lines.length) return null;
  return <details className="progress-log">
    <summary>{t("progress.how", { n: lines.length })}</summary>
    {lines.map((l, i) => <div key={i} className={`progress-line ${l.bad ? "bad" : ""}`}>{l.icon}<span>{l.text}</span></div>)}
  </details>;
}
