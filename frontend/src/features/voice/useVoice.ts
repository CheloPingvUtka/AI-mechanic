import { useCallback, useEffect, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";
// Silero VAD runs in the browser (onnxruntime wasm). Its files are served by us, never from a CDN;
// vite.config.ts keeps the model and the worklet side by side under vad/ in the build.
import workletUrl from "@ricky0123/vad-web/dist/vad.worklet.bundle.min.js?url";
import modelUrl from "@ricky0123/vad-web/dist/silero_vad_v6.onnx?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
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

// What the app says while the agent works, so the mechanic knows it heard him and is busy.
const FILLERS: Record<string, { start: string[]; wait: string[] }> = {
  ru: { start: ["Думаю.", "Минутку.", "Сейчас посмотрю.", "Секунду, ищу в руководстве."],
        wait: ["Ещё чуть-чуть.", "Почти готово.", "Ещё ищу, подождите.", "Сверяю с руководством."] },
  uz: { start: ["O‘ylayapman.", "Bir daqiqa.", "Hozir qarayman.", "Bir soniya, qo‘llanmadan qidiryapman."],
        wait: ["Yana biroz.", "Deyarli tayyor.", "Hali qidiryapman, kuting.", "Qo‘llanma bilan solishtiryapman."] },
  ko: { start: ["생각하고 있어요.", "잠깐만요.", "지금 찾아볼게요.", "잠시만요, 설명서를 찾고 있어요."],
        wait: ["조금만 더요.", "거의 다 됐어요.", "아직 찾고 있어요, 기다려 주세요.", "설명서와 맞춰 보고 있어요."] },
};
const FIRST_FILLER_MS = 700, NEXT_FILLER_MS = 9000;

/** 16 kHz mono samples -> WAV, base64: the format the recogniser accepts. */
function wavBase64(pcm: Float32Array, rate = 16000): string {
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

const MAX_MS = 20000;
const dir = (url: string) => url.slice(0, url.lastIndexOf("/") + 1);
// Tuned for a loud repair bay: the model must be sure it is a voice (default 0.3), engine and tool
// noise is not; a phrase ends after ~0.9 s without voice; bangs shorter than 0.35 s are dropped.
const VAD_TUNING = { positiveSpeechThreshold: 0.6, negativeSpeechThreshold: 0.45, redemptionMs: 900,
  preSpeechPadMs: 400, minSpeechMs: 350, submitUserSpeechOnPause: true };

export type VoiceStatus = "off" | "idle" | "recording" | "recognising" | "speaking";

/**
 * Microphone with neural voice-activity detection (Silero VAD). Push-to-talk: listen() takes one phrase.
 * Hands-free: keeps listening phrase after phrase; what is heard while the app itself speaks is dropped.
 * Every recognised phrase goes to onText.
 */
export function useVoice(lang: string, onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [handsFree, setHandsFree] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const st = useRef({ vad: null as MicVAD | null, loading: null as Promise<MicVAD | null> | null, listening: false,
    handsFree: false, speaking: false, heardWhileSpeaking: false, maxTimer: 0,
    audio: null as HTMLAudioElement | null, waiting: false, fillerTimer: 0, lastFiller: "", fillerPlaying: false,
    fillers: new Map<string, string>() });
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const langRef = useRef(lang);
  langRef.current = lang;
  const idle = () => setStatus(st.current.listening ? "idle" : "off");

  async function recognise(pcm: Float32Array) {
    setStatus("recognising");
    try {
      const r = await fetch(apiUrl("/voice/transcribe"), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: wavBase64(pcm), lang: langRef.current }) });
      if (!r.ok) throw new Error(`STT ${r.status}`);
      const { text } = await r.json();
      if (text?.trim()) onTextRef.current(text.trim());
    } catch (e) { setError((e as Error).message); }
    idle();
  }

  /** The detector, created once (model and wasm load on first use); null if it cannot run. */
  function detector(): Promise<MicVAD | null> {
    const s = st.current;
    s.loading ??= MicVAD.new({
      model: "v6", ...VAD_TUNING, startOnLoad: false,
      baseAssetPath: dir(workletUrl), onnxWASMBasePath: dir(ortWasmUrl),
      ortConfig: ort => { ort.env.logLevel = "error"; ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl }; },
      getStream: () => navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      onFrameProcessed: p => setLevel(l => Math.abs(l - p.isSpeech) > 0.05 ? p.isSpeech : l),
      onSpeechStart: () => {
        s.heardWhileSpeaking = s.speaking;
        if (s.speaking) return;
        setStatus("recording");
        clearTimeout(s.maxTimer);  // a phrase never runs longer than MAX_MS
        s.maxTimer = window.setTimeout(() => { void s.vad?.pause().then(() => { if (s.listening) void s.vad?.start(); }); }, MAX_MS);
      },
      onVADMisfire: () => { clearTimeout(s.maxTimer); if (!s.speaking) idle(); },
      onSpeechEnd: pcm => {
        clearTimeout(s.maxTimer);
        if (s.heardWhileSpeaking || s.speaking) return;  // the app hearing itself
        if (!s.handsFree) stop();
        void recognise(pcm);
      },
    }).then(vad => {
      if (dir(modelUrl) !== dir(workletUrl)) console.warn("VAD: model and worklet must be in one folder");
      s.vad = vad;
      return vad;
    }).catch(e => {
      s.loading = null;
      setError(String(e).includes("Permission") || String(e).includes("NotAllowed") ? "mic" : `VAD: ${(e as Error).message ?? e}`);
      return null;
    });
    return s.loading;
  }

  async function start(): Promise<boolean> {
    const s = st.current;
    setError("");
    const vad = await detector();
    if (!vad) return false;
    try {
      await vad.start();
    } catch {
      setError("mic"); return false;
    }
    s.listening = true;
    setStatus(s.speaking ? "speaking" : "idle");
    return true;
  }

  const stop = useCallback(() => {
    const s = st.current;
    s.listening = false;
    clearTimeout(s.maxTimer);
    s.vad?.pause().catch(() => {});  // releases the microphone
    setLevel(0);
  }, []);

  /** Push-to-talk: one phrase. Pressing again while listening stops (what was said so far is sent). */
  async function listen() {
    const s = st.current;
    if (s.listening && !s.handsFree) { stop(); idle(); return; }
    if (!s.listening) await start();
  }

  async function toggleHandsFree() {
    const s = st.current;
    if (s.handsFree) {
      s.handsFree = false; setHandsFree(false); stop(); setStatus("off");
      return;
    }
    if (s.listening || await start()) { s.handsFree = true; setHandsFree(true); }
  }

  async function ttsUrl(text: string): Promise<string | null> {
    const r = await fetch(apiUrl("/voice/speak"), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 600), lang: langRef.current }) });
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  }

  async function play(url: string) {
    const s = st.current;
    const audio = s.audio = new Audio(url);
    s.speaking = true; setStatus("speaking");
    await new Promise<void>(resolve => {
      audio.onended = audio.onerror = audio.onpause = () => resolve();
      void audio.play().catch(() => resolve());
    });
    if (s.audio === audio) { s.audio = null; s.speaking = false; idle(); }  // not replaced by a newer one
  }

  /** Reads text aloud: verified server voice, else the browser's voice for this language, else silent. */
  async function speak(text: string): Promise<boolean> {
    const s = st.current;
    stopSpeaking();
    if (!text.trim()) return false;
    s.speaking = true; setStatus("speaking");
    try {
      const url = await ttsUrl(text);
      if (url) { await play(url); URL.revokeObjectURL(url); return true; }
    } catch { /* fall through to the browser voice */ }
    const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(langRef.current));
    if (voice) await new Promise<void>(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice; u.lang = voice.lang; u.onend = () => resolve(); u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
    s.speaking = false; idle();
    return !!voice;
  }

  function stopSpeaking() {
    const s = st.current;
    s.audio?.pause(); s.audio = null;
    speechSynthesis.cancel();
    s.speaking = false;
  }

  /** Fetches the filler phrases of this language once (the server keeps them too), so they play at once. */
  async function warmUp() {
    const s = st.current;
    const set = FILLERS[langRef.current] ?? FILLERS.ru;
    for (const text of [...set.start, ...set.wait]) {
      const key = langRef.current + text;
      if (s.fillers.has(key)) continue;
      const url = await ttsUrl(text).catch(() => null);
      if (url) s.fillers.set(key, url);
    }
  }

  async function filler(kind: "start" | "wait") {
    const s = st.current;
    const set = (FILLERS[langRef.current] ?? FILLERS.ru)[kind];
    const options = set.filter(x => x !== s.lastFiller);
    const text = options[Math.floor(Math.random() * options.length)];
    const url = s.fillers.get(langRef.current + text);
    if (!url || !s.waiting || s.speaking) return;  // not fetched yet: stay silent rather than wait for it
    s.lastFiller = text;
    s.fillerPlaying = true;
    await play(url);
    s.fillerPlaying = false;
  }

  /** While the agent works: "Думаю…" right away, then now and then "Ещё чуть-чуть…". The answer itself stops it. */
  function waiting(on: boolean) {
    const s = st.current;
    if (on === s.waiting) return;
    s.waiting = on;
    clearTimeout(s.fillerTimer);
    if (!on) { if (s.fillerPlaying) stopSpeaking(); return; }
    const next = (kind: "start" | "wait", ms: number) => {
      s.fillerTimer = window.setTimeout(() => { void filler(kind).then(() => { if (s.waiting) next("wait", NEXT_FILLER_MS); }); }, ms);
    };
    next("start", FIRST_FILLER_MS);
  }

  useEffect(() => () => {
    const s = st.current;
    stopSpeaking();
    clearTimeout(s.fillerTimer);
    s.vad?.destroy().catch(() => {});  // never started: nothing to release
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return { status, handsFree, level, error, listen, toggleHandsFree, speak, stopSpeaking, warmUp, waiting };
}

export type Voice = ReturnType<typeof useVoice>;
