import type { DiagnosisResult, RepairPlan, Vehicle } from "../types/domain";

export const vehicles: Vehicle[] = [
  { vehicle_id: "M333YK47", plate: "М333УК 47", brand: "КАМАЗ", model: "65115", engine: "ЯМЗ-536", mileage_km: 284300, year: 2021 },
  { vehicle_id: "V821RT25", plate: "В821РТ 25", brand: "УАЗ", model: "Профи", engine: "ЗМЗ-40905.10", mileage_km: 126400, year: 2020 },
  { vehicle_id: "K104AA27", plate: "К104АА 27", brand: "ПАЗ", model: "3205", engine: "ЗМЗ-5234.10", mileage_km: 198700, year: 2019 },
  { vehicle_id: "A123BC125", plate: "А123ВС 125", brand: "КАМАЗ", model: "65115", engine: "ЯМЗ-536", mileage_km: 284300, year: 2021 },
];

export const mockDiagnosis: DiagnosisResult = {
  vehicle_id: "M333YK47", session_id: "S-0005", status: "anomaly", anomaly_type: "F08",
  anomaly_title: "Дизельная топливоподача", anomaly_score: 0.76, confidence: 0.73,
  signal_quality: "good", description: "Жёсткая работа с резким стуком в цилиндрах, дымный выхлоп",
  model_version: "mock-v1",
};

// These are visibly marked demo values, not extracted from factory manuals.
export const mockRepairPlan: RepairPlan = {
  conclusion: "Есть подозрение на неисправность системы дизельной топливоподачи. Требуется дефектовка.",
  risk: "До проверки не рекомендуется выпускать автомобиль в рейс. Окончательное решение принимает специалист.",
  operations: ["Проверить фильтры и топливопроводы", "Проверить герметичность соединений", "Проверить форсунки и топливный насос"],
  spare_parts: [],
  references: [{ manual: "ДЕМО-ИСТОЧНИК — заменить ответом RAG", pdf_page: 1 }],
  confidence_note: "Демонстрационный ответ. Не использовать как техническую инструкцию.",
};

export const fleetHistory = [
  { date: "12.11", score: 0.28 }, { date: "14.11", score: 0.36 },
  { date: "16.11", score: 0.43 }, { date: "18.11", score: 0.61 },
  { date: "20.11", score: 0.76 },
];