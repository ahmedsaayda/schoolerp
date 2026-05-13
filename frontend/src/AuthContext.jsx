import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { API_AUTH_ME, STORAGE_AUTH_KEY, apiFetch } from "./config.js";
import { readStoredUserRaw, userPayloadFromApi } from "./authRoles.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredUserRaw());

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
    }),
    [user, refreshUser],
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
