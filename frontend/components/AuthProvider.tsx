"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { authApi, setAuthTokenGetter, setUnauthorizedListener, type UserOut, type TokenResponse } from "@/lib/api";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: UserOut | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ACCESS_TOKEN_KEY = "auditify_access_token";
const REFRESH_TOKEN_KEY = "auditify_refresh_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Live token mirror for the API layer. A ref (not state) is used so the
  // getter can be registered before any child component's effects run -
  // child effects fire before parent effects on mount, so registering in
  // useEffect would leave the first data fetches without a bearer header.
  // useLayoutEffect runs (parent-first) before children's passive effects.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = accessToken;

  useLayoutEffect(() => {
    setAuthTokenGetter(() => tokenRef.current);
  }, []);

  // If any data endpoint answers 401 (expired/invalid token), force a full
  // sign-out; the dashboard's auth guard then redirects to /login.
  useEffect(() => {
    setUnauthorizedListener(() => {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      setAccessToken(null);
      setRefreshToken(null);
      setUser(null);
      router.push("/login");
    });
    return () => setUnauthorizedListener(null);
  }, [router]);

  // Load tokens from localStorage on mount
  useEffect(() => {
    const storedAccess = localStorage.getItem(ACCESS_TOKEN_KEY);
    const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (storedAccess) setAccessToken(storedAccess);
    if (storedRefresh) setRefreshToken(storedRefresh);
  }, []);

  // Fetch current user when access token is available
  const fetchCurrentUser = useCallback(async (token: string) => {
    try {
      const userData = await authApi.me(token);
      setUser(userData);
    } catch (err) {
      console.error("Failed to fetch current user:", err);
      if (refreshToken) {
        try {
          const newTokens = await authApi.refresh(refreshToken);
          localStorage.setItem(ACCESS_TOKEN_KEY, newTokens.access_token);
          localStorage.setItem(REFRESH_TOKEN_KEY, newTokens.refresh_token);
          setAccessToken(newTokens.access_token);
          setRefreshToken(newTokens.refresh_token);
          if (newTokens.user) {
            setUser(newTokens.user);
          } else {
            const userData = await authApi.me(newTokens.access_token);
            setUser(userData);
          }
        } catch (refreshErr) {
          console.error("Token refresh failed:", refreshErr);
          localStorage.removeItem(ACCESS_TOKEN_KEY);
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          setAccessToken(null);
          setRefreshToken(null);
          setUser(null);
        }
      } else {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        setAccessToken(null);
        setRefreshToken(null);
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [refreshToken]);

  useEffect(() => {
    if (accessToken) {
      setIsLoading(true);
      fetchCurrentUser(accessToken);
    } else {
      setIsLoading(false);
    }
  }, [accessToken, fetchCurrentUser]);

  const login = async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    localStorage.setItem(ACCESS_TOKEN_KEY, response.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token);
    setAccessToken(response.access_token);
    setRefreshToken(response.refresh_token);
    setUser(response.user ?? null);
    router.push("/");
  };

  const signup = async (email: string, password: string, fullName?: string) => {
    const response = await authApi.signup(email, password, fullName);
    localStorage.setItem(ACCESS_TOKEN_KEY, response.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token);
    setAccessToken(response.access_token);
    setRefreshToken(response.refresh_token);
    setUser(response.user ?? null);
    router.push("/");
  };

  const logout = () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    // replace (not push) so the authenticated dashboard can't be revisited
    // via the browser's back button after signing out.
    router.replace("/login");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        refreshToken,
        isLoading,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}