import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, HelpCircle, Send, Volume2, X, XCircle } from "lucide-react";
import type { Voice } from "../voice/useVoice";
import { MicButton, VoiceLine, VoiceModeToggle } from "../voice/VoiceBar";
import { useTranslation } from "react-i18next";
import type { CheckSession } from "../session/useCheckSession";
import Markdown from "../../components/ui/Markdown";
import SourceCards, { withExcerpt, type PageRef } from "../../components/ui/SourceCards";
import Conflicts from "../../components/ui/Conflicts";
import type { PhotoCheck } from "../../types/domain";
import { LiveProgress, ProgressLog } from "../../components/ui/AgentProgress";

/** First paragraph of an answer, without markdown: what gets read aloud. */
export function speakable(answer: string): string {
  const first = answer.split(/\n\s*\n/)[0] ?? "";
  return first.replace(/\*\*/g, "").replace(/\([^()]*стр\. \d+\)/g, "").replace(/^[#\-*•\d.)\s]+/gm, "").trim().slice(0, 400);
}

/** Chat with the agent: live progress, answers as step cards with sources, photos, quick questions; optional voice. */
export default function ChatPanel({ s, engine, onOpen, onSpeak, voice, heard = "", onClose }: {
  s: CheckSession; engine: string; onOpen: (p: PageRef) => void; onSpeak?: (text: string) => void;
  voice?: Voice; heard?: string; onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const chatBox = useRef<HTMLDivElement>(null);
  // Scroll only the chat box (desktop); never the page, so the verdict stays in view on a phone.
  useEffect(() => { chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight, behavior: "smooth" }); }, [s.messages, s.busy, s.live]);
  const quick = [
    t("quick.danger", "Чем опасна эта неисправность?"),
    t("quick.first", "Что проверить в первую очередь?"),
    t("quick.drive", "Можно ли своим ходом перегнать машину на базу?"),
  ];
  const submit = () => { const q = question; setQuestion(""); void s.send(q); };

  return <aside className="assistant-panel panel">
    <div className="assistant-heading">
      <div className="assistant-avatar"><span className="wrench-glyph">✳</span></div>
      <div><h2>{t("assistant", "Помощник механика")}</h2><small>{t("chat.onlyManual", "Отвечает только по руководству на {{engine}}", { engine })}</small></div>
      {onClose ? <button className="viewer-close chat-close" onClick={onClose} aria-label={t("close", "Закрыть")}><X size={26}/></button>
        : <span className="online-dot"/>}
    </div>
    {voice && <VoiceModeToggle voice={voice}/>}
    <div className="chat-messages" ref={chatBox}>
      <div className="chat-bubble assistant-bubble">{t("chat.hello", "Получите результат проверки — я объясню его и найду порядок проверки в руководстве. Нормативы даю только со ссылкой на страницу.")}</div>
      {s.messages.map(m => <div key={m.id} className={`chat-bubble ${m.role === "user" ? "user-bubble" : "assistant-bubble"} ${m.error ? "error-bubble" : ""}`}>
        {!!m.images?.length && <div className="bubble-photos">{m.images.map((src, i) => <img key={i} src={src} alt=""/>)}</div>}
        {m.photoCheck && <PhotoBadge check={m.photoCheck}/>}
        {m.role === "user" ? m.text : <Markdown text={m.text} onCite={(manual, page) => {
          const src = m.sources?.find(x => x.manual === manual && x.pdf_page === page);
          if (src) onOpen(withExcerpt(src));
        }} steps={m.error ? undefined : { sources: m.sources, figures: m.figures, onOpen, busy: s.busy,
          onExplain: (n, text) => void s.send(t("chat.explainStep", "Объясни подробнее шаг {{n}}: {{text}}", { n, text })) }}/>}
        <Conflicts items={m.contradictions} onOpen={onOpen}/>
        {!!m.sources?.length && <SourceCards sources={m.sources} onOpen={onOpen}/>}
        {!!m.events?.length && <ProgressLog events={m.events} onOpen={onOpen}/>}
        {m.role === "assistant" && !m.error && onSpeak && <button className="speak-button" onClick={() => onSpeak(speakable(m.text))}>
          <Volume2 size={15}/>{t("voice.listen", "Прослушать")}</button>}
      </div>)}
      {s.busy && <div className="chat-bubble assistant-bubble"><LiveProgress events={s.live} onOpen={onOpen}/></div>}
    </div>
    <div className="quick-questions"><span className="eyebrow">{t("chat.quick", "БЫСТРЫЕ ВОПРОСЫ")}</span>
      {quick.map(q => <button key={q} disabled={s.busy} onClick={() => void s.send(q)}>{q}</button>)}</div>
    {!!s.photos.length && <div className="photo-tray">{s.photos.map((src, i) => <div key={i}><img src={src} alt=""/>
      <button aria-label={t("remove", "Убрать")} onClick={() => s.removePhoto(i)}><X size={14}/></button></div>)}</div>}
    {voice && (voice.status !== "off" || voice.error || heard) && <div className="chat-voice-line"><VoiceLine voice={voice} heard={heard}/></div>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={e => { void s.addPhotos(e.target.files); e.target.value = ""; }}/>
      <button type="button" className="icon-button camera-button" onClick={() => photoInput.current?.click()}
        aria-label={t("attachPhoto", "Сфотографировать")}><Camera size={20}/></button>
      <input value={question} onChange={e => setQuestion(e.target.value)} placeholder={t("ask", "Спросить помощника…")}/>
      {voice && <MicButton voice={voice}/>}
      <button className="send-button" type="submit" disabled={s.busy} aria-label={t("send", "Отправить")}><Send size={17}/></button>
    </form>
  </aside>;
}

/** What the photo shows and whether it looks like this vehicle's engine: green / red / grey. */
function PhotoBadge({ check }: { check: PhotoCheck }) {
  const { t } = useTranslation();
  const [cls, icon, text] = check.matches === "yes"
    ? ["ok", <CheckCircle2 size={20}/>, t("photo.yes", "На фото: {{what}} — похоже на двигатель этой машины", { what: check.shows })]
    : check.matches === "no"
      ? ["bad", <XCircle size={20}/>, t("photo.no", "На фото: {{what}} — не похоже. Проверьте, тот ли двигатель", { what: check.shows })]
      : ["unclear", <HelpCircle size={20}/>, t("photo.unclear", "Не понять по фото")];
  return <div className={`photo-check ${cls}`} title={check.reason}>{icon}<span>{text}</span></div>;
}
