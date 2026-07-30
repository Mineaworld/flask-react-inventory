import { useTranslation } from "react-i18next";
import { LoginForm } from "./LoginForm";

export const LoginPage = () => {
  const { t } = useTranslation();
  return (
  <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-4 py-8 sm:px-6">
    <section className="w-full max-w-md rounded-[1.5rem] bg-[var(--surface)] p-7 shadow-[var(--shadow-elevated)] sm:p-10">
      <div className="flex items-center gap-3">
        <img src="/Logo.png" alt={t("auth.logo_alt")} className="size-11 rounded-xl object-contain" />
        <div><p className="font-display text-sm font-semibold text-[var(--ink)]">{t("auth.app_title")}</p></div>
      </div>
      <h1 className="mt-10 text-balance font-display text-3xl font-semibold leading-[1.08] tracking-[-0.04em] text-[var(--ink)]">{t("auth.sign_in_title")}</h1>
      <div className="mt-8"><LoginForm /></div>
    </section>
  </main>
  );
};
