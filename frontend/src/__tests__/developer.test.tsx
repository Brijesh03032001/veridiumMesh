/**
 * Tests for the Developer Console page.
 * All network calls and ethers.js functions are mocked.
 */

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider } from "@/lib/WalletContext";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("next/link", () => {
  const Link = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  Link.displayName = "Link";
  return Link;
});

const mockIssueCredit = jest.fn();
const mockFetchStakeholders = jest.fn();
const mockFetchEvents = jest.fn();

jest.mock("@/lib/api", () => ({
  issueCredit: (...args: unknown[]) => mockIssueCredit(...args),
  fetchStakeholders: (...args: unknown[]) => mockFetchStakeholders(...args),
  fetchEvents: (...args: unknown[]) => mockFetchEvents(...args),
}));

const mockTransferCreditOnChain = jest.fn();
const mockRetireCreditOnChain = jest.fn();

jest.mock("@/lib/contract", () => {
  const HARDHAT_WALLETS: Record<string, { name: string; role: string; privateKey: string }> = {
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266": {
      name: "VeridiumAI",
      role: "Registrar",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    },
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": {
      name: "GreenBuild Solutions",
      role: "Developer",
      privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    },
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": {
      name: "CarbonMarket Exchange",
      role: "Buyer",
      privateKey: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926b",
    },
  };
  return {
    REGISTRAR_ADDRESS: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    HARDHAT_WALLETS,
    transferCreditOnChain: (...args: unknown[]) => mockTransferCreditOnChain(...args),
    retireCreditOnChain: (...args: unknown[]) => mockRetireCreditOnChain(...args),
    transferCreditWithMetaMask: jest.fn(),
    retireCreditWithMetaMask: jest.fn(),
    isMetaMaskAvailable: () => false,
    getMetaMaskAddress: jest.fn(),
  };
});

import DeveloperPage from "@/app/developer/page";

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <WalletProvider>
      <DeveloperPage />
    </WalletProvider>
  );
}

const REGISTRAR_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEVELOPER_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BUYER_ADDR = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

async function connectWallet(address: string) {
  const select = screen.getByRole("combobox", { name: /connect your wallet/i });
  await userEvent.selectOptions(select, address);
  // Use exact button text "Connect" to avoid matching "Disconnect"
  const connectBtn = screen.getAllByRole("button").find(
    (btn) => btn.textContent?.trim() === "Connect"
  )!;
  await userEvent.click(connectBtn);
}

const mockMintResponse = {
  credit_id: "CRED-TEST0001",
  ai_risk_score: 0.2464,
  ai_risk_score_scaled: 2464,
  computed_features: { R_ratio: 0.1, Vintage_Age: 4, M_flag: 0, T_flag: 0 },
  owner_id: "GreenBuild Solutions",
  tonnes: 5000,
  tx_hash: "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
  block_number: 5,
  contract_address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  status: "minted",
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetchStakeholders.mockResolvedValue([
    { name: "GreenBuild Solutions", address: DEVELOPER_ADDR },
    { name: "CarbonMarket Exchange", address: BUYER_ADDR },
  ]);
  mockFetchEvents.mockResolvedValue({ events: [], total: 0 });
  mockIssueCredit.mockReset();
  mockTransferCreditOnChain.mockReset();
  mockRetireCreditOnChain.mockReset();
});

afterEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DeveloperPage — wallet connection", () => {
  it("renders wallet connect dropdown when not connected", () => {
    renderPage();
    // The wallet-select combobox should be present (no wallet connected)
    expect(screen.getByRole("combobox", { name: /connect your wallet/i })).toBeInTheDocument();
  });

  it("shows connected wallet bar after connecting", async () => {
    renderPage();
    await connectWallet(REGISTRAR_ADDR);
    await waitFor(() =>
      expect(screen.getByText("VeridiumAI")).toBeInTheDocument()
    );
    expect(screen.getByText(REGISTRAR_ADDR)).toBeInTheDocument();
  });

  it("clears wallet bar after disconnect", async () => {
    renderPage();
    await connectWallet(REGISTRAR_ADDR);
    await waitFor(() => expect(screen.getByText("VeridiumAI")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /connect your wallet/i })).toBeInTheDocument()
    );
  });
});

describe("DeveloperPage — mint form (Registrar only)", () => {
  it("shows mint form only for Registrar", async () => {
    renderPage();
    await connectWallet(REGISTRAR_ADDR);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /score & mint/i })).toBeInTheDocument()
    );
  });

  it("does NOT show mint form for Developer role", async () => {
    renderPage();
    await connectWallet(DEVELOPER_ADDR);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /score & mint/i })).not.toBeInTheDocument()
    );
  });

  it("submits mint form and shows success banner with credit ID", async () => {
    mockIssueCredit.mockResolvedValue(mockMintResponse);
    renderPage();
    await connectWallet(REGISTRAR_ADDR);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /score & mint/i })).toBeInTheDocument()
    );

    // Owner select must be populated from stakeholders
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /GreenBuild/i })).toBeInTheDocument()
    );
    // Use the owner_id select (it is the second combobox on the page — first is wallet select but that's gone after connect)
    const ownerSelect = screen.getAllByRole("combobox")[0];
    await userEvent.selectOptions(ownerSelect, "GreenBuild Solutions");

    await userEvent.click(screen.getByRole("button", { name: /score & mint/i }));

    await waitFor(() =>
      expect(screen.queryAllByText(/CRED-TEST0001/).length).toBeGreaterThan(0)
    );
  });

  it("resets mint form to initial values after successful mint", async () => {
    mockIssueCredit.mockResolvedValue(mockMintResponse);
    renderPage();
    await connectWallet(REGISTRAR_ADDR);
    await waitFor(() => screen.getByRole("button", { name: /score & mint/i }));

    const projectIdInput = screen.getByPlaceholderText("VCS-001");
    await userEvent.clear(projectIdInput);
    await userEvent.type(projectIdInput, "MY-CUSTOM-PROJECT");
    expect(projectIdInput).toHaveValue("MY-CUSTOM-PROJECT");

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /GreenBuild/i })).toBeInTheDocument()
    );
    const ownerSelect2 = screen.getAllByRole("combobox")[0];
    await userEvent.selectOptions(ownerSelect2, "GreenBuild Solutions");
    await userEvent.click(screen.getByRole("button", { name: /score & mint/i }));

    // After mint, form should reset to "VCS-001" (initialMint.project_id)
    await waitFor(() =>
      expect(projectIdInput).toHaveValue("VCS-001")
    );
  });

  it("shows error banner when mint fails", async () => {
    mockIssueCredit.mockRejectedValue(new Error("Risk score too high"));
    renderPage();
    await connectWallet(REGISTRAR_ADDR);
    await waitFor(() => screen.getByRole("button", { name: /score & mint/i }));

    const ownerSelect3 = screen.getAllByRole("combobox")[0];
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /GreenBuild/i })).toBeInTheDocument()
    );
    await userEvent.selectOptions(ownerSelect3, "GreenBuild Solutions");
    await userEvent.click(screen.getByRole("button", { name: /score & mint/i }));

    await waitFor(() =>
      expect(screen.getByText("Risk score too high")).toBeInTheDocument()
    );
  });

  it("clears mint result and banner when wallet is disconnected", async () => {
    mockIssueCredit.mockResolvedValue(mockMintResponse);
    renderPage();
    await connectWallet(REGISTRAR_ADDR);
    await waitFor(() => screen.getByRole("button", { name: /score & mint/i }));

    const ownerSelect4 = screen.getAllByRole("combobox")[0];
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /GreenBuild/i })).toBeInTheDocument()
    );
    await userEvent.selectOptions(ownerSelect4, "GreenBuild Solutions");
    await userEvent.click(screen.getByRole("button", { name: /score & mint/i }));
    await waitFor(() =>
      expect(screen.queryAllByText(/CRED-TEST0001/).length).toBeGreaterThan(0)
    );

    // Disconnect
    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    await waitFor(() =>
      expect(screen.queryAllByText(/CRED-TEST0001/).length).toBe(0)
    );
  });
});

describe("DeveloperPage — Transfer form", () => {
  beforeEach(async () => {
    renderPage();
    await connectWallet(DEVELOPER_ADDR);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /transfer credit/i })).toBeInTheDocument()
    );
  });

  it("shows Transfer and Retire forms for non-Registrar wallet", () => {
    // Both Transfer and Retire forms have a Credit ID input
    const creditInputs = screen.getAllByPlaceholderText("CRED-XXXXXXXX");
    expect(creditInputs.length).toBeGreaterThanOrEqual(2);
  });

  it("clears credit ID and recipient fields after successful transfer", async () => {
    mockTransferCreditOnChain.mockResolvedValue("0xtxhash");
    mockFetchEvents.mockResolvedValue({ events: [], total: 0 });

    const creditInput = screen.getAllByPlaceholderText("CRED-XXXXXXXX")[0];
    await userEvent.type(creditInput, "CRED-TRANSFER");

    const recipientSelect = screen.getByRole("combobox", { name: /transfer to/i });
    await userEvent.selectOptions(recipientSelect, BUYER_ADDR);

    await userEvent.click(screen.getByRole("button", { name: /transfer credit/i }));

    await waitFor(() =>
      expect(screen.getByText(/transferred successfully/i)).toBeInTheDocument()
    );
    expect(creditInput).toHaveValue("");
  });

  it("shows error message when transfer fails", async () => {
    mockTransferCreditOnChain.mockRejectedValue(new Error("Not the owner"));

    const creditInput = screen.getAllByPlaceholderText("CRED-XXXXXXXX")[0];
    await userEvent.type(creditInput, "CRED-NOTMINE");

    const recipientSelect = screen.getByRole("combobox", { name: /transfer to/i });
    await userEvent.selectOptions(recipientSelect, BUYER_ADDR);

    await userEvent.click(screen.getByRole("button", { name: /transfer credit/i }));

    await waitFor(() =>
      expect(screen.getByText("Not the owner")).toBeInTheDocument()
    );
  });
});

describe("DeveloperPage — Retire form", () => {
  beforeEach(async () => {
    renderPage();
    await connectWallet(DEVELOPER_ADDR);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retire credit/i })).toBeInTheDocument()
    );
  });

  it("clears credit ID after successful retire", async () => {
    mockRetireCreditOnChain.mockResolvedValue("0xtxhash2");
    mockFetchEvents.mockResolvedValue({ events: [], total: 0 });

    const retireInput = screen.getAllByPlaceholderText("CRED-XXXXXXXX")[1];
    await userEvent.type(retireInput, "CRED-RETIRE");

    await userEvent.click(screen.getByRole("button", { name: /retire credit/i }));

    await waitFor(() =>
      expect(screen.getByText(/permanently retired/i)).toBeInTheDocument()
    );
    expect(retireInput).toHaveValue("");
  });

  it("shows error when retire fails", async () => {
    mockRetireCreditOnChain.mockRejectedValue(new Error("Already retired"));

    const retireInput = screen.getAllByPlaceholderText("CRED-XXXXXXXX")[1];
    await userEvent.type(retireInput, "CRED-DONE");

    await userEvent.click(screen.getByRole("button", { name: /retire credit/i }));

    await waitFor(() =>
      expect(screen.getByText("Already retired")).toBeInTheDocument()
    );
  });
});

describe("DeveloperPage — Your Credits panel", () => {
  const issuedEvent = {
    type: "issued" as const,
    block: 2,
    tx_hash: "0xabc",
    credit_id: "CRED-MINE",
    owner: DEVELOPER_ADDR,
    owner_name: "GreenBuild Solutions",
    tonnes: 5000,
    ai_risk_score: 0.2,
    developer_id: "Dev-A",
    regulator_id: "Gov-B",
  };

  it("shows owned credits panel when wallet has credits", async () => {
    mockFetchEvents.mockResolvedValue({ events: [issuedEvent], total: 1 });
    renderPage();
    await connectWallet(DEVELOPER_ADDR);

    await waitFor(() =>
      expect(screen.getByText("CRED-MINE")).toBeInTheDocument()
    );
    expect(screen.getByText("1 owned")).toBeInTheDocument();
  });

  it("quick-fills Transfer form when Transfer button is clicked", async () => {
    mockFetchEvents.mockResolvedValue({ events: [issuedEvent], total: 1 });
    renderPage();
    await connectWallet(DEVELOPER_ADDR);

    await waitFor(() =>
      expect(screen.getByText("CRED-MINE")).toBeInTheDocument()
    );

    // Click the "Transfer" quick-fill button
    const transferFillBtn = screen.getAllByRole("button", { name: /^Transfer$/i })[0];
    await userEvent.click(transferFillBtn);

    const creditInput = screen.getAllByPlaceholderText("CRED-XXXXXXXX")[0];
    expect(creditInput).toHaveValue("CRED-MINE");
  });

  it("quick-fills Retire form when Retire button is clicked", async () => {
    mockFetchEvents.mockResolvedValue({ events: [issuedEvent], total: 1 });
    renderPage();
    await connectWallet(DEVELOPER_ADDR);

    await waitFor(() =>
      expect(screen.getByText("CRED-MINE")).toBeInTheDocument()
    );

    const retireFillBtn = screen.getByRole("button", { name: /^Retire$/i });
    await userEvent.click(retireFillBtn);

    const retireInput = screen.getAllByPlaceholderText("CRED-XXXXXXXX")[1];
    expect(retireInput).toHaveValue("CRED-MINE");
  });

  it("shows 'no active credits' message when wallet has no credits", async () => {
    // Use events that include something but developer owns nothing
    const transferredEvent = {
      type: "transferred" as const,
      block: 3,
      tx_hash: "0xdef",
      credit_id: "CRED-GONE",
      from_address: DEVELOPER_ADDR,
      from_name: "GreenBuild Solutions",
      to_address: BUYER_ADDR,
      to_name: "CarbonMarket Exchange",
    };
    mockFetchEvents.mockResolvedValue({ events: [transferredEvent], total: 1 });

    renderPage();
    await connectWallet(DEVELOPER_ADDR);

    await waitFor(() =>
      expect(screen.getByText(/No active credits/i)).toBeInTheDocument()
    );
  });
});
