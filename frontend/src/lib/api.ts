export type MintPayload = {
  project_id: string;
  project_type: string;
  tonnes: number;
  vintage_year: number;
  owner_id: string;
  developer_id?: string;
  regulator_id?: string;
  // Optional — omit to let backend auto-compute
  r_ratio?: number;
  m_flag?: number;
  t_flag?: number;
};

export type ComputedFeatures = {
  R_ratio: number;
  Vintage_Age: number;
  M_flag: number;
  T_flag: number;
};

export type MintResponse = {
  credit_id: string;
  ai_risk_score: number;
  ai_risk_score_scaled: number;
  computed_features: ComputedFeatures;
  owner_id: string;
  tonnes: number;
  tx_hash: string;
  block_number: number;
  contract_address: string;
  status: string;
};

export type CreditResponse = {
  credit_id: string;
  tonnes: number;
  developer_id: string;
  regulator_id: string;
  ai_risk_score: number;
  ai_risk_score_scaled: number;
  owner: string;
  is_retired: boolean;
};

export type ChainStatsResponse = {
  network: string;
  chain_id: number;
  latest_block: number;
  contract_address: string;
  node_url: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const fallback = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      throw new Error(data?.detail ?? data?.error ?? fallback);
    } catch {
      throw new Error(fallback);
    }
  }

  return (await res.json()) as T;
}

export function issueCredit(payload: MintPayload) {
  return apiRequest<MintResponse>("/credits/issue", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCredit(creditId: string) {
  return apiRequest<CreditResponse>(`/credits/${encodeURIComponent(creditId)}`);
}

export function fetchChainStats() {
  return apiRequest<ChainStatsResponse>("/chain/stats");
}
