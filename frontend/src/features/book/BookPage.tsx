import { useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, BookOpen, Camera, Check, CheckCircle2, ClipboardCheck, ClipboardList, Gauge, Lightbulb, Loader2, Plus, RotateCcw, Stethoscope, StickyNote, Wrench, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, photoUrl, shrinkPhoto, useLoad } from "../../lib/api";
import type { BookEntry, BookKind } from "../../types/domain";
import LicensePlate, { parseVehicleId } from "../../components/ui/LicensePlate";
import { currentLang } from "../session/useCheckSession";
import { useVoice } from "../voice/useVoice";
import { MicButton } from "../voice/VoiceBar";

type Row = { text: string; done?: boolean; skipped?: boolean; value?: string | null; ok?: boolean | null; measure?: { unit?: string } | null };

const ICONS: Record<BookKind, ReactNode> = {
  diagnosis: <Stethoscope size={24}/>, recheck: <RotateCcw size={24}/>, ticket: <ClipboardList size={24}/>, defect: <Gauge size={24}/>,
  checks: <ClipboardCheck size={24}/>, repair: <Wrench size={24}/>, recommendation: <Lightbulb size={24}/>, note: <StickyNote size={24}/>,
};

/** Colour = meaning: green ok, yellow attention, red out of norm, blue advice, grey note. */
function tone(e: BookEntry): string {
  const data = e.data as { status?: string; steps?: Row[] } | null;
  if (e.kind === "diagnosis" || e.kind === "recheck") return data?.status === "normal" ? "ok" : "warn";
  if (e.kind === "defect") return data?.steps?.some(s => s.ok === false) ? "bad" : "ok";
  return { checks: "ok", repair: "ok", ticket: "warn", recommendation: "info" }[e.kind as string] ?? "muted";
}

const when = (sec: number) => new Date(sec * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Service book of one vehicle: what was checked, measured, repaired and advised, newest first; the mechanic adds notes with photos. */
export default function BookPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { vehicleId = "" } = useParams();
  const [reload, setReload] = useState(0);
  const { data, error } = useLoad(useCallback(() => api.book(vehicleId), [vehicleId, reload]));  // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState(false);
  const [photo, setPhoto] = useState<number | null>(null);
  const kindLabel: Record<BookKind, string> = {
    diagnosis: t("book.kind.diagnosis", "Проверка"), recheck: t("book.kind.recheck", "Проверка после ремонта"), ticket: t("book.kind.ticket", "Заявка"),
    defect: t("book.kind.defect", "Замеры"), checks: t("book.kind.checks", "Проверки"), repair: t("book.kind.repair", "Ремонт"), recommendation: t("book.kind.recommendation", "Советы"),
    note: t("book.kind.note", "Заметка"),
  };

  return <div className="book">
    <div className="book-head">
      <button className="button button-light book-back" onClick={() => navigate(-1)} aria-label={t("wizard.prev", "Назад")}><ArrowLeft size={24}/></button>
      <div>
        <p className="book-title"><BookOpen size={20}/>{t("book.title", "Сервисная книжка")}</p>
        {parseVehicleId(vehicleId) ? <LicensePlate vehicleId={vehicleId} width={200}/> : <b>{vehicleId}</b>}
        {data && <p className="muted">{data.vehicle.model ?? data.vehicle.make} · {data.vehicle.engine_model} · {data.vehicle.garage_no}</p>}
      </div>
    </div>

    {adding ? <NoteForm vehicleId={vehicleId} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); setReload(x => x + 1); }}/>
      : <button className="button button-primary book-add" onClick={() => setAdding(true)}><Plus size={26}/>{t("book.add", "Добавить запись")}</button>}

    {error && <div className="work-status bad"><XCircle size={28}/><div><b>{error}</b></div></div>}
    {!data && !error && <p className="wizard-loading"><Loader2 size={22} className="spin"/>{t("loading", "Загружаем…")}</p>}
    {data && !data.entries.length && <p className="muted">{t("book.empty", "Записей пока нет.")}</p>}

    <ol className="timeline">{data?.entries.map(e => <li key={e.id ?? `${e.kind}-${e.created_at}`} className={`tl-entry tone-${tone(e)}`}>
      <span className="tl-icon">{ICONS[e.kind] ?? <StickyNote size={24}/>}</span>
      <div className="tl-body">
        <div className="tl-top"><b>{kindLabel[e.kind] ?? e.kind}</b><time>{when(e.created_at)}</time></div>
        {e.title && e.title !== kindLabel[e.kind] && <p className="tl-title">{e.title}</p>}
        <EntryDetails e={e}/>
        {!!e.photos.length && <div className="tl-photos">{e.photos.map(id =>
          <button key={id} onClick={() => setPhoto(id)} aria-label={t("book.photo", "Фото")}><img src={photoUrl(id)} alt="" loading="lazy"/></button>)}</div>}
      </div>
    </li>)}</ol>

    {photo !== null && <div className="viewer" role="dialog" aria-modal="true" onClick={() => setPhoto(null)}>
      <button className="viewer-close photo-close" onClick={() => setPhoto(null)} aria-label={t("close", "Закрыть")}><X size={26}/></button>
      <img className="viewer-photo" src={photoUrl(photo)} alt=""/>
    </div>}
  </div>;
}

/** Text plus what the entry carries: measurements against the norm, done checks (or, in old entries, done repair work)
 *  with the checklist after them, advice. */
function EntryDetails({ e }: { e: BookEntry }) {
  const { t } = useTranslation();
  const data = (e.data ?? {}) as { steps?: Row[]; quality?: Row[]; items?: Row[] };
  const done = e.kind === "checks" || e.kind === "repair";
  const steps = e.kind === "defect" ? (data.steps ?? []).filter(s => s.value || s.measure)
    : done ? (data.steps ?? []).filter(s => s.done) : [];
  const rows: Row[] = [...steps, ...(done ? data.quality ?? [] : []), ...(e.kind === "recommendation" ? data.items ?? [] : [])];
  const showText = e.text && !(done && rows.length) && !(e.kind === "recommendation" && rows.length);
  return <>
    {showText && <p className="tl-text">{e.text}</p>}
    {!!rows.length && <ul className="tl-rows">{rows.map((r, i) => {
      const bad = r.ok === false || (r.done === false && !r.skipped);
      return <li key={i} className={r.skipped ? "skipped" : bad ? "bad" : r.ok || r.done ? "ok" : ""}>
        {e.kind === "recommendation" ? <Lightbulb size={18}/> : r.skipped ? <AlertTriangle size={18}/> : bad ? <XCircle size={18}/> : <CheckCircle2 size={18}/>}
        <span>{r.text}</span>
        {r.value && <em>{r.value} {r.measure?.unit ?? ""}</em>}
        {r.skipped && <em className="skipped">{t("plan.skippedShort", "пропущено")}</em>}
      </li>;
    })}</ul>}
  </>;
}

/** A mechanic's note: text (typed or dictated) and photos from the camera. */
function NoteForm({ vehicleId, onSaved, onCancel }: { vehicleId: string; onSaved: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const voice = useVoice(currentLang(i18n.language), heard => setText(x => (x ? x + " " : "") + heard));
  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const shrunk = await Promise.all([...files].slice(0, 6).map(f => shrinkPhoto(f)));
    setPhotos(p => [...p, ...shrunk].slice(0, 6));
  }
  async function save() {
    setBusy(true); setError("");
    try { await api.addNote(vehicleId, text.trim(), photos); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="note-form">
    <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={t("book.placeholder", "Что увидели или сделали?")}/>
    {!!photos.length && <div className="tl-photos">{photos.map((src, i) => <div key={i} className="note-photo"><img src={src} alt=""/>
      <button onClick={() => setPhotos(p => p.filter((_, j) => j !== i))} aria-label={t("remove", "Убрать")}><X size={16}/></button></div>)}</div>}
    <div className="note-tools">
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { void addPhotos(e.target.files); e.target.value = ""; }}/>
      <button className="button button-light note-camera" onClick={() => input.current?.click()}><Camera size={26}/>{t("book.photo", "Фото")}</button>
      <MicButton voice={voice}/>
    </div>
    {error && <p className="error-text">{error}</p>}
    <div className="note-actions">
      <button className="button button-light" onClick={onCancel}>{t("book.cancel", "Отмена")}</button>
      <button className="button button-primary" disabled={busy || (!text.trim() && !photos.length)} onClick={() => void save()}>
        {busy ? <Loader2 size={22} className="spin"/> : <Check size={22}/>}{t("book.save", "Сохранить")}</button>
    </div>
  </section>;
}
