import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, FileText, Globe, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, apiUrl, useLoad } from "../../lib/api";
import type { Source } from "../../types/domain";

export type PageRef = { manual_id: string; manual: string; pdf_page: number; figures: number };

export const pageImage = (r: PageRef, w = 1000) => apiUrl(`/manuals/${r.manual_id}/pages/${r.pdf_page}.png?w=${w}`);
export const figureImage = (r: PageRef, i: number, w = 700) =>
  apiUrl(`/manuals/${r.manual_id}/pages/${r.pdf_page}/figures/${i}.png?w=${w}`);
export const pdfLink = (r: PageRef) => apiUrl(`/manuals/${r.manual_id}/pdf#page=${r.pdf_page}`);
/** Best small picture for a page: its first figure, otherwise the page itself. */
export const thumb = (r: PageRef) => (r.figures ? figureImage(r, 0, 360) : pageImage(r, 360));

function useManual(manualId: string) {
  const { data } = useLoad(api.manuals);
  return data?.find(m => m.id === manualId);
}

/** Full-screen page viewer: figures first (big), then the whole page; PDF and official links. */
export function PageViewer({ page, onClose }: { page: PageRef; onClose: () => void }) {
  const { t } = useTranslation();
  const manual = useManual(page.manual_id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="viewer" role="dialog" aria-modal="true" onClick={onClose}>
    <div className="viewer-body" onClick={e => e.stopPropagation()}>
      <div className="viewer-bar">
        <div><b>{page.manual}</b><span>{t("page")} {page.pdf_page}</span></div>
        <button className="viewer-close" onClick={onClose} aria-label={t("close")}><X size={26}/></button>
      </div>
      <div className="viewer-actions">
        <a className="button button-primary" href={pdfLink(page)} target="_blank" rel="noreferrer"><FileText size={18}/>{t("openPdf")}</a>
        {manual?.official_url && <a className="button button-light" href={manual.official_url} target="_blank" rel="noreferrer"><Globe size={18}/>{t("officialSite")}<ExternalLink size={14}/></a>}
      </div>
      {manual?.official_note && <p className="muted">{manual.official_note}</p>}
      {Array.from({ length: page.figures }, (_, i) => <img key={i} className="viewer-figure" src={figureImage(page, i, 1200)} alt={`${t("figure")} ${i + 1}`}/>)}
      <img className="viewer-page" src={pageImage(page, 1400)} alt={`${page.manual}, ${t("page")} ${page.pdf_page}`}/>
    </div>
  </div>;
}

/** Sources under an answer: picture cards, tap to open the page. */
export default function SourceCards({ sources, onOpen }: { sources: Source[]; onOpen: (s: PageRef) => void }) {
  const { t } = useTranslation();
  const [quote, setQuote] = useState<string | null>(null);
  return <div className="source-cards">
    <div className="source-cards-title"><BookOpen size={14}/>{t("sources")} · {sources.length}</div>
    <div className="source-strip">
      {sources.map(s => <div key={s.manual_id + s.pdf_page} className="source-card">
        <button className="source-thumb" onClick={() => onOpen(s)} aria-label={`${t("openPage")} ${s.pdf_page}`}>
          <img src={thumb(s)} alt="" loading="lazy"/>
          <span className="source-page">{t("page")} {s.pdf_page}</span>
        </button>
        <div className="source-meta">
          <b>{s.manual}</b>
          {s.ocr && <span className="badge warning">{t("scanCheck")}</span>}
          <div className="source-buttons">
            <button onClick={() => onOpen(s)}>{t("openPage")}</button>
            <button onClick={() => setQuote(quote === s.manual_id + s.pdf_page ? null : s.manual_id + s.pdf_page)}>{t("quote")}</button>
          </div>
        </div>
        {quote === s.manual_id + s.pdf_page && <blockquote>{s.excerpt}</blockquote>}
      </div>)}
    </div>
  </div>;
}
