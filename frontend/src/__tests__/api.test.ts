/**
 * Tests for lib/api.ts — mocked fetch, no live server required.
 */

import { issueCredit, fetchCredit, fetchChainStats, fetchEvents, fetchStakeholders } from "@/lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

function mockFetchError(body: unknown, status: number) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ── issueCredit ───────────────────────────────────────────────────────────────

describe("issueCredit", () => {
  const mintPayload = {
    project_id: "VCS-001",
    project_type: "Cookstoves",
    tonnes: 5000,
    vintage_year: 2022,
    owner_id: "GreenBuild Solutions",
    developer_id: "Dev-Org-Alpha",
    regulator_id: "GOV-EPA-001",
  };

  it("calls POST /credits/issue and returns mint response", async () => {
    const mockResponse = {
      credit_id: "CRED-ABCD1234",
      ai_risk_score: 0.2464,
      ai_risk_score_scaled: 2464,
      computed_features: { R_ratio: 0.1, Vintage_Age: 4, M_flag: 0, T_flag: 0 },
      owner_id: "GreenBuild Solutions",
      tonnes: 5000,
      tx_hash: "0xabc123",
      block_number: 5,
      contract_address: "0x5FbDB231...",
      status: "minted",
    };
    mockFetch(mockResponse);

    const result = await issueCredit(mintPayload);

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/credits/issue",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.credit_id).toBe("CRED-ABCD1234");
    expect(result.ai_risk_score).toBe(0.2464);
  });

  it("throws with server detail message on 422 error", async () => {
    mockFetchError({ detail: "Risk score too high — credit rejected." }, 422);
    await expect(issueCredit(mintPayload)).rejects.toThrow("Risk score too high — credit rejected.");
  });

  it("throws generic message when error body has no detail", async () => {
    mockFetchError({}, 500);
    await expect(issueCredit(mintPayload)).rejects.toThrow("Request failed (500)");
  });
});

// ── fetchCredit ───────────────────────────────────────────────────────────────

describe("fetchCredit", () => {
  it("calls GET /credits/:id and returns credit data", async () => {
    const mockCredit = {
      credit_id: "CRED-XYZ",
      tonnes: 1000,
      developer_id: "Dev-Org-Alpha",
      regulator_id: "GOV-EPA-001",
      ai_risk_score: 0.15,
      ai_risk_score_scaled: 1500,
      owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      owner_name: "GreenBuild Solutions",
      is_retired: false,
    };
    mockFetch(mockCredit);

    const result = await fetchCredit("CRED-XYZ");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/credits/CRED-XYZ",
      expect.any(Object)
    );
    expect(result.credit_id).toBe("CRED-XYZ");
    expect(result.is_retired).toBe(false);
  });

  it("URL-encodes the credit ID", async () => {
    mockFetch({ credit_id: "CRED AB" });
    await fetchCredit("CRED AB");
    expect((fetch as jest.Mock).mock.calls[0][0]).toContain("CRED%20AB");
  });

  it("throws on 404", async () => {
    mockFetchError({ detail: "Credit not found" }, 404);
    await expect(fetchCredit("NONEXISTENT")).rejects.toThrow("Credit not found");
  });
});

// ── fetchChainStats ───────────────────────────────────────────────────────────

describe("fetchChainStats", () => {
  it("returns chain stats", async () => {
    const stats = {
      network: "Hardhat",
      chain_id: 1337,
      latest_block: 42,
      contract_address: "0x5FbDB231...",
      node_url: "http://127.0.0.1:8545",
    };
    mockFetch(stats);

    const result = await fetchChainStats();
    expect(result.chain_id).toBe(1337);
    expect(result.network).toBe("Hardhat");
  });
});

// ── fetchEvents ───────────────────────────────────────────────────────────────

describe("fetchEvents", () => {
  it("returns events array and total", async () => {
    const eventsResponse = {
      events: [
        {
          type: "issued",
          block: 3,
          tx_hash: "0xaaa",
          credit_id: "CRED-001",
          owner: "0xabc",
          owner_name: "Alice",
          tonnes: 1000,
          ai_risk_score: 0.2,
          developer_id: "Dev-A",
          regulator_id: "Gov-B",
        },
      ],
      total: 1,
    };
    mockFetch(eventsResponse);

    const result = await fetchEvents();
    expect(result.total).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe("issued");
  });
});

// ── fetchStakeholders ─────────────────────────────────────────────────────────

describe("fetchStakeholders", () => {
  it("returns stakeholder list", async () => {
    const stakeholders = [
      { name: "GreenBuild Solutions", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
      { name: "EPA Registry", address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9" },
    ];
    mockFetch(stakeholders);

    const result = await fetchStakeholders();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("GreenBuild Solutions");
  });
});
