export type CheckStatus = "PASS" | "FAIL" | "WARNING";
export type CheckSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type CheckSource = "RULE_BASED" | "AI_DRIVEN";

export interface CheckItem {
  id: string;
  name: string;
  category: string;
  status: CheckStatus;
  severity: CheckSeverity;
  source: CheckSource;
  description: string;
  evidence?: string | null;
  recommendation: string;
  created_at: string;
}

export interface AuditRunSummary {
  id: string;
  spec_filename: string;
  log_filename: string;
  model_used: string;
  compliance_score: number;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  warning_checks: number;
  critical_violations: number;
  status: string;
  created_at: string;
}

export interface AuditRunDetail extends AuditRunSummary {
  spec_char_count: number;
  log_char_count: number;
  log_line_count: number;
  checks: CheckItem[];
}

export interface AuditRunListResponse {
  total: number;
  runs: AuditRunSummary[];
}

export interface DashboardStats {
  total_runs: number;
  total_checks_executed: number;
  average_compliance_score: number;
  total_critical_violations: number;
  total_logs_audited: number;
  latest_run: AuditRunSummary | null;
}

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  context_window: number;
}

export interface ModelListResponse {
  models: ModelInfo[];
  default_model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { chunk: string; similarity: number }[];
  isError?: boolean;
}

// Auth types
export interface UserOut {
  id: string;
  email: string;
  full_name?: string | null;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user?: UserOut | null;
}
