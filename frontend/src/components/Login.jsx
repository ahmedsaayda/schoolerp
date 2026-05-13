import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../AuthContext.jsx";
import { defaultHomePath, readStoredUserRaw, userPayloadFromApi } from "../authRoles.js";
import { SCHOOL_NAME, SCHOOL_TAGLINE, logoSchoolPublicUrl } from "../branding.js";
import { API_AUTH_CSRF, API_AUTH_LOGIN, STORAGE_AUTH_KEY, apiFetch } from "../config.js";

export default function Login() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  useEffect(() => {
    const stored = user ?? readStoredUserRaw();
    if (stored) {
      if (stored.must_change_password) {
        navigate("/premiere-connexion", { replace: true });
      } else {
        navigate(defaultHomePath(stored), { replace: true });
      }
    }
  }, [user, navigate]);

  /** Cookie csrftoken côté API (nécessaire login POST cross-origin Vercel → Render). */
  useEffect(() => {
    void apiFetch(API_AUTH_CSRF, { method: "GET", credentials: "include" });
  }, []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await apiFetch(API_AUTH_LOGIN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Connexion impossible.");
        return;
      }
      const payload = userPayloadFromApi(data);
      if (!payload) {
        setError("Réponse serveur inattendue.");
        return;
      }
      localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(payload));
      setUser(payload);
      if (payload.must_change_password) {
        navigate("/premiere-connexion", { replace: true });
      } else {
        navigate(defaultHomePath(payload), { replace: true });
      }
    } catch {
      setError("Erreur réseau. Vérifiez que le serveur Django est démarré.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(59,130,246,0.25),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(99,102,241,0.12),transparent)]" />

      <div className="relative w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <img
            src={logoSchoolPublicUrl()}
            alt=""
            width={72}
            height={72}
            className="mx-auto h-[4.5rem] w-[4.5rem] object-contain opacity-95"
          />
          <p className="mt-4 text-sm font-medium uppercase tracking-[0.2em] text-slate-400">{SCHOOL_NAME}</p>
          <p className="mt-1 text-xs text-slate-500">{SCHOOL_TAGLINE}</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
            Connexion administration
          </h1>
          <p className="mt-2 text-sm text-slate-400">Accédez à votre espace sécurisé</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.45)] backdrop-blur-md"
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-slate-200">
                Identifiant
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="ex. directrice"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-slate-200">
                Mot de passe
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Connexion…" : "Se connecter"}
          </button>
          <p className="mt-4 text-center">
            <Link
              to="/mot-de-passe-oublie"
              className="text-sm font-medium text-blue-300 underline-offset-4 hover:text-blue-200 hover:underline"
            >
              Mot de passe oublié ?
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">Connexion chiffrée — usage interne</p>
      </div>
    </div>
  );
}
