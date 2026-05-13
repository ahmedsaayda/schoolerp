import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../AuthContext.jsx";
import { defaultHomePath, userPayloadFromApi } from "../authRoles.js";
import { SCHOOL_NAME, SCHOOL_TAGLINE, logoSchoolPublicUrl } from "../branding.js";
import {
  API_AUTH_ME,
  API_AUTH_PASSWORD_CHANGE,
  STORAGE_AUTH_KEY,
  apiFetch,
} from "../config.js";

export default function PremiereConnexionPage() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch(API_AUTH_ME);
        if (!res.ok) {
          if (!cancelled) {
            localStorage.removeItem(STORAGE_AUTH_KEY);
            setUser(null);
            navigate("/login", { replace: true });
          }
          return;
        }
        const data = await res.json();
        const payload = userPayloadFromApi(data);
        if (cancelled || !payload) {
          return;
        }
        localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(payload));
        setUser(payload);
        if (!payload.must_change_password) {
          navigate(defaultHomePath(payload), { replace: true });
        }
      } catch {
        if (!cancelled) {
          navigate("/login", { replace: true });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, setUser]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(API_AUTH_PASSWORD_CHANGE, {
        method: "POST",
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Échec du changement.");
        return;
      }
      const payload = userPayloadFromApi(data);
      if (!payload) {
        setError("Réponse serveur inattendue.");
        return;
      }
      localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(payload));
      setUser(payload);
      navigate(defaultHomePath(payload), { replace: true });
    } catch {
      setError("Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Vérification de la session…
      </div>
    );
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
            Définir votre mot de passe
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Pour des raisons de sécurité, remplacez le mot de passe provisoire avant d&apos;accéder à
            l&apos;application.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.45)] backdrop-blur-md"
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="premiere-old" className="mb-1.5 block text-sm font-medium text-slate-200">
                Mot de passe actuel
              </label>
              <input
                id="premiere-old"
                name="old_password"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label htmlFor="premiere-new" className="mb-1.5 block text-sm font-medium text-slate-200">
                Nouveau mot de passe
              </label>
              <input
                id="premiere-new"
                name="new_password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label htmlFor="premiere-confirm" className="mb-1.5 block text-sm font-medium text-slate-200">
                Confirmer
              </label>
              <input
                id="premiere-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error ? (
            <p
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-200"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-blue-400/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Enregistrement…" : "Enregistrer et continuer"}
          </button>
        </form>
      </div>
    </div>
  );
}
