export type DiagnosisStatus = "normal" | "anomaly" | "check_failed";
export type Urgency = "low" | "medium" | "high";

export interface Vehicle {
  vehicle_id: string;
  plate: string;
  brand: string;
  model: string;
  engine: string;
  mileage_km: number;
  year: number;
}

export interface DiagnosisResult {
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

export interface SourceReference {
  manual: string;
  pdf_page: number;
}

export interface RepairPlan {
  conclusion: string;
  risk: string;
  operations: string[];
  spare_parts: string[];
  references: SourceReference[];
  confidence_note?: string;
}

export interface TicketPayload {
  vehicle_id: string;
  session_id: string;
  anomaly_type: string;
  conclusion: string;
  urgency: Urgency;
  operations: string[];
  spare_parts: string[];
  references: SourceReference[];
}

export interface TicketResponse {
  ticket_id: string;
  status: "created";
}

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  references?: SourceReference[];
}