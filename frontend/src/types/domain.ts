export type DiagnosisStatus = "normal" | "anomaly" | "check_failed";
export type Urgency = "low" | "medium" | "high";
export type FleetState = "normal" | "attention" | "quarantine";

export interface Diagnosis {
  vehicle_id: string;
  session_id: string;
  status: DiagnosisStatus;
  anomaly_type: string | null;
  anomaly_title: string | null;
  anomaly_score: number | null;
  confidence: number | null;
  signal_quality: "good" | "warning" | "bad";
  description: string;
  model_version: string;
}

/** POST /diagnostics: the check plus what the backend rules conclude from it. */
export interface Assessment extends Diagnosis {
  confidence_threshold: number;
  ticket_blocked_reason: string | null;
  needs_warning_confirmation: boolean;
  urgency: { level: Urgency; meaning: string } | null;
}

export interface Session extends Diagnosis {
  checked_at: string;
}

export interface FleetVehicle {
  vehicle_id: string;
  garage_no: string;
  make: string;
  model: string | null;
  vehicle_type: string;
  engine_model: string;
  fuel: string;
  sessions: Session[];
  state: FleetState;
  urgency: Urgency | null;
  reason: string;
}

export interface Source {
  manual_id: string;
  manual: string;
  pdf_page: number;
  excerpt: string;
  ocr: boolean;
  figures: number;
}

export interface Manual {
  id: string;
  title: string;
  short: string;
  engines: string[];
  official_url: string | null;
}

export interface Ticket {
  ticket_id: string;
  vehicle_id: string;
  session_id: string;
  anomaly_type: string;
  conclusion: string;
  urgency: Urgency;
  operations: string[];
  spare_parts: string[];
  references: { manual: string; pdf_page: number }[];
  operation_ban: { manual: string; pdf_page: number; quote: string } | null;
}

export interface ChatReply {
  conversation_id: string;
  answer: string;
  sources: Source[];
  ticket: Ticket | null;
  cost_usd: number;
}

/** Live progress from /assistant/chat/stream. */
export type AgentEvent =
  | { type: "thinking" | "checking" }
  | { type: "fixing"; problems: string[] }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; error?: string; found?: { manual: string; pdf_page: number }[];
      ticket_id?: string; status?: string; session_id?: string };

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  sources?: Source[];
  cost?: number;
  error?: boolean;
  events?: AgentEvent[];
  images?: string[];
}
