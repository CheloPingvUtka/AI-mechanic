import { AlertTriangle, BookOpen, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Conflict } from "../../types/domain";
import type { PageRef } from "./SourceCards";

/** Manuals disagree: a yellow block with both quotes (tap → the page, quote highlighted) and the manufacturer's links. */
export default function Conflicts({ items, onOpen }: { items?: Conflict[]; onOpen: (r: PageRef) => void }) {
  const { t } = useTranslation();
  if (!items?.length) return null;
  return <>{items.map((c, i) => <div key={i} className="conflict">
    <AlertTriangle size={28}/>
    <div>
      <b>{t("conflict.title", "Руководства говорят по-разному")}</b>
      {c.note && <p>{c.note}</p>}
      {c.sides.map(x => <button key={x.manual_id + x.pdf_page} className="conflict-side"
        onClick={() => onOpen({ manual_id: x.manual_id, manual: x.manual, pdf_page: x.pdf_page, figures: 0, hl: x.quote })}>
        <q>{x.quote}</q><span><BookOpen size={15}/>{x.manual}, {t("page", "стр.")} {x.pdf_page}</span>
      </button>)}
      {c.official.length > 0 && <p className="conflict-official">{t("conflict.ask", "Уточните у производителя:")}
        {c.official.map(o => <a key={o.url} href={o.url} target="_blank" rel="noreferrer">{o.manual}<ExternalLink size={14}/></a>)}</p>}
    </div>
  </div>)}</>;
}
