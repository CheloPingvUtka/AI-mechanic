import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardPlus, ListTree, RotateCcw, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Assessment, Session } from "../../types/domain";
import StatusBadge from "../../components/ui/StatusBadge";
import { formatDate } from "../../lib/api";

export const FAULT_TITLES: Record<string, string> = {
  F01: "Клапанный механизм", F02: "Низкое давление масла", F03: "Перегрев, охлаждающая жидкость в масле",
  F04: "Ремённый привод агрегатов", F05: "Генератор", F06: "Сцепление", F07: "Коробка передач",
  F08: "Дизельная топливоподача", F09: "Турбокомпрессор, наддув", F10: "Компрессор пневмотормозов, насос ГУР",
  F11: "Рециркуляция отработавших газов", F12: "Зажигание", F13: "Подача бензина", F14: "Цепь ГРМ, гидронатяжитель",
};

export const faultTitle = (t: TFunction, code: string | null, fallback?: string | null) =>
  code ? t(`fault.${code}`, FAULT_TITLES[code] ?? fallback ?? code) : fallback ?? "";

export const urgencyLabel = (t: TFunction, level: string) =>
  ({ high: t("urgency.high", "Высокий"), medium: t("urgency.medium", "Средний"), low: t("urgency.low", "Низкий") }[level] ?? level);

export const urgencyMeaning = (t: TFunction, level: string) => ({
  high: t("urgency.high_meaning", "машина ставится на дефектовку до выпуска в рейс"),
  medium: t("urgency.medium_meaning", "дефектовка на ближайшем ТО, машина работает под наблюдением"),
  low: t("urgency.low_meaning", "машина работает, узел проверяется на следующей проверке"),
}[level] ?? "");

const fuelName = (t: TFunction, fuel: string) =>
  fuel === "дизель" ? t("fuel.diesel", "дизель") : fuel === "бензин" ? t("fuel.petrol", "бензин") : fuel;

/** One short sentence about the result: shown big in the wizard and read aloud. */
export function verdictLine(t: TFunction, r: Assessment): string {
  if (r.block_code === "bad_recording") return t("verdict.bad", "Проверка не состоялась. Повторите запись.");
  if (r.status === "normal") return t("verdict.normal", "Норма. Значимых отклонений нет.");
  const pct = Math.round((r.confidence ?? 0) * 100);
  let line = t("verdict.anomaly", "Отклонение: {{title}}. Уверенность {{pct}} процентов.", { title: faultTitle(t, r.anomaly_type, r.anomaly_title), pct });
  if (r.block_code === "low_confidence") line += " " + t("verdict.lowConf", "Это ниже порога — нужна повторная проверка.");
  else if (r.block_code === "fuel_mismatch") line += " " + t("verdict.mismatch", "Такой неисправности у этого двигателя быть не может — повторите запись.");
  else if (r.urgency) line += " " + t("verdict.priority", "Приоритет {{level}}: {{meaning}}.", { level: urgencyLabel(t, r.urgency.level).toLowerCase(), meaning: urgencyMeaning(t, r.urgency.level) });
  if (r.signal_quality === "warning") line += " " + t("verdict.noisy", "Запись с помехами.");
  return line;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);

/** Everything the check said, in numbers, for whoever wants it; folded, so the mechanic is not buried in it. */
function CheckDetails({ result, history }: { result: Assessment; history?: Session[] }) {
  const { t } = useTranslation();
  const date = history?.find(x => x.session_id === result.session_id)?.checked_at;
  const quality = { good: t("details.qGood", "чистая"), warning: t("details.qWarning", "с помехами"), bad: t("details.qBad", "не годится") }[result.signal_quality];
  const rows: [string, string][] = [
    [t("details.check", "Проверка"), `${result.session_id}${date ? ` · ${formatDate(date)}` : ""}`],
    [t("details.status", "Итог"), t(result.status)],
    ...(result.anomaly_type ? [[t("details.fault", "Неисправность"), `${result.anomaly_type} · ${faultTitle(t, result.anomaly_type, result.anomaly_title)}`] as [string, string]] : []),
    [t("details.score", "Отклонение звука от нормы"), pct(result.anomaly_score)],
    [t("details.confidence", "Уверенность модели"), `${pct(result.confidence)} (${t("details.threshold", "порог")} ${pct(result.confidence_threshold)})`],
    [t("details.quality", "Запись"), quality],
    ...(result.urgency ? [[t("result.priority", "Приоритет"), `${urgencyLabel(t, result.urgency.level)} — ${urgencyMeaning(t, result.urgency.level)}`] as [string, string]] : []),
    [t("details.ticket", "Заявка"), result.ticket_blocked_reason ?? t("details.ticketOk", "можно создать")],
    [t("details.model", "Версия модели"), result.model_version],
  ];
  return <details className="check-details">
    <summary><ListTree size={18}/>{t("details.title", "Подробности проверки")}<ChevronDown size={16}/></summary>
    <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
  </details>;
}

/** Verdict card: status, fault, confidence, priority, and why a ticket is or is not possible. */
export default function ResultCard({ result, busy, hasTicket, vehicleFuel, onTicket, big = false, history }: {
  result: Assessment; busy: boolean; hasTicket: boolean; vehicleFuel: string;
  onTicket: (confirmWarning: boolean) => void; big?: boolean; history?: Session[];
}) {
  const { t } = useTranslation();
  const code = result.block_code;
  return <section className={`panel result-panel ${big ? "result-big" : ""}`}>
    <div className="panel-heading">
      <div><p className="eyebrow">{t("result.eyebrow", "РЕЗУЛЬТАТ ПРОВЕРКИ")} · {result.session_id}</p><h2>{t("result.title", "Заключение по двигателю")}</h2></div>
      <StatusBadge status={result.status}/>
    </div>
    {code === "bad_recording" ? <div className="notice warning-notice"><RotateCcw/><div>
        <b>{t("result.badTitle", "Проверка не состоялась — повторите запись")}</b>
        <p>{t("result.badText", "Выводов о состоянии двигателя нет. Проверьте установку стенда и посторонний шум, запишите снова.")}</p></div></div>
    : result.status === "normal" ? <div className="notice success-notice"><CheckCircle2/><div>
        <b>{t("result.normalTitle", "Значимых отклонений не обнаружено")}</b>
        <p>{t("result.normalText", "Эксплуатация продолжается по регламенту.")}</p></div></div>
    : <>
      <div className="anomaly-title">
        <div><span className="eyebrow">{t("result.fault", "ПРЕДПОЛАГАЕМАЯ НЕИСПРАВНОСТЬ")} · {result.anomaly_type}</span>
          <h2>{faultTitle(t, result.anomaly_type, result.anomaly_title)}</h2><p>{result.description}</p></div>
        <div className="confidence"><strong>{Math.round((result.confidence ?? 0) * 100)}%</strong><small>{t("result.confidence", "уверенность")}</small></div>
      </div>
      {result.urgency && !code?.match(/low_confidence|fuel_mismatch/) && <div className={`notice ${result.urgency.level === "high" ? "danger-notice" : "warning-notice"}`}>
        <ShieldAlert/><div><b>{t("result.priority", "Приоритет")}: {urgencyLabel(t, result.urgency.level)}</b>
        <p>{urgencyMeaning(t, result.urgency.level)}. {t("result.recommendation", "Это рекомендация, решение принимает механик.")}</p></div></div>}
      {result.signal_quality === "warning" && <div className="notice warning-notice"><AlertTriangle/><div>
        <b>{t("result.noisyTitle", "Запись с помехами")}</b>
        <p>{t("result.noisyText", "Уверенность модели снижена. Заявку можно создать только после вашего подтверждения.")}</p></div></div>}
      {code === "low_confidence" && <div className="notice warning-notice"><AlertTriangle/><div>
        <b>{t("result.lowTitle", "Уверенность ниже порога {{th}}", { th: result.confidence_threshold.toFixed(2) })}</b>
        <p>{t("result.lowText", "Результат ненадёжен: нужна повторная проверка. Заявка не создаётся.")}</p></div></div>}
      {code === "fuel_mismatch" && <div className="notice warning-notice"><AlertTriangle/><div>
        <b>{t("result.mismatchTitle", "Такой неисправности у этого двигателя быть не может")}</b>
        <p>{t("result.mismatchText", "{{code}} бывает только у других двигателей, а у этой машины {{fuel}}. В руководстве нет инструкции — заявка не создаётся. Вероятна ошибка распознавания: повторите запись.",
          { code: result.anomaly_type, fuel: fuelName(t, vehicleFuel) })}</p></div></div>}
      {!hasTicket && !code && <button className="button button-primary button-large" disabled={busy} onClick={() => onTicket(false)}>
        <ClipboardPlus size={18}/>{t("result.createTicket", "Создать заявку на дефектовку")}</button>}
      {!hasTicket && code === "needs_confirmation" && <button className="button button-primary button-large" disabled={busy} onClick={() => onTicket(true)}>
        <ClipboardCheck size={18}/>{t("result.confirmTicket", "Подтверждаю, создать заявку")}</button>}
    </>}
    <CheckDetails result={result} history={history}/>
  </section>;
}
