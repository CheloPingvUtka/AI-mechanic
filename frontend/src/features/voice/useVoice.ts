import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../../lib/api";

export type Command =
  | { type: "next" | "back" | "done" | "repeat" | "result" | "ticket" | "confirm" | "stop" }
  | { type: "number"; value: string; done: boolean };

// Short phrases in ru / uz (Latin) / ko. Anything else goes to the agent as a question.
const COMMANDS: [Command["type"], RegExp][] = [
  ["stop", /^(стоп|хватит|замолчи|to.?xta|bas|멈춰|그만)/i],
  ["confirm", /(подтвержда|tasdiqla|확인합니다|승인)/i],
  ["ticket", /(заявк|ariza|신청서|요청서)/i],
  ["result", /^(получи(ть)? )?(результат|диагностик|natija|tashxis|결과|진단)/i],
  ["repeat", /^(повтор|ещё раз|еще раз|takrorla|qayta ayt|다시)/i],
  ["back", /^(назад|предыдущ|orqaga|oldingi|이전|뒤로)/i],
  ["done", /^(готово|сделал|сделано|выполнил|tayyor|bajarildi|qildim|bo.?ldi|완료|다 했|됐어)/i],
  ["next", /^(дальше|далее|следующ|keyingi|davom|다음)/i],
];

export function parseCommand(text: string): Command | null {
  const s = text.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  const num = s.match(/-?\d+(?:[.,]\d+)?/);
  // a short phrase with a number ("4,5", "давление 4,5 готово") is a measured value
  if (num && s.split(/\s+/).length <= 4) {
    return { type: "number", value: num[0].replace(",", "."), done: /(готово|tayyor|완료)/i.test(s) };
  }
  if (s.split(/\s+/).length > 4) return null;  // long phrases are questions
  const hit = COMMANDS.find(([, re]) => re.test(s));
  return hit ? ({ type: hit[0] } as Command) : null;
}

/** Recorded audio (webm/ogg) -> 16 kHz mono WAV, base64 — the format the recogniser accepts. */
async function toWavBase64(blob: Blob): Promise<string> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const buf = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, "data"); buf.setUint32(40, pcm.length * 2, true);
  pcm.forEach((v, i) => buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  let binary = "";
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const SILENCE_MS = 1300, START_MS = 150, MAX_MS = 20000;
export type VoiceStatus = "off" | "idle" | "recording" | "recognising" | "speaking";

/**
 * Microphone with voice-activity detection. Push-to-talk: listen() records one phrase and stops on
 * silence. Hands-free: keeps listening phrase after phrase; pauses while the app is speaking so it
 * does not hear itself. Every recognised phrase goes to onText.
 */
export function useVoice(lang: string, onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [handsFree, setHandsFree] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const st = useRef({ stream: null as MediaStream | null, ctx: null as AudioContext | null, timer: 0,
    rec: null as MediaRecorder | null, chunks: [] as Blob[], loudSince: 0, quietSince: 0, startedAt: 0,
    floor: 0.01, handsFree: false, once: false, speaking: false, audio: null as HTMLAudioElement | null });
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const langRef = useRef(lang);
  langRef.current = lang;

  const stopRecording = useCallback(() => {
    const s = st.current;
    if (s.rec && s.rec.state === "recording") s.rec.stop();
  }, []);

  const startRecording = useCallback(() => {
    const s = st.current;
    if (!s.stream || (s.rec && s.rec.state === "recording")) return;
    s.chunks = [];
    s.rec = new MediaRecorder(s.stream);
    s.rec.ondataavailable = e => e.data.size && s.chunks.push(e.data);
    s.rec.onstop = async () => {
      const blob = new Blob(s.chunks, { type: s.rec?.mimeType });
      if (Date.now() - s.startedAt < 500) { setStatus(s.handsFree ? "idle" : "off"); return; }
      setStatus("recognising");
      try {
        const audio = await toWavBase64(blob);
        const r = await fetch(apiUrl("/voice/transcribe"), { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio, lang: langRef.current }) });
        if (!r.ok) throw new Error(`STT ${r.status}`);
        const { text } = await r.json();
        if (text?.trim()) onTextRef.current(text.trim());
      } catch (e) { setError((e as Error).message); }
      setStatus(s.handsFree ? "idle" : "off");
      if (!s.handsFree) release();
    };
    s.startedAt = Date.now();
    s.rec.start();
    setStatus("recording");
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  function release() {
    const s = st.current;
    clearInterval(s.timer);
    s.stream?.getTracks().forEach(t => t.stop());
    void s.ctx?.close();
    s.stream = null; s.ctx = null;
    setLevel(0);
  }

  async function open() {
    const s = st.current;
    if (s.stream) return true;
    try {
      s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("mic"); return false;
    }
    s.ctx = new AudioContext();
    const analyser = s.ctx.createAnalyser();
    analyser.fftSize = 1024;
    s.ctx.createMediaStreamSource(s.stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    s.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((a, v) => a + v * v, 0) / data.length);
      setLevel(Math.min(1, rms * 8));
      const now = Date.now();
      const threshold = Math.max(0.015, s.floor * 2.5);  // adapts to the noise of the bay
      const recording = s.rec?.state === "recording";
      if (!recording) s.floor = s.floor * 0.97 + rms * 0.03;
      if (s.speaking) return;
      if (rms > threshold) {
        s.quietSince = 0;
        if (!recording && (s.handsFree || s.once)) {
          s.loudSince ||= now;
          if (now - s.loudSince > START_MS) { s.once = false; startRecording(); }
        }
      } else {
        s.loudSince = 0;
        if (recording) {
          s.quietSince ||= now;
          if (now - s.quietSince > SILENCE_MS) stopRecording();
        }
      }
      if (recording && now - s.startedAt > MAX_MS) stopRecording();
    }, 50);
    return true;
  }

  /** Push-to-talk: one phrase. Pressing again while recording stops it. */
  async function listen() {
    const s = st.current;
    if (s.rec?.state === "recording") { stopRecording(); return; }
    setError("");
    if (!(await open())) return;
    s.once = true;
    setStatus("idle");
  }

  async function toggleHandsFree() {
    const s = st.current;
    if (s.handsFree) {
      s.handsFree = false; setHandsFree(false); stopRecording(); release(); setStatus("off");
      return;
    }
    setError("");
    if (!(await open())) return;
    s.handsFree = true; setHandsFree(true); setStatus("idle");
  }

  /** Reads text aloud: verified server voice, else the browser's voice for this language, else silent. */
  async function speak(text: string): Promise<boolean> {
    const s = st.current;
    stopSpeaking();
    if (!text.trim()) return false;
    s.speaking = true; setStatus("speaking");
    const done = () => { s.speaking = false; setStatus(s.handsFree ? "idle" : s.stream ? "idle" : "off"); };
    try {
      const r = await fetch(apiUrl("/voice/speak"), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 600), lang: langRef.current }) });
      if (r.ok) {
        s.audio = new Audio(URL.createObjectURL(await r.blob()));
        await new Promise<void>(resolve => { s.audio!.onended = () => resolve(); s.audio!.onerror = () => resolve(); void s.audio!.play(); });
        done();
        return true;
      }
    } catch { /* fall through to the browser voice */ }
    const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(langRef.current));
    if (!voice) { done(); return false; }
    await new Promise<void>(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice; u.lang = voice.lang; u.onend = () => resolve(); u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
    done();
    return true;
  }

  function stopSpeaking() {
    const s = st.current;
    s.audio?.pause(); s.audio = null;
    speechSynthesis.cancel();
    s.speaking = false;
  }

  useEffect(() => () => { stopSpeaking(); release(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return { status, handsFree, level, error, listen, toggleHandsFree, speak, stopSpeaking };
}

export type Voice = ReturnType<typeof useVoice>;
