// API service for Clawscope Dashboard

export interface DashboardStats {
  total_cron_jobs: number;
  active_sessions: number;
  daily_cost: number;
  monthly_cost: number;
  system_health: string;
}

export interface CronJob {
  id: number;
  cron_id?: string;
  name: string;
  enabled?: boolean;
  schedule: string;
  model: string;
  last_status: string;
  last_error?: string;
  next_run?: string;
  consecutive_errors: number;
  total_tokens: number;
  total_cost: number;
  total_runs: number;
  avg_tokens_per_run: number;
  avg_cost_per_run: number;
  updated_at: string;
}

export interface ActiveSession {
  id: number;
  session_key: string;
  model: string;
  tokens_total: number;
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  status: string;
  session_type: string;
  runtime_minutes: number;
  start_time?: string;
}

export interface TokenUsage {
  date: string;
  source: string;  // 'gateway' oder 'transcript'
  api_key: string;
  api_key_name: string;
  model: string;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_write: number;
  tokens_cache_read: number;
  cost_total: number;
}

export interface CostSummary {
  api_keys: Array<{
    api_key: string;
    api_key_name: string;
    total_cost: number;
    total_tokens: number;
    tokens_input: number;
    tokens_output: number;
    tokens_cache_write: number;
    tokens_cache_read: number;
  }>;
  models: Array<{
    model: string;
    total_cost: number;
    total_tokens: number;
    tokens_input: number;
    tokens_output: number;
    tokens_cache_write: number;
    tokens_cache_read: number;
  }>;
}

export interface PromptSessionInfo {
  session_id: string;
  user_category: string;
  started_at: string;
  last_message_at: string;
  total_turns: number;
  total_api_calls: number;
  total_tokens: number;
  total_cost: number;
  primary_model: string;
}

export interface PromptTurnInfo {
  session_id: string;
  user_category: string;
  turn_index: number;
  user_message: string;
  assistant_response: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  api_calls: number;
  tool_calls: number;
  tool_names: string;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens_cache_read: number;
  total_tokens_cache_write: number;
  total_cost: number;
  model: string;
}

export interface PromptApiCallInfo {
  call_index: number;
  message_id: string;
  timestamp: string;
  model: string;
  provider: string;
  stop_reason: string;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost_total: number;
  content_preview: string;
  tool_name: string;
}

export interface PromptStats {
  total_sessions: number;
  total_turns: number;
  total_api_calls: number;
  total_tokens: number;
  total_cost: number;
  by_user: Record<string, { sessions: number; turns: number; api_calls: number; cost: number }>;
}

class ApiService {
  private baseURL = '/api';

  async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async login(password: string): Promise<{ access_token: string; token_type: string }> {
    return this.request('/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  async logout(): Promise<{ message: string }> {
    return this.request('/logout', {
      method: 'POST',
    });
  }

  async getDashboardStats(): Promise<DashboardStats> {
    return this.request('/dashboard/stats');
  }

  async getCronJobs(): Promise<CronJob[]> {
    return this.request('/cron-jobs');
  }

  async getActiveSessions(): Promise<ActiveSession[]> {
    return this.request('/sessions');
  }

  async getTokenUsage(days: number = 7): Promise<TokenUsage[]> {
    return this.request(`/token-usage?days=${days}`);
  }


  async getCostSummary(): Promise<CostSummary> {
    return this.request('/cost-summary');
  }

  async getPromptSessions(days: number = 7, user?: string, dateFrom?: string, dateTo?: string): Promise<{ total: number; sessions: PromptSessionInfo[] }> {
    const params = new URLSearchParams({ days: String(days), limit: '200' });
    if (user) params.set('user', user);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return this.request(`/prompt-sessions?${params}`);
  }

  async getPromptHistory(days: number = 7, user?: string, sessionId?: string, offset: number = 0, limit: number = 100, dateFrom?: string, dateTo?: string): Promise<{ total: number; turns: PromptTurnInfo[] }> {
    const params = new URLSearchParams({ days: String(days), offset: String(offset), limit: String(limit) });
    if (user) params.set('user', user);
    if (sessionId) params.set('session_id', sessionId);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return this.request(`/prompt-history?${params}`);
  }

  async getTurnDetail(sessionId: string, turnIndex: number): Promise<{ turn: PromptTurnInfo; calls: PromptApiCallInfo[] }> {
    return this.request(`/prompt-history/${sessionId}/turn/${turnIndex}`);
  }

  async getPromptStats(days: number = 7, user?: string, dateFrom?: string, dateTo?: string): Promise<PromptStats> {
    const params = new URLSearchParams({ days: String(days) });
    if (user) params.set('user', user);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return this.request(`/prompt-stats?${params}`);
  }

  // ─── Live Agents ─────────────────────────────

  async getLiveAgents(hours: number = 24, type?: string, status?: string): Promise<LiveAgentsResponse> {
    const params = new URLSearchParams({ hours: hours.toString() });
    if (type) params.set('type', type);
    if (status) params.set('status_filter', status);
    return this.request(`/agents/live?${params}`);
  }

  async getAgentDetail(sessionId: string): Promise<AgentDetail> {
    return this.request(`/agents/${sessionId}`);
  }

  // Settings
  async getSettings(): Promise<Record<string, any>> {
    return this.request('/settings');
  }

  async updateSettings(data: Record<string, any>): Promise<{ status: string; message: string }> {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updatePassword(password: string): Promise<{ status: string; message: string }> {
    return this.request('/settings/password', {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  }

  async getApiKeyLabels(): Promise<Record<string, string>> {
    return this.request('/settings/api-key-labels');
  }

  // Raw fetch for custom use
  rawFetch(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
  }
}

export interface LiveAgentInfo {
  session_id: string;
  session_type: string;
  status: string;
  task: string | null;
  label: string | null;
  model: string;
  requester: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  api_calls: number;
  tool_calls_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  total_cost: number;
  final_response: string;
}

export interface LiveAgentsResponse {
  total: number;
  running: number;
  subagents_count: number;
  crons_count: number;
  total_cost: number;
  total_api_calls: number;
  total_tool_calls: number;
  agents: LiveAgentInfo[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
  timestamp: string;
  result_preview: string;
}

export interface AgentDetail {
  session_id: string;
  session_type: string;
  status: string;
  task: string | null;
  label: string | null;
  model: string;
  models_used: string[];
  requester: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  api_calls: number;
  tool_calls_count: number;
  tool_calls: AgentToolCall[];
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  tokens_total: number;
  total_cost: number;
  final_response: string;
}

export const api = new ApiService();