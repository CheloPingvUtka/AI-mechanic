import { useState, type ReactNode } from "react";
import { Check, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { thumb, withExcerpt, type PageRef } from "./SourceCards";
import type { Source } from "../../types/domain";

// The agent answers in a small Markdown subset: **bold**, "- " / "1. " lists, "#" headings.
// React escapes the text, so model output can never inject HTML.

export type OnCite = (manual: string, page: number) => void;
const CITE = /\(([^()]+?), стр\. (\d+)\)/g;  // what the backend renders for [manual_id:page]

function inline(text: string, onCite?: OnCite): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\([^()]+?, стр\. \d+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{inline(part.slice(2, -2), onCite)}</b>;
    const cite = onCite && [...part.matchAll(CITE)][0];
    if (cite && cite[0] === part) {
      return <button key={i} className="cite-chip" onClick={() => onCite(cite[1], Number(cite[2]))}>📖 {cite[1]}, {cite[2]}</button>;
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
      const heading = line.match(/^#{1,4}\s+(.*)$/);
      blocks.push(heading ? { kind: "h", text: heading[1] } : { kind: "p", text: line });
    }
  }
  return blocks;
}

/** Turns lists of an answer into step cards: manual picture, done tick, "explain" button. */
export type StepTools = { sources?: Source[]; onOpen: (r: PageRef) => void; onExplain: (n: number, text: string) => void; busy?: boolean };

function StepItem({ n, text, onCite, tools }: { n: number; text: string; onCite?: OnCite; tools: StepTools }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const cite = [...text.matchAll(CITE)][0];
  const page = cite && tools.sources?.find(s => s.manual === cite[1] && s.pdf_page === Number(cite[2]));
  const plain = text.replace(CITE, "").replace(/\*\*/g, "").replace(/📖/g, "").trim();
  return <li className={`md-step ${done ? "done" : ""}`}>
    <button className="md-step-num" aria-pressed={done} onClick={() => setDone(d => !d)}
      aria-label={done ? t("plan.doneYes", "Сделано") : t("plan.doneNo", "Отметить")}>{done ? <Check size={20}/> : n}</button>
    <div className="md-step-body">
      <div className="md-step-text">{inline(text, onCite)}</div>
      <div className="md-step-foot">
        <button className="md-step-explain" disabled={tools.busy} onClick={() => tools.onExplain(n, plain.slice(0, 160))}>
          <MessageCircle size={15}/>{t("chat.explainBtn", "Объясни")}</button>
        {page && <button className="md-step-thumb" onClick={() => tools.onOpen(withExcerpt(page))} aria-label={`${t("openPage", "Открыть страницу")} ${page.pdf_page}`}>
          <img src={thumb(page)} alt="" loading="lazy"/><span>{t("page", "стр.")} {page.pdf_page}</span></button>}
      </div>
    </div>
  </li>;
}

export default function Markdown({ text, onCite, steps }: { text: string; onCite?: OnCite; steps?: StepTools }) {
  return <div className="md">
    {parseBlocks(text).map((b, i) =>
      b.kind === "p" ? <p key={i}>{inline(b.text, onCite)}</p>
      : b.kind === "h" ? <h4 key={i}>{inline(b.text, onCite)}</h4>
      : steps && (b.kind === "ol" || b.items.some(x => x.match(CITE)))
        ? <ol key={i} className="md-steps">{b.items.map((x, j) =>
            <StepItem key={j} n={(b.kind === "ol" ? b.start : 1) + j} text={x} onCite={onCite} tools={steps}/>)}</ol>
      : b.kind === "ul" ? <ul key={i}>{b.items.map((x, j) => <li key={j}>{inline(x, onCite)}</li>)}</ul>
      : <ol key={i} start={b.start}>{b.items.map((x, j) => <li key={j}>{inline(x, onCite)}</li>)}</ol>,
    )}
  </div>;
}
