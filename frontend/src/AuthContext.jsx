import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  API_AUTH_CSRF,
  API_AUTH_ME,
  STORAGE_AUTH_KEY,
  apiFetch,
} from "./config.js";
import { readStoredUserRaw, userPayloadFromApi } from "./authRoles.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredUserRaw());
  const [csrfReady, setCsrfReady] = useState(false);

  /**
   * Récupère le jeton CSRF au montage (indispensable en mode Incognito / InPrivate
   * où aucun cookie ne persiste entre les sessions). Toutes les requêtes API ne
   * doivent démarrer qu'après la résolution de cet appel.
   */
  useEffect(() => {
    apiFetch(API_AUTH_CSRF, { method: "GET" })
      .catch(() => {})
      .finally(() => setCsrfReady(true));
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch(API_AUTH_ME);
      if (!res.ok) return;
      const data = await res.json();
      const payload = userPayloadFromApi(data);
      if (payload) {
        localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(payload));
        setUser(payload);
      }
    } catch {
      /* session expirée ou réseau */
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      refreshUser,
      csrfReady,
    }),
    [user, refreshUser, csrfReady],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth doit être utilisé sous AuthProvider");
  }
  return ctx;
}
