import type { ReactNode } from "react";

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

type Block = { kind: "p"; text: string } | { kind: "h"; text: string } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:([-*•])|\d+[.)])\s+(.*)$/);
    if (item) {
      const kind = item[1] ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(item[2]);
      else blocks.push({ kind, items: [item[2]] });
    } else if (line.trim()) {
      const heading = line.match(/^#{1,4}\s+(.*)$/);
      blocks.push(heading ? { kind: "h", text: heading[1] } : { kind: "p", text: line });
    }
  }
  return blocks;
}

export default function Markdown({ text, onCite }: { text: string; onCite?: OnCite }) {
  return <div className="md">
    {parseBlocks(text).map((b, i) =>
      b.kind === "p" ? <p key={i}>{inline(b.text, onCite)}</p>
      : b.kind === "h" ? <h4 key={i}>{inline(b.text, onCite)}</h4>
      : b.kind === "ul" ? <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, onCite)}</li>)}</ul>
      : <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, onCite)}</li>)}</ol>,
    )}
  </div>;
}
