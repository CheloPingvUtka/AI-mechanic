import { useState, type ReactNode } from "react";
import { Check, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { figureImage, withExcerpt, type PageRef } from "./SourceCards";
import type { FigurePick, Source } from "../../types/domain";

// The agent answers in a small Markdown subset: **bold**, "- " / "1. " lists, "#" headings.
// React escapes the text, so model output can never inject HTML.

export type OnCite = (manual: string, page: number) => void;
const CITE = /\(([^()]+?), стр\. (\d+)\)/g;  // what the backend renders for [manual_id:page]

function inline(text: string, onCite?: OnCite): ReactNode[] {
  const t = i18n.t.bind(i18n);
  return text.split(/(\*\*[^*]+\*\*|\([^()]+?, стр\. \d+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{inline(part.slice(2, -2), onCite)}</b>;
    const cite = onCite && [...part.matchAll(CITE)][0];
    if (cite && cite[0] === part) {
      // short chip: the page number; the manual's name is in the tooltip and in the opened page
      return <button key={i} className="cite-chip" title={cite[1]} onClick={() => onCite(cite[1], Number(cite[2]))}>📖 {t("page", "стр.")} {cite[2]}</button>;
    }
    return part;
  });
}

type Block = { kind: "p"; text: string } | { kind: "h"; text: string } | { kind: "ul" | "ol"; items: string[]; start: number };

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      const kind = item[1] ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(item[3]);
      else blocks.push({ kind, items: [item[3]], start: Number(item[2] ?? 1) });
    } else if (line.trim()) {
      const heading = line.match(/^#{1,4}\s+(.*)$/) ?? line.match(/^\s*\*\*([^*]{1,60})\*\*:?\s*$/);  // a short "**Title**" alone is a heading too
      blocks.push(heading ? { kind: "h", text: heading[1] } : { kind: "p", text: line });
    }
  }
  return blocks;
}

/** Turns lists of an answer into step cards: manual picture, done tick, "explain" button. */
export type StepTools = { sources?: Source[]; figures?: Record<string, FigurePick>; onOpen: (r: PageRef) => void;
  onExplain: (n: number, text: string) => void; busy?: boolean };

/** Key of a list item; the backend computes the same one for the drawing it picked (agent_service.step_key). */
export const stepKey = (text: string) =>
  text.replace(CITE, "").replace(/\*\*/g, "").replace(/📖/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 60);

function StepItem({ n, text, onCite, tools }: { n: number; text: string; onCite?: OnCite; tools: StepTools }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const cite = [...text.matchAll(CITE)][0];
  const page = cite && tools.sources?.find(s => s.manual === cite[1] && s.pdf_page === Number(cite[2]));
  const plain = text.replace(CITE, "").replace(/\*\*/g, "").replace(/📖/g, "").trim();
  // the drawing the model chose for this step; none = no picture (never just the first one on the page)
  const pick = tools.figures?.[stepKey(text)];
  // the picture already shows the cited page, so its chip is not repeated in the text
  const shown = pick && page && cite && pick.pdf_page === page.pdf_page ? text.replace(cite[0], "").replace(/\s+([.,;])/g, "$1").trim() : text;
  return <li className={`md-step ${done ? "done" : ""}`}>
    <button className="md-step-num" aria-pressed={done} onClick={() => setDone(d => !d)}
      aria-label={done ? t("plan.doneYes", "Сделано") : t("plan.doneNo", "Отметить")}>{done ? <Check size={18}/> : n}</button>
    <div className="md-step-text">{inline(shown, onCite)}</div>
    <div className="md-step-foot">
      {pick && <button className="md-step-thumb" aria-label={`${t("openPage", "Открыть страницу")} ${pick.pdf_page}`}
          onClick={() => tools.onOpen(page && page.pdf_page === pick.pdf_page ? withExcerpt(page) : { ...pick, figures: 1 })}>
        <img src={figureImage(pick, pick.figure, 360)} alt="" loading="lazy"/><span>📖 {t("page", "стр.")} {pick.pdf_page}</span></button>}
      <button className="md-step-explain" disabled={tools.busy} onClick={() => tools.onExplain(n, plain.slice(0, 160))}>
        <MessageCircle size={16}/>{t("chat.explainBtn", "Объясни")}</button>
    </div>
  </li>;
}

export default function Markdown({ text, onCite, steps }: { text: string; onCite?: OnCite; steps?: StepTools }) {
  return <div className="md">
    {parseBlocks(text).map((b, i) =>
      b.kind === "p" ? <p key={i}>{inline(b.text, onCite)}</p>
      : b.kind === "h" ? <h4 key={i}>{inline(b.text, onCite)}</h4>
      // a list from the manual (most items cite a page) = steps; observations and hypotheses stay a plain list
      : steps && b.items.filter(x => x.match(CITE)).length * 2 >= b.items.length
        ? <ol key={i} className="md-steps">{b.items.map((x, j) =>
            <StepItem key={j} n={(b.kind === "ol" ? b.start : 1) + j} text={x} onCite={onCite} tools={steps}/>)}</ol>
      : b.kind === "ul" ? <ul key={i} className="md-list">{b.items.map((x, j) => <li key={j}>{inline(x, onCite)}</li>)}</ul>
      : <ol key={i} className="md-list" style={{ counterReset: `md ${b.start - 1}` }}>{b.items.map((x, j) => <li key={j}>{inline(x, onCite)}</li>)}</ol>,
    )}
  </div>;
}
