import { useEffect, useState } from "react";
import type { Assessment, ChatReply, FleetVehicle, Ticket } from "../types/domain";

// Dev: Vite proxies /api to the backend (vite.config.ts), so a phone on the same Wi-Fi works too.
const base = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/$/, "");

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
  diagnose: (vehicle_id: string, session_id: string) =>
    request<Assessment>("/diagnostics", { vehicle_id, session_id }),
  chat: (body: {
    vehicle_id: string;
    session_id: string;
    message: string;
    conversation_id: string | null;
    confirm_warning: boolean;
  }) => request<ChatReply>("/assistant/chat", body),
};

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
