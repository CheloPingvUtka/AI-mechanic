import type { ChatMessage } from "../../types/domain";
import { useMocks } from "./http";

const baseUrl = import.meta.env.VITE_AGENT_API_URL || "http://localhost:8002";

export async function askAssistant(question: string, vehicleId: string): Promise<ChatMessage> {
  if (useMocks) {
    return {
      id: crypto.randomUUID(), role: "assistant",
      text: "Это демонстрационный ответ. После подключения backend здесь появится ответ агента, найденные проверки и ссылки на руководство именно для двигателя выбранного ТС. Не используйте этот текст как техническую рекомендацию.",
    };
  }
  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question, vehicle_id: vehicleId }),
  });
  if (!response.ok) throw new Error(`Agent API ${response.status}`);
  const data = await response.json() as { answer: string; references?: ChatMessage["references"] };
  return { id: crypto.randomUUID(), role: "assistant", text: data.answer, references: data.references };
}