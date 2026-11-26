import type { DiagnosisStatus } from "../../types/domain";
import { useTranslation } from "react-i18next";

export default function StatusBadge({ status }: { status: DiagnosisStatus }) {
  const { t } = useTranslation();
  const cls = status === "normal" ? "success" : status === "anomaly" ? "danger" : "warning";
  return <span className={`badge ${cls}`}><span className="badge-dot"/>{t(status)}</span>;
}