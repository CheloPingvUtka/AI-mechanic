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
  block_code: "bad_recording" | "no_anomaly" | "no_fault_code" | "low_confidence" | "fuel_mismatch" | "needs_confirmation" | null;
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
  code: string;
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
  official_note: string | null;
}

export interface PlanItem {
  id: number;
  text: string;
  preliminary: boolean;
  ref: string | null;
  quote: string | null;
  manual_id: string | null;
  manual: string | null;
  pdf_page: number | null;
  figures: number;
  figure?: number | null;       // the drawing the model chose for this step (on figure_page); null = none fits
  figure_page?: number | null;
  added_at?: number;  // unix seconds, when the agent added it
  measure: { name: string; unit: string; min: number | null; max: number | null } | null;
}

/** A drawing the model picked for a list item of an answer, by stepKey of the item. */
export interface FigurePick { manual_id: string; manual: string; pdf_page: number; figure: number }

export interface WorkPlan {
  tools: PlanItem[];
  materials: PlanItem[];
  safety: PlanItem[];
  steps: PlanItem[];
  // newer plans only; older snapshots lack them
  disassembly?: PlanItem[];  // what to remove before the work
  prep?: PlanItem[];         // vehicle and workplace preparation, in order
  quality?: PlanItem[];      // checklist after the repair
  aftercare?: PlanItem[];    // what to watch after the repair
  conflicts?: Conflict[];    // manuals disagree
  status: "building" | "ready" | "failed";
  note: string;
  version: number;
}

/** Two manuals say different things: both quotes and where to ask the manufacturer. */
export interface Conflict {
  note: string;
  sides: { manual_id: string; manual: string; pdf_page: number; quote: string }[];
  official: { manual: string; url: string }[];
  severity?: "critical" | "minor";  // minor: the same norm rounded or in other units
  recommendation?: string;  // which side to keep to and why: the AI's opinion, not the manual
}

export type Stage = "prep" | "work" | "check" | "after";

export interface WorkProgress {
  steps: Record<string, { done: boolean; value: string }>;
  checks: Record<string, boolean>;
  stage: Stage | null;
}

/** GET /work?status=active: unfinished repairs. */
export interface WorkSummary {
  id: string;
  vehicle_id: string;
  session_id: string;
  status: "active" | "done";
  diagnosis: Diagnosis | null;
  steps_total: number;
  steps_done: number;
  stage: Stage | null;
  updated_at: number;
}

/** GET /work/{id}: everything to resume a repair. */
export interface WorkSnapshot {
  work_id: string;
  vehicle_id: string;
  session_id: string;
  status: "active" | "done";
  plan: WorkPlan | null;
  progress: WorkProgress | null;
  chat: { role: "user" | "assistant"; text: string; sources?: Source[]; ticket?: Ticket | null; cost?: number; figures?: Record<string, FigurePick>;
    contradictions?: Conflict[] }[];
}

export type BookKind = "diagnosis" | "recheck" | "ticket" | "defect" | "repair" | "recommendation" | "note";

export interface BookEntry {
  id: number | null;  // null for checks taken from the fleet history
  vehicle_id: string;
  work_id: string | null;
  session_id: string | null;
  created_at: number;  // unix seconds
  kind: BookKind;
  title: string;
  text: string;
  data: Record<string, unknown> | null;
  photos: number[];
}

export interface Book {
  vehicle: Pick<FleetVehicle, "vehicle_id" | "garage_no" | "make" | "model" | "vehicle_type" | "engine_model" | "fuel">;
  entries: BookEntry[];
}

export interface Dispute {
  id: number;
  vehicle_id: string;
  work_id: string | null;
  created_at: number;
  kind: "contradiction" | "unverified_numbers" | "ticket_rejected" | "low_confidence" | "fuel_mismatch" | "photo_mismatch" | string;
  detail: string;
  data?: Record<string, unknown> | null;
  resolved: boolean;
  session_id?: string | null;   // the check it came from (through its work)
  work_status?: "active" | "done" | "chat" | null;  // active/done: a repair with a plan; chat: a conversation only
}

export interface PhotoCheck {
  shows: string;
  matches: "yes" | "no" | "unclear";
  reason: string;
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
  photo_check?: PhotoCheck | null;
  contradictions?: Conflict[];
  figures?: Record<string, FigurePick>;
}

/** Live progress from /assistant/chat/stream. */
export type AgentEvent = (
  | { type: "thinking" | "checking" | "figures" | "ping" }
  | { type: "fixing"; problems: string[] }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; error?: string; found?: { manual_id?: string; manual: string; pdf_page: number }[];
      ticket_id?: string; status?: string; session_id?: string }
  | { type: "tokens"; up: number; down: number; reasoning: number }  // whole request so far; down includes reasoning
  | { type: "figures_look"; id: string; manual_id: string; manual: string; pages: number[]; count: number; steps: number; second: boolean }
  | { type: "figures_seen"; id: string; picked: number }
) & { at?: number };  // when it arrived (ms), set by pushEvent

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  sources?: Source[];
  cost?: number;
  error?: boolean;
  events?: AgentEvent[];
  images?: string[];
  photoCheck?: PhotoCheck | null;
  contradictions?: Conflict[];
  figures?: Record<string, FigurePick>;
}
