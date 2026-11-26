import type { TicketPayload, TicketResponse } from "../../types/domain";
import { postJson, useMocks } from "./http";

const baseUrl = import.meta.env.VITE_TOR_API_URL || "http://localhost:8003";

export async function createTicket(payload: TicketPayload): Promise<TicketResponse> {
  if (useMocks) return { ticket_id: `TKT-${Math.floor(1000 + Math.random() * 9000)}`, status: "created" };
  return postJson<TicketResponse>(baseUrl, "/tickets", payload);
}