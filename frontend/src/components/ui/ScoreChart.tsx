import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TFunction } from "i18next";
import type { Session } from "../../types/domain";
import { formatDate } from "../../lib/api";

/** anomaly_score over the vehicle's checks; failed recordings leave a gap. */
export default function ScoreChart({ sessions }: { sessions: Session[] }) {
  const data = sessions.map(s => ({
    label: `${formatDate(s.checked_at).slice(0, 5)} · ${s.session_id}`,
    score: s.status === "check_failed" ? null : s.anomaly_score,
  }));
  return <div className="chart-wrap">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7ebef" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={l => l.slice(0, 5)} />
        <YAxis domain={[0, 1]} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
        <ReferenceLine y={0.5} stroke="#e0b25c" strokeDasharray="4 4" />
        <Tooltip formatter={v => [v, "anomaly_score"]} />
        <Line type="linear" dataKey="score" stroke="#e68135" strokeWidth={3} dot={{ r: 4 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

export function trend(sessions: Session[], t: TFunction): string {
  const scores = sessions.filter(s => s.status !== "check_failed").map(s => s.anomaly_score ?? 0);
  if (scores.length < 2) return t("trend.few", "Мало проверок для оценки динамики.");
  const [first, last] = [scores[0], scores[scores.length - 1]];
  if (last - first > 0.15) return t("trend.up", "Показатель растёт: {{a}} → {{b}} (проверок: {{n}}).", { a: first, b: last, n: scores.length });
  if (last - first < -0.15) return t("trend.down", "Показатель снижается: {{a}} → {{b}}.", { a: first, b: last });
  return t("trend.flat", "Показатель без выраженной динамики.");
}
