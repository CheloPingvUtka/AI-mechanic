import type { ReactNode } from "react";
export default function MetricCard({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: ReactNode }) {
  return <section className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value}</strong><small>{hint}</small></section>;
}