/**
 * Tests for the Explorer page — rendering, credit lookup, event feed.
 * Network calls are mocked via jest.mock.
 */

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mock next/navigation ──────────────────────────────────────────────────────
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// ── Mock next/link ────────────────────────────────────────────────────────────
jest.mock("next/link", () => {
  const Link = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  Link.displayName = "Link";
  return Link;
});

// ── Mock api calls ────────────────────────────────────────────────────────────
const mockFetchChainStats = jest.fn();
const mockFetchCredit = jest.fn();
const mockFetchEvents = jest.fn();
const mockFetchCreditProof = jest.fn();

jest.mock("@/lib/api", () => ({
  fetchChainStats: (...args: unknown[]) => mockFetchChainStats(...args),
  fetchCredit: (...args: unknown[]) => mockFetchCredit(...args),
  fetchEvents: (...args: unknown[]) => mockFetchEvents(...args),
  fetchCreditProof: (...args: unknown[]) => mockFetchCreditProof(...args),
}));

// ── Mock contract calls ───────────────────────────────────────────────────────
jest.mock("@/lib/contract", () => ({
  verifyCredit: jest.fn().mockResolvedValue(true),
  CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
}));

import ExplorerPage from "@/app/explorer/page";

// ── Default mock data ─────────────────────────────────────────────────────────

const mockStats = {
  network: "Hardhat",
  chain_id: 1337,
  latest_block: 10,
  contract_address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  node_url: "http://127.0.0.1:8545",
  merkle_root: "0x0000000000000000000000000000000000000000000000000000000000000000",
  total_credits: 0,
};

const mockEventsEmpty = { events: [], total: 0 };

const mockEventsWithData = {
  events: [
    {
      type: "issued" as const,
      block: 3,
      tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
      credit_id: "CRED-TESTISSUE",
      owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      owner_name: "GreenBuild Solutions",
      tonnes: 5000,
      ai_risk_score: 0.25,
      developer_id: "Dev-A",
      regulator_id: "Gov-B",
    },
    {
      type: "transferred" as const,
      block: 5,
      tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2",
      credit_id: "CRED-TESTTRANSFER",
      from_address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      from_name: "GreenBuild Solutions",
      to_address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      to_name: "CarbonMarket Exchange",
    },
    {
      type: "retired" as const,
      block: 7,
      tx_hash: "0xccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc3",
      credit_id: "CRED-TESTRETIRE",
      owner: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      owner_name: "CarbonMarket Exchange",
    },
  ],
  total: 3,
};

beforeEach(() => {
  mockFetchChainStats.mockResolvedValue(mockStats);
  mockFetchEvents.mockResolvedValue(mockEventsEmpty);
  mockFetchCredit.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ExplorerPage", () => {
  it("renders page heading", async () => {
    render(<ExplorerPage />);
    expect(screen.getByText("Ledger Explorer")).toBeInTheDocument();
  });

  it("shows chain stats after load", async () => {
    render(<ExplorerPage />);
    await waitFor(() => expect(screen.getByText("Hardhat")).toBeInTheDocument());
    expect(screen.getByText("1337")).toBeInTheDocument();
    expect(screen.getByText("#10")).toBeInTheDocument();
  });

  it("shows empty activity feed message when no events", async () => {
    render(<ExplorerPage />);
    await waitFor(() =>
      expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
    );
  });

  it("renders issued, transferred, and retired event rows", async () => {
    mockFetchEvents.mockResolvedValue(mockEventsWithData);
    render(<ExplorerPage />);
    await waitFor(() =>
      expect(screen.getByText("CRED-TESTISSUE")).toBeInTheDocument()
    );
    expect(screen.getByText("CRED-TESTTRANSFER")).toBeInTheDocument();
    expect(screen.getByText("CRED-TESTRETIRE")).toBeInTheDocument();
  });

  it("shows ISSUED badge for issued events", async () => {
    mockFetchEvents.mockResolvedValue(mockEventsWithData);
    render(<ExplorerPage />);
    await waitFor(() => expect(screen.getByText("ISSUED")).toBeInTheDocument());
  });

  it("shows TRANSFERRED badge for transferred events", async () => {
    mockFetchEvents.mockResolvedValue(mockEventsWithData);
    render(<ExplorerPage />);
    await waitFor(() =>
      expect(screen.getByText("TRANSFERRED")).toBeInTheDocument()
    );
  });

  it("shows RETIRED badge for retired events", async () => {
    mockFetchEvents.mockResolvedValue(mockEventsWithData);
    render(<ExplorerPage />);
    await waitFor(() =>
      expect(screen.getByText("RETIRED")).toBeInTheDocument()
    );
  });

  it("shows an error banner when chain stats fail", async () => {
    mockFetchChainStats.mockRejectedValue(new Error("Node offline"));
    render(<ExplorerPage />);
    await waitFor(() =>
      expect(screen.getByText("Node offline")).toBeInTheDocument()
    );
  });

  it("looks up a credit and shows its data", async () => {
    mockFetchCredit.mockResolvedValue({
      credit_id: "CRED-LOOKUP",
      tonnes: 2500,
      developer_id: "Dev-X",
      regulator_id: "Gov-Y",
      ai_risk_score: 0.15,
      ai_risk_score_scaled: 1500,
      owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      owner_name: "GreenBuild Solutions",
      is_retired: false,
    });

    render(<ExplorerPage />);

    const input = screen.getByPlaceholderText("CRED-XXXXXXXX");
    await userEvent.type(input, "CRED-LOOKUP");
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(screen.getByText("CRED-LOOKUP")).toBeInTheDocument()
    );
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(mockFetchCredit).toHaveBeenCalledWith("CRED-LOOKUP");
  });

  it("shows error message when credit lookup fails", async () => {
    mockFetchCredit.mockRejectedValue(new Error("Credit not found"));

    render(<ExplorerPage />);

    const input = screen.getByPlaceholderText("CRED-XXXXXXXX");
    await userEvent.type(input, "NONEXISTENT");
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(screen.getByText("Credit not found")).toBeInTheDocument()
    );
  });

  it("shows RETIRED badge for a retired credit in lookup", async () => {
    mockFetchCredit.mockResolvedValue({
      credit_id: "CRED-OLD",
      tonnes: 100,
      developer_id: "Dev-A",
      regulator_id: "Gov-B",
      ai_risk_score: 0.5,
      ai_risk_score_scaled: 5000,
      owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      owner_name: "GreenBuild Solutions",
      is_retired: true,
    });

    render(<ExplorerPage />);
    const input = screen.getByPlaceholderText("CRED-XXXXXXXX");
    await userEvent.type(input, "CRED-OLD");
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("RETIRED")).toBeInTheDocument());
  });
});
