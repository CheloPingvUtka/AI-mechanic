import { useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Gauge, ShieldAlert, Truck } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import MetricCard from "../../components/ui/MetricCard";
import { fleetHistory, vehicles } from "../../data/mock";

export default function FleetPage() {
  const [selected, setSelected] = useState(vehicles[0].vehicle_id);
  const current = vehicles.find(v => v.vehicle_id === selected)!;
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">УПРАВЛЕНИЕ ПАРКОМ</p><h1>Состояние автопарка</h1><p className="muted">Сводка проверок и список транспортных средств, требующих внимания</p></div><span className="badge info">50 ТС · демоданные</span></div>
    <div className="metrics-grid">
      <MetricCard label="Всего автомобилей" value="50" hint="В парке" icon={<Truck size={18}/>}/>
      <MetricCard label="Готовы к работе" value="38" hint="Можно эксплуатировать" icon={<CheckCircle2 size={18}/>}/>
      <MetricCard label="Требуют внимания" value="9" hint="Нужен контроль" icon={<AlertTriangle size={18}/>}/>
      <MetricCard label="В карантине" value="3" hint="Не выпускать на линию" icon={<ShieldAlert size={18}/>}/>
    </div>
    <div className="fleet-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Приоритетные автомобили</h2><p className="muted">Сначала — машины с наибольшим риском</p></div><button className="icon-button"><ArrowUpRight size={18}/></button></div>
        <div className="vehicle-list">{vehicles.map((v,i)=><button className={`vehicle-row ${selected===v.vehicle_id?"selected":""}`} key={v.vehicle_id} onClick={()=>setSelected(v.vehicle_id)}><div className="vehicle-icon"><Truck size={18}/></div><div className="vehicle-row-main"><b>{v.plate}</b><small>{v.brand} {v.model} · {v.engine}</small></div><span className={`badge ${i===0?"danger":i===1?"warning":"success"}`}>{i===0?"Карантин":i===1?"Внимание":"Норма"}</span></button>)}</div>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Динамика аномалии</h2><p className="muted">{current.plate} · последние 5 проверок</p></div><Gauge size={19}/></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={fleetHistory}><CartesianGrid strokeDasharray="3 3" stroke="#e7ebef"/><XAxis dataKey="date" tickLine={false} axisLine={false}/><YAxis domain={[0,1]} tickLine={false} axisLine={false}/><Tooltip/><Line type="monotone" dataKey="score" stroke="#e68135" strokeWidth={3} dot={{r:4}}/></LineChart></ResponsiveContainer></div><div className="trend-note"><AlertTriangle size={16}/> Показатель растёт. Рекомендуется проверить историю и оформить дефектовку.</div></section>
    </div>
  </div>;
}