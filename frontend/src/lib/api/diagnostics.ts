import { mockDiagnosis } from "../../data/mock";
import type { DiagnosisResult } from "../../types/domain";
import { postJson, useMocks } from "./http";

const baseUrl = import.meta.env.VITE_ML_API_URL || "http://localhost:8001";

export async function getDiagnosis(vehicle_id: string, session_id: string): Promise<DiagnosisResult> {
  if (useMocks) return { ...mockDiagnosis, vehicle_id, session_id };
  return postJson<DiagnosisResult>(baseUrl, "/diagnose", { vehicle_id, session_id });
}