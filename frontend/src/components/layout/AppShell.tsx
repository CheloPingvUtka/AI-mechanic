import { NavLink } from "react-router-dom";
import { Activity, ClipboardList, Gauge, Languages, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import i18n from "../../i18n";

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const links = [
    { to: "/", label: t("workspace"), icon: Wrench },
    { to: "/tickets", label: t("tickets"), icon: ClipboardList },
    { to: "/fleet", label: t("fleet"), icon: Gauge },
  ];
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={19}/></span><div><strong>НЕЙРОДВС</strong><small>Цифровой механик</small></div></div>
      <div className="nav-caption">РАБОЧИЕ РАЗДЕЛЫ</div>
      <nav>{links.map(({to,label,icon:Icon}) => <NavLink key={to} to={to} end={to === "/"} className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="online-dot"/><span>{t("systemReady")}</span></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="mobile-brand">Цифровой механик</div><div className="topbar-right"><span className="system-state"><span className="online-dot"/>{t("systemReady")}</span><Languages size={17}/><select aria-label="Язык интерфейса" value={i18n.language} onChange={e => void i18n.changeLanguage(e.target.value)}><option value="ru">RU</option><option value="uz">UZ</option><option value="hi">HI</option></select><div className="user-chip">М</div></div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}