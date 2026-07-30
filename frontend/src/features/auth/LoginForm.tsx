import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { ApiError } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useAuth } from "./AuthProvider";

const getLoginSchema = (t: any) => z.object({
  username: z.string().trim().min(1, t("auth.username_required")),
  password: z.string().min(1, t("auth.password_required")),
});

type LoginValues = z.infer<ReturnType<typeof getLoginSchema>>;

type LoginLocationState = {
  from?: string;
};

export const LoginForm = () => {
  const { t } = useTranslation();
  const { login, isSubmitting } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const form = useForm<LoginValues>({
    resolver: zodResolver(getLoginSchema(t)),
    defaultValues: { username: "", password: "" },
  });
  const locationState = location.state as LoginLocationState | null;

  const onSubmit = async (values: LoginValues) => {
    try {
      await login(values);
      navigate(locationState?.from || "/", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        if (error.fields.username) {
          form.setError("username", { message: error.fields.username });
        }
        if (error.fields.password) {
          form.setError("password", { message: error.fields.password });
        }
      }
      form.setError("root", { message: error instanceof Error ? error.message : t("auth.login_failed") });
    }
  };

  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <div>
        <label className="mb-2 block text-sm font-semibold text-[var(--ink)]" htmlFor="username">{t("auth.username_label")}</label>
        <Input aria-describedby={form.formState.errors.username ? "username-error" : undefined} aria-invalid={Boolean(form.formState.errors.username)} autoComplete="username" id="username" placeholder={t("auth.username_placeholder")} {...form.register("username")} />
        {form.formState.errors.username ? <p className="mt-2 text-sm text-[var(--coral-strong)]" id="username-error" role="alert">{form.formState.errors.username.message}</p> : null}
      </div>
      <div>
        <label className="mb-2 block text-sm font-semibold text-[var(--ink)]" htmlFor="password">{t("auth.password_label")}</label>
        <Input aria-describedby={form.formState.errors.password ? "password-error" : undefined} aria-invalid={Boolean(form.formState.errors.password)} autoComplete="current-password" id="password" placeholder={t("auth.password_placeholder")} type="password" {...form.register("password")} />
        {form.formState.errors.password ? <p className="mt-2 text-sm text-[var(--coral-strong)]" id="password-error" role="alert">{form.formState.errors.password.message}</p> : null}
      </div>
      {form.formState.errors.root ? <p className="rounded-xl bg-[var(--coral-soft)] px-3 py-2 text-sm text-[var(--coral-strong)] shadow-[inset_0_0_0_1px_var(--coral)]" role="alert">{form.formState.errors.root.message}</p> : null}
      <Button className="mt-2 w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? t("auth.signing_in") : t("auth.sign_in")}
        <ArrowRight size={17} />
      </Button>
    </form>
  );
};
