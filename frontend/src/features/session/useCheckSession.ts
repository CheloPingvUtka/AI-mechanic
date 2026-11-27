import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, chatStream, pushEvent, shrinkPhoto, type ChatBody } from "../../lib/api";
import type { AgentEvent, Assessment, ChatMessage, FleetVehicle, Ticket } from "../../types/domain";

export type Lang = "ru" | "uz" | "ko";
export const currentLang = (l: string): Lang => (l === "uz" || l === "ko" ? l : "ru");

/** Everything about working on one vehicle's check: verdict, background plan, chat with the agent. */
export function useCheckSession(vehicle: FleetVehicle | undefined) {
  const { t, i18n } = useTranslation();
  const lang = currentLang(i18n.language);
  const [sessionId, setSessionId] = useState("");
  const [result, setResult] = useState<Assessment | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [workId, setWorkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [live, setLive] = useState<AgentEvent[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const conversation = useRef<string | null>(null);
  const busyRef = useRef(false);
  const context = useRef<ChatBody["context"]>(null);  // set by the work screen: where the mechanic is

  // New vehicle: latest check selected, everything else starts over.
  useEffect(() => {
    setSessionId(vehicle?.sessions[vehicle.sessions.length - 1].session_id ?? "");
    setResult(null); setTicket(null); setMessages([]); setError(""); setWorkId(null);
    conversation.current = null;
  }, [vehicle?.vehicle_id]);  // eslint-disable-line react-hooks/exhaustive-deps -- a reloaded fleet list is not a new vehicle

  const selectSession = useCallback((id: string) => {
    setSessionId(id); setResult(null); setTicket(null); setWorkId(null);
  }, []);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const shrunk = await Promise.all([...files].slice(0, 4).map(f => shrinkPhoto(f)));
    setPhotos(p => [...p, ...shrunk].slice(0, 4));
  }
  const removePhoto = (i: number) => setPhotos(p => p.filter((_, j) => j !== i));

  /** Sends a message to the agent; resolves with the answer text (empty on error). */
  async function send(text: string, opts: { confirmWarning?: boolean; session?: string } = {}): Promise<string> {
    const images = photos;
    if (!text.trim() && images.length) text = t("photoQuestion", "Что на фото? Это то место, которое надо проверить?");
    if (!vehicle || busyRef.current || !text.trim()) return "";
    busyRef.current = true;
    setPhotos([]);
    setMessages(m => [...m, { id: crypto.randomUUID(), role: "user", text, images }]);
    setBusy(true); setLive([]);
    let events: AgentEvent[] = [];
    try {
      const reply = await chatStream({
        vehicle_id: vehicle.vehicle_id, session_id: opts.session ?? sessionId, message: text, lang,
        conversation_id: conversation.current, confirm_warning: !!opts.confirmWarning, images, context: context.current,
      }, e => { events = pushEvent(events, e); setLive(events); });
      conversation.current = reply.conversation_id;
      if (reply.ticket) setTicket(reply.ticket);
      setMessages(m => [...m, { id: crypto.randomUUID(), role: "assistant", text: reply.answer, sources: reply.sources, cost: reply.cost_usd, events,
        photoCheck: reply.photo_check, contradictions: reply.contradictions, figures: reply.figures }]);
      return reply.answer;
    } catch (e) {
      setMessages(m => [...m, { id: crypto.randomUUID(), role: "assistant", error: true,
        text: `${t("chat.failed", "Агент не ответил")}: ${(e as Error).message}` }]);
      return "";
    } finally { busyRef.current = false; setBusy(false); }
  }

  /** Verdict card right away; for an anomaly the work plan starts in the background; the agent explains. */
  async function runDiagnosis(session = sessionId): Promise<Assessment | null> {
    if (!vehicle) return null;
    setLoading(true); setError(""); setResult(null); setTicket(null); setWorkId(null);
    try {
      const assessment = await api.diagnose(vehicle.vehicle_id, session);
      setResult(assessment);
      if (assessment.status === "anomaly") {
        // Chat shares the plan's conversation, so both see the same manual pages.
        const { work_id } = await api.startWork(vehicle.vehicle_id, session, lang);
        conversation.current = work_id;
        setWorkId(work_id);
        // the same check opened again: its work and chat are reused, nothing is asked twice
        const saved = await api.work(work_id).catch(() => null);
        if (saved?.chat.length) {
          setMessages(saved.chat.map(m => ({ id: crypto.randomUUID(), role: m.role, text: m.text, sources: m.sources, cost: m.cost, figures: m.figures })));
          setTicket([...saved.chat].reverse().find(m => m.ticket)?.ticket ?? null);
          return assessment;
        }
      }
      void send(t("chat.explain", "Объясни результат проверки {{s}}", { s: session }), { session });
      return assessment;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally { setLoading(false); }
  }

  /** Back to a saved repair: its check, verdict and chat; no new plan is built. */
  async function resume(workId: string): Promise<string | null> {
    if (!vehicle) return null;
    setLoading(true); setError("");
    try {
      const w = await api.work(workId);
      conversation.current = w.work_id;
      setSessionId(w.session_id); setWorkId(w.work_id);
      setMessages(w.chat.map(m => ({ id: crypto.randomUUID(), role: m.role, text: m.text, sources: m.sources, cost: m.cost, figures: m.figures })));
      setTicket([...w.chat].reverse().find(m => m.ticket)?.ticket ?? null);
      setResult(await api.diagnose(w.vehicle_id, w.session_id));
      return w.session_id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally { setLoading(false); }
  }

  const createTicket = (confirmWarning = false) =>
    send(t("chat.createTicket", "Создай заявку на дефектовку"), { confirmWarning });

  return {
    lang, sessionId, selectSession, result, ticket, loading, error, workId,
    busy, messages, live, photos, addPhotos, removePhoto, send, runDiagnosis, createTicket, resume, context,
  };
}

export type CheckSession = ReturnType<typeof useCheckSession>;
