import type {
  AuditRunDetail,
  AuditRunListResponse,
  ChatMessage,
  DashboardStats,
  ModelListResponse,
  TokenResponse,
  UserOut,
} from "./types";

export type {
  AuditRunDetail,
  AuditRunListResponse,
  ChatMessage,
  DashboardStats,
  ModelListResponse,
  TokenResponse,
  UserOut,
};

// All calls go through Next.js rewrites (see next.config.js), so this can
// remain a relative path in the browser regardless of environment.
const BASE = "/api";

// Session hook installed by AuthProvider (see `setAuthTokenGetter` below) so
// this service layer can attach the bearer token without importing React /
// context code (which would create a client-only coupling in a shared module).
let getAccessToken: () => string | null = () => null;

export function setAuthTokenGetter(fn: () => string | null): void {
  getAccessToken = fn;
}

// Called by AuthProvider on logout/forced sign-out so in-flight UI state can
// react (components read the auth context directly; this is for the API layer).
type UnauthorizedListener = () => void;
let onUnauthorized: UnauthorizedListener | null = null;

export function setUnauthorizedListener(fn: UnauthorizedListener | null): void {
  onUnauthorized = fn;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Build headers for a JSON/binary API call, attaching the bearer token when a session exists. */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getAccessToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

async function handleResponse<T>(
  res: Response,
  opts: { ignoreUnauthorized?: boolean } = {}
): Promise<T> {
  if (!res.ok) {
    if (res.status === 401 && !opts.ignoreUnauthorized) {
      // Expired/invalid token on a data endpoint: let the auth layer force a
      // sign-out and the page-level guard route the user to /login. Auth
      // endpoints (login/refresh/me) opt out - they own their 401 flows
      // (wrong password, silent refresh) and must not trigger sign-out.
      onUnauthorized?.();
    }
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      // ignore body parse failure, fall back to statusText
    }
    throw new ApiError(detail || "Request failed", res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function runAudit(
  specFile: File,
  logFile: File,
  model: string
): Promise<AuditRunDetail> {
  const form = new FormData();
  form.append("spec_file", specFile);
  form.append("log_file", logFile);
  form.append("model", model);

  const res = await fetch(`${BASE}/audit/run`, { method: "POST", headers: authHeaders(), body: form });
  return handleResponse<AuditRunDetail>(res);
}

export interface ListRunsParams {
  status?: string;
  min_score?: number;
  max_score?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export async function listRuns(params: ListRunsParams = {}): Promise<AuditRunListResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") query.set(k, String(v));
  });
  const res = await fetch(`${BASE}/audit/runs?${query.toString()}`, { headers: authHeaders() });
  return handleResponse<AuditRunListResponse>(res);
}

export async function getRunDetail(runId: string): Promise<AuditRunDetail> {
  const res = await fetch(`${BASE}/audit/runs/${runId}`, { headers: authHeaders() });
  return handleResponse<AuditRunDetail>(res);
}

export async function deleteRun(runId: string): Promise<void> {
  const res = await fetch(`${BASE}/audit/runs/${runId}`, { method: "DELETE", headers: authHeaders() });
  return handleResponse<void>(res);
}

export function exportRunUrl(runId: string): string {
  return `${BASE}/audit/runs/${runId}/export`;
}

export async function downloadRunPdf(runId: string, suggestedName: string): Promise<void> {
  const res = await fetch(exportRunUrl(runId), { headers: authHeaders() });
  if (!res.ok) throw new ApiError("Failed to export PDF", res.status);
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await fetch(`${BASE}/audit/dashboard-stats`, { headers: authHeaders() });
  return handleResponse<DashboardStats>(res);
}

export async function getModels(): Promise<ModelListResponse> {
  const res = await fetch(`${BASE}/models`);
  return handleResponse<ModelListResponse>(res);
}

export async function sendChatMessage(
  message: string,
  runId: string | null,
  model: string,
  history: ChatMessage[]
): Promise<{ answer: string; sources: { chunk: string; similarity: number }[]; model_used: string }> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      run_id: runId,
      model,
      history: history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    }),
  });
  return handleResponse(res);
}

export async function signup(
  email: string,
  password: string,
  fullName?: string
): Promise<TokenResponse> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, full_name: fullName }),
  });
  // Auth endpoints own their 401/409 flows (e.g. wrong password) - never
  // trigger the global unauthorized sign-out.
  return handleResponse<TokenResponse>(res, { ignoreUnauthorized: true });
}

export async function login(
  email: string,
  password: string
): Promise<TokenResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse<TokenResponse>(res, { ignoreUnauthorized: true });
}

export async function refreshToken(
  refresh_token: string
): Promise<TokenResponse> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  });
  // A failed silent refresh is handled inside AuthProvider (it clears the
  // session there); firing the global listener here would double-fire.
  return handleResponse<TokenResponse>(res, { ignoreUnauthorized: true });
}

export async function getCurrentUser(accessToken: string): Promise<UserOut> {
  const res = await fetch(`${BASE}/auth/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  // AuthProvider's fetchCurrentUser already has a refresh-then-clear flow for
  // this call; the global listener would race with it.
  return handleResponse<UserOut>(res, { ignoreUnauthorized: true });
}

export const authApi = {
  signup,
  login,
  refresh: refreshToken,
  me: getCurrentUser,
};

export { ApiError };
