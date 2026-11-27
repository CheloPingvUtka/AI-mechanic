import { useEffect, useRef, useState } from "react";
import { Camera, Send, Volume2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CheckSession } from "../session/useCheckSession";
import Markdown from "../../components/ui/Markdown";
import SourceCards, { type PageRef } from "../../components/ui/SourceCards";
import { LiveProgress, ProgressLog } from "../../components/ui/AgentProgress";

/** First paragraph of an answer, without markdown: what gets read aloud. */
export function speakable(answer: string): string {
  const first = answer.split(/\n\s*\n/)[0] ?? "";
  return first.replace(/\*\*/g, "").replace(/\([^()]*стр\. \d+\)/g, "").replace(/^[#\-*•\d.)\s]+/gm, "").trim().slice(0, 400);
}

/** Chat with the agent: live progress, answers with tappable sources, photos, quick questions. */
export default function ChatPanel({ s, engine, onOpen, onSpeak }: {
  s: CheckSession; engine: string; onOpen: (p: PageRef) => void; onSpeak?: (text: string) => void;
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
      <span className="online-dot"/>
    </div>
    <div className="chat-messages" ref={chatBox}>
      <div className="chat-bubble assistant-bubble">{t("chat.hello", "Получите результат проверки — я объясню его и найду порядок проверки в руководстве. Нормативы даю только со ссылкой на страницу.")}</div>
      {s.messages.map(m => <div key={m.id} className={`chat-bubble ${m.role === "user" ? "user-bubble" : "assistant-bubble"} ${m.error ? "error-bubble" : ""}`}>
        {!!m.images?.length && <div className="bubble-photos">{m.images.map((src, i) => <img key={i} src={src} alt=""/>)}</div>}
        {m.role === "user" ? m.text : <Markdown text={m.text} onCite={(manual, page) => {
          const src = m.sources?.find(x => x.manual === manual && x.pdf_page === page);
          if (src) onOpen(src);
        }}/>}
        {!!m.sources?.length && <SourceCards sources={m.sources} onOpen={onOpen}/>}
        {!!m.events?.length && <ProgressLog events={m.events}/>}
        {m.role === "assistant" && !m.error && onSpeak && <button className="speak-button" onClick={() => onSpeak(speakable(m.text))}>
          <Volume2 size={15}/>{t("voice.listen", "Прослушать")}</button>}
        {m.cost !== undefined && <small className="cost-note">{t("chat.cost", "стоимость ответа")} ${m.cost.toFixed(4)}</small>}
      </div>)}
      {s.busy && <div className="chat-bubble assistant-bubble"><LiveProgress events={s.live}/></div>}
    </div>
    <div className="quick-questions"><span className="eyebrow">{t("chat.quick", "БЫСТРЫЕ ВОПРОСЫ")}</span>
      {quick.map(q => <button key={q} disabled={s.busy} onClick={() => void s.send(q)}>{q}</button>)}</div>
    {!!s.photos.length && <div className="photo-tray">{s.photos.map((src, i) => <div key={i}><img src={src} alt=""/>
      <button aria-label={t("remove", "Убрать")} onClick={() => s.removePhoto(i)}><X size={14}/></button></div>)}</div>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={e => { void s.addPhotos(e.target.files); e.target.value = ""; }}/>
      <button type="button" className="icon-button camera-button" onClick={() => photoInput.current?.click()}
        aria-label={t("attachPhoto", "Сфотографировать")}><Camera size={20}/></button>
      <input value={question} onChange={e => setQuestion(e.target.value)} placeholder={t("ask", "Спросить помощника…")}/>
      <button className="send-button" type="submit" disabled={s.busy} aria-label={t("send", "Отправить")}><Send size={17}/></button>
    </form>
  </aside>;
}
