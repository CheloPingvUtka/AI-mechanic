import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

export function trend(sessions: Session[]): string {
  const scores = sessions.filter(s => s.status !== "check_failed").map(s => s.anomaly_score ?? 0);
  if (scores.length < 2) return "Мало проверок для оценки динамики.";
  const delta = scores[scores.length - 1] - scores[0];
  if (delta > 0.15) return `Показатель растёт: ${scores[0]} → ${scores[scores.length - 1]} (проверок: ${scores.length}).`;
  if (delta < -0.15) return `Показатель снижается: ${scores[0]} → ${scores[scores.length - 1]}.`;
  return "Показатель без выраженной динамики.";
}
