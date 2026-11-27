import { useEffect, useState } from "react";
import type { AgentEvent, Assessment, ChatReply, FleetVehicle, Manual, Ticket } from "../types/domain";

// Dev: Vite proxies /api to the backend (vite.config.ts), so a phone on the same Wi-Fi works too.
const base = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/$/, "");
export const apiUrl = (path: string) => base + path;

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(base + path, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : `Ошибка сервера ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  fleet: () => request<FleetVehicle[]>("/fleet"),
  tickets: () => request<Ticket[]>("/tickets"),
  manuals: () => request<Manual[]>("/manuals"),
  diagnose: (vehicle_id: string, session_id: string) =>
    request<Assessment>("/diagnostics", { vehicle_id, session_id }),
};

export interface ChatBody {
  vehicle_id: string;
  session_id: string;
  message: string;
  conversation_id: string | null;
  confirm_warning: boolean;
  images?: string[];
}

/** Agent reply over Server-Sent Events: onEvent gets live progress, the promise resolves with the answer. */
export async function chatStream(body: ChatBody, onEvent: (e: AgentEvent) => void): Promise<ChatReply> {
  const response = await fetch(base + "/assistant/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw new Error(`Ошибка сервера ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Соединение с агентом прервалось");
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!chunk.startsWith("data: ")) continue;
      const event = JSON.parse(chunk.slice(6));
      if (event.type === "done") return event.response as ChatReply;
      if (event.type === "error") throw new Error(event.detail);
      onEvent(event as AgentEvent);
    }
  }
}

export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    load().then(setData).catch((e: Error) => setError(e.message));
  }, [load]);
  return { data, error };
}

export const URGENCY_LABEL = { high: "Высокий", medium: "Средний", low: "Низкий" } as const;
export const STATE_LABEL = { quarantine: "Карантин", attention: "Внимание", normal: "Норма" } as const;
export const STATE_BADGE = { quarantine: "danger", attention: "warning", normal: "success" } as const;

export function vehicleName(v: FleetVehicle) {
  return v.model?.startsWith(v.make) ? v.model : [v.make, v.model].filter(Boolean).join(" ");
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Phone photos are several MB: shrink to <= max px JPEG before sending to the agent. */
export function shrinkPhoto(file: File, max = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("Не удалось открыть фото"));
    img.src = URL.createObjectURL(file);
  });
}
