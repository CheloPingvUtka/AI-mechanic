import type { ReactNode } from "react";

// The agent answers in a small Markdown subset: **bold**, "- " / "1. " lists, "#" headings.
// React escapes the text, so model output can never inject HTML.

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part,
  );
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

export default function Markdown({ text }: { text: string }) {
  return <div className="md">
    {parseBlocks(text).map((b, i) =>
      b.kind === "p" ? <p key={i}>{inline(b.text)}</p>
      : b.kind === "h" ? <h4 key={i}>{inline(b.text)}</h4>
      : b.kind === "ul" ? <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>
      : <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>,
    )}
  </div>;
}
