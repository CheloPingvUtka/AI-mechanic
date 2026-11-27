import { Ear, EarOff, Loader2, Mic, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Voice } from "./useVoice";

function useVoiceLabel(voice: Voice) {
  const { t } = useTranslation();
  return {
    off: t("voice.tapToSpeak", "Нажмите и говорите"),
    idle: voice.handsFree ? t("voice.listening", "Слушаю… говорите") : t("voice.speakNow", "Говорите"),
    recording: t("voice.recording", "Записываю…"),
    recognising: t("voice.recognising", "Распознаю…"),
    speaking: t("voice.speaking", "Говорю…"),
  }[voice.status];
}

/** Big glove-friendly push-to-talk button with a live level ring; while the app speaks, a tap stops it. */
export function MicButton({ voice }: { voice: Voice }) {
  const label = useVoiceLabel(voice);
  return <button type="button" className={`voice-main status-${voice.status}`} aria-label={label}
    onClick={() => voice.status === "speaking" ? voice.stopSpeaking() : void voice.listen()}>
    {voice.status === "recording" ? <Square size={24}/> : voice.status === "recognising" ? <Loader2 size={24} className="spin"/>
      : voice.status === "speaking" ? <Volume2 size={24}/> : <Mic size={26}/>}
    <span className="voice-level" style={{ transform: `scale(${1 + voice.level * 0.6})` }}/>
  </button>;
}

/** What the microphone is doing and what it heard. `title`/`hint` replace the idle texts. */
export function VoiceLine({ voice, heard, title, hint }: { voice: Voice; heard: string; title?: string; hint?: string }) {
  const { t } = useTranslation();
  const label = useVoiceLabel(voice);
  return <span className="voice-text">
    <b>{voice.status === "off" && title ? title : label}</b>
    <small>{voice.error === "mic" ? t("voice.noMic", "Нет доступа к микрофону — разрешите его в браузере")
      : voice.error || (heard ? `«${heard}»` : hint ?? t("voice.hint", "«дальше», «готово», «повтори», число замера или вопрос"))}</small>
  </span>;
}

/** Voice mode = hands-free listening, phrase after phrase, and answers read aloud. */
export function VoiceModeToggle({ voice }: { voice: Voice }) {
  const { t } = useTranslation();
  return <button type="button" className={`voice-mode ${voice.handsFree ? "on" : ""}`} aria-pressed={voice.handsFree}
    onClick={() => void voice.toggleHandsFree()}>
    {voice.handsFree ? <Ear size={22}/> : <EarOff size={22}/>}
    <span><b>{t("voice.mode", "Голосовой режим")}</b>
      <small>{voice.handsFree ? t("voice.modeOn", "Включён: слушаю без кнопки и читаю ответы вслух")
        : t("voice.modeOff", "Выключен. Включите, чтобы говорить без рук")}</small></span>
    <i className="switch" aria-hidden="true"/>
  </button>;
}
