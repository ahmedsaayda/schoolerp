import { useState } from "react";

import { KeyRound, Mail, User } from "lucide-react";

import { API_AUTH_PASSWORD_OPS_SEND_RESET, apiFetch } from "../config.js";

export default function PasswordOpsPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setDetail("");
    const u = username.trim();
    const em = email.trim();
    if (!u && !em) {
      setError("Indiquez au moins un identifiant ou une adresse e-mail.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(API_AUTH_PASSWORD_OPS_SEND_RESET, {
        method: "POST",
        body: JSON.stringify({
          ...(u ? { username: u } : {}),
          ...(em ? { email: em } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Demande refusée.");
        return;
      }
      if (typeof data.detail === "string") {
        setDetail(data.detail);
      }
    } catch {
      setError("Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-200">
          <KeyRound className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Réinitialisation par e-mail
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Réservé aux comptes techniques. Envoie un lien sécurisé au compte métier (sans accès aux données
            scolaires).
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="po-username" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              <User className="h-4 w-4 opacity-70" aria-hidden />
              Identifiant (optionnel)
            </label>
            <input
              id="po-username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              placeholder="ex. directrice"
            />
          </div>
          <div>
            <label htmlFor="po-email" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              <Mail className="h-4 w-4 opacity-70" aria-hidden />
              E-mail (optionnel)
            </label>
            <input
              id="po-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              placeholder="ex. contact@ecole.tn"
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Au moins un des deux champs doit être renseigné.</p>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100" role="alert">
            {error}
          </p>
        ) : null}

        {detail ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/50 dark:text-emerald-100">
            {detail}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <KeyRound className="h-4 w-4" aria-hidden />
          {submitting ? "Envoi…" : "Envoyer le lien"}
        </button>
      </form>
    </div>
  );
}
