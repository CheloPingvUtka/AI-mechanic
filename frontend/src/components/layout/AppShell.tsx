import { NavLink } from "react-router-dom";
import { Activity, ClipboardList, Gauge, Languages, PanelsTopLeft, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { setLanguage } from "../../i18n";

export default function AppShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const links = [
    { to: "/", label: t("nav.work", "Работа"), icon: Wrench },
    { to: "/detail", label: t("nav.detail", "Подробно"), icon: PanelsTopLeft },
    { to: "/tickets", label: t("nav.tickets", "Заявки"), icon: ClipboardList },
    { to: "/fleet", label: t("nav.fleet", "Автопарк"), icon: Gauge },
  ];
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={19}/></span><div><strong>НЕЙРОДВС</strong><small>{t("app.name", "Цифровой механик")}</small></div></div>
      <div className="nav-caption">{t("nav.caption", "РАЗДЕЛЫ")}</div>
      <nav>{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="online-dot"/><span>{t("systemReady", "Система доступна")}</span></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="mobile-brand">{t("app.name", "Цифровой механик")}</div>
        <div className="topbar-right">
          <Languages size={18}/>
          <div className="lang-switch" role="group" aria-label={t("app.language", "Язык")}>
            {[["ru", "RU"], ["uz", "UZ"], ["ko", "한"]].map(([code, label]) =>
              <button key={code} className={i18n.language === code ? "active" : ""} onClick={() => setLanguage(code)}>{label}</button>)}
          </div>
        </div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}
