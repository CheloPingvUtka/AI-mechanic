import { Ear, EarOff, Loader2, Mic, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Voice } from "./useVoice";

/** Big glove-friendly voice controls: push-to-talk and hands-free, with a live level meter. */
export default function VoiceBar({ voice, heard }: { voice: Voice; heard: string }) {
  const { t } = useTranslation();
  const label = {
    off: t("voice.tapToSpeak", "Нажмите и говорите"),
    idle: voice.handsFree ? t("voice.listening", "Слушаю… говорите") : t("voice.speakNow", "Говорите"),
    recording: t("voice.recording", "Записываю…"),
    recognising: t("voice.recognising", "Распознаю…"),
    speaking: t("voice.speaking", "Говорю…"),
  }[voice.status];
  return <div className={`voice-bar status-${voice.status}`}>
    <button className="voice-main" onClick={() => voice.status === "speaking" ? voice.stopSpeaking() : void voice.listen()}
      aria-label={label}>
      {voice.status === "recording" ? <Square size={30}/> : voice.status === "recognising" ? <Loader2 size={30} className="spin"/>
        : voice.status === "speaking" ? <Volume2 size={30}/> : <Mic size={32}/>}
      <span className="voice-level" style={{ transform: `scale(${1 + voice.level * 0.6})` }}/>
    </button>
    <div className="voice-text">
      <b>{label}</b>
      <small>{voice.error === "mic" ? t("voice.noMic", "Нет доступа к микрофону — разрешите его в браузере")
        : voice.error || (heard ? `«${heard}»` : t("voice.hint", "«дальше», «готово», «повтори», число замера или вопрос"))}</small>
    </div>
    <button className={`voice-hands ${voice.handsFree ? "on" : ""}`} onClick={() => void voice.toggleHandsFree()}
      aria-pressed={voice.handsFree}>
      {voice.handsFree ? <Ear size={24}/> : <EarOff size={24}/>}
      <span>{voice.handsFree ? t("voice.handsFreeOn", "Без рук: вкл") : t("voice.handsFreeOff", "Без рук")}</span>
    </button>
  </div>;
}
