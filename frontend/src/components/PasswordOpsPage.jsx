import { useState } from "react";

import { KeyRound, Mail, User, UserPlus } from "lucide-react";

import { ROLE } from "../authRoles.js";
import {
  API_AUTH_PASSWORD_OPS_CREATE_ACCOUNT,
  API_AUTH_PASSWORD_OPS_FORCE_RESET,
  API_AUTH_PASSWORD_OPS_SEND_RESET,
  apiFetch,
} from "../config.js";

const TABS = [
  { id: "force", label: "Réinitialisation locale" },
  { id: "create", label: "Nouveau compte" },
  { id: "email", label: "Lien par e-mail" },
];

const ROLE_OPTIONS = [
  { value: ROLE.ADMIN, label: "Directeur (administrateur)" },
  { value: ROLE.COMPTABLE, label: "Comptable" },
  { value: ROLE.POINTAGE_AGENT, label: "Agent de pointage" },
];

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100";

export default function PasswordOpsPage() {
  const [tab, setTab] = useState("force");

  const [forceUsername, setForceUsername] = useState("");
  const [forceEmail, setForceEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [createUsername, setCreateUsername] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createRole, setCreateRole] = useState(ROLE.COMPTABLE);
  const [createPassword, setCreatePassword] = useState("");

  const [emailUsername, setEmailUsername] = useState("");
  const [emailAddr, setEmailAddr] = useState("");

  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleForceSubmit(e) {
    e.preventDefault();
    setError("");
    setDetail("");
    const u = forceUsername.trim();
    const em = forceEmail.trim();
    const pwd = newPassword;
    if (!u && !em) {
      setError("Indiquez au moins un identifiant ou une adresse e-mail.");
      return;
    }
    if (!pwd.trim()) {
      setError("Saisissez le nouveau mot de passe.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(API_AUTH_PASSWORD_OPS_FORCE_RESET, {
        method: "POST",
        body: JSON.stringify({
          ...(u ? { username: u } : {}),
          ...(em ? { email: em } : {}),
          new_password: pwd,
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
      setNewPassword("");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateSubmit(e) {
    e.preventDefault();
    setError("");
    setDetail("");
    const u = createUsername.trim();
    const em = createEmail.trim();
    const pwd = createPassword;
    if (!u || !em || !pwd.trim()) {
      setError("Identifiant, e-mail et mot de passe sont obligatoires.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(API_AUTH_PASSWORD_OPS_CREATE_ACCOUNT, {
        method: "POST",
        body: JSON.stringify({
          username: u,
          email: em,
          role: createRole,
          password: pwd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Création refusée.");
        return;
      }
      if (data && typeof data.username === "string") {
        setDetail(`Compte créé pour « ${data.username} » (${createRole}). L’utilisateur devra changer son mot de passe à la première connexion.`);
      }
      setCreateUsername("");
      setCreateEmail("");
      setCreatePassword("");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setError("");
    setDetail("");
    const u = emailUsername.trim();
    const em = emailAddr.trim();
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
            Outils mots de passe
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Réservé aux comptes techniques (<span className="font-mono text-xs">PASSWORD_OPS</span>). Aucun accès aux
            données scolaires ou financières.
          </p>
        </div>
      </div>

      <div
        className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/60"
        role="tablist"
        aria-label="Type d’opération"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setError("");
              setDetail("");
            }}
            className={[
              "flex-1 rounded-lg px-3 py-2 text-center text-xs font-medium transition sm:text-sm",
              tab === id
                ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-200"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "force" ? (
        <form
          onSubmit={handleForceSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
        >
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
            <KeyRound className="h-4 w-4 opacity-70" aria-hidden />
            Définir un nouveau mot de passe sur place
          </div>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Intervention locale : le mot de passe est appliqué tout de suite (sans envoi d’e-mail).
          </p>
          <div className="space-y-4">
            <div>
              <label htmlFor="po-force-username" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <User className="h-4 w-4 opacity-70" aria-hidden />
                Identifiant (optionnel)
              </label>
              <input
                id="po-force-username"
                name="username"
                type="text"
                autoComplete="username"
                value={forceUsername}
                onChange={(e) => setForceUsername(e.target.value)}
                className={inputClass}
                placeholder="ex. directrice"
              />
            </div>
            <div>
              <label htmlFor="po-force-email" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <Mail className="h-4 w-4 opacity-70" aria-hidden />
                E-mail (optionnel)
              </label>
              <input
                id="po-force-email"
                name="email"
                type="email"
                autoComplete="email"
                value={forceEmail}
                onChange={(e) => setForceEmail(e.target.value)}
                className={inputClass}
                placeholder="ex. contact@ecole.tn"
              />
            </div>
            <div>
              <label htmlFor="po-new-password" className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200">
                Nouveau mot de passe
              </label>
              <input
                id="po-new-password"
                name="new_password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Au moins un des deux premiers champs doit être renseigné.</p>
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
            {submitting ? "Traitement…" : "Appliquer le mot de passe"}
          </button>
        </form>
      ) : null}

      {tab === "create" ? (
        <form
          onSubmit={handleCreateSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
        >
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
            <UserPlus className="h-4 w-4 opacity-70" aria-hidden />
            Créer un nouveau compte
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="po-create-username" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <User className="h-4 w-4 opacity-70" aria-hidden />
                Identifiant
              </label>
              <input
                id="po-create-username"
                name="username"
                type="text"
                autoComplete="off"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                className={inputClass}
                placeholder="ex. comptable2"
              />
            </div>
            <div>
              <label htmlFor="po-create-email" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <Mail className="h-4 w-4 opacity-70" aria-hidden />
                E-mail
              </label>
              <input
                id="po-create-email"
                name="email"
                type="email"
                autoComplete="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                className={inputClass}
                placeholder="ex. user@ecole.tn"
              />
            </div>
            <div>
              <label htmlFor="po-create-role" className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200">
                Rôle
              </label>
              <select
                id="po-create-role"
                name="role"
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value)}
                className={inputClass}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="po-create-password" className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200">
                Mot de passe initial
              </label>
              <input
                id="po-create-password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </div>
          </div>
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
            <UserPlus className="h-4 w-4" aria-hidden />
            {submitting ? "Création…" : "Créer le compte"}
          </button>
        </form>
      ) : null}

      {tab === "email" ? (
        <form
          onSubmit={handleEmailSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
        >
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
            <Mail className="h-4 w-4 opacity-70" aria-hidden />
            Envoyer un lien par e-mail
          </div>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Le compte cible doit avoir une adresse e-mail renseignée.
          </p>
          <div className="space-y-4">
            <div>
              <label htmlFor="po-email-username" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <User className="h-4 w-4 opacity-70" aria-hidden />
                Identifiant (optionnel)
              </label>
              <input
                id="po-email-username"
                name="username"
                type="text"
                autoComplete="username"
                value={emailUsername}
                onChange={(e) => setEmailUsername(e.target.value)}
                className={inputClass}
                placeholder="ex. directrice"
              />
            </div>
            <div>
              <label htmlFor="po-email-addr" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <Mail className="h-4 w-4 opacity-70" aria-hidden />
                E-mail (optionnel)
              </label>
              <input
                id="po-email-addr"
                name="email"
                type="email"
                autoComplete="email"
                value={emailAddr}
                onChange={(e) => setEmailAddr(e.target.value)}
                className={inputClass}
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
            <Mail className="h-4 w-4" aria-hidden />
            {submitting ? "Envoi…" : "Envoyer le lien"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
