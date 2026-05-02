/**
 * Tests for lib/contract.ts — pure utility functions only (no live RPC).
 * The ethers Wallet / Contract / JsonRpcProvider are mocked.
 */

import { CONTRACT_ADDRESS, HARDHAT_WALLETS, REGISTRAR_ADDRESS } from "@/lib/contract";

// ── Static constant tests (no mocking needed) ─────────────────────────────────

describe("HARDHAT_WALLETS", () => {
  it("contains at least 7 wallets", () => {
    expect(Object.keys(HARDHAT_WALLETS).length).toBeGreaterThanOrEqual(7);
  });

  it("every entry has name, role, and privateKey", () => {
    for (const [addr, entry] of Object.entries(HARDHAT_WALLETS)) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.role).toBe("string");
      expect(typeof entry.privateKey).toBe("string");
      expect(entry.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it("includes a Registrar role", () => {
    const roles = Object.values(HARDHAT_WALLETS).map((w) => w.role);
    expect(roles).toContain("Registrar");
  });

  it("includes at least one Developer role", () => {
    const roles = Object.values(HARDHAT_WALLETS).map((w) => w.role);
    expect(roles.filter((r) => r === "Developer").length).toBeGreaterThanOrEqual(1);
  });

  it("includes at least one Buyer role", () => {
    const roles = Object.values(HARDHAT_WALLETS).map((w) => w.role);
    expect(roles.filter((r) => r === "Buyer").length).toBeGreaterThanOrEqual(1);
  });

  it("includes at least one Regulator role", () => {
    const roles = Object.values(HARDHAT_WALLETS).map((w) => w.role);
    expect(roles.filter((r) => r === "Regulator").length).toBeGreaterThanOrEqual(1);
  });
});

describe("REGISTRAR_ADDRESS", () => {
  it("is a valid Ethereum address", () => {
    expect(REGISTRAR_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("exists as a key in HARDHAT_WALLETS", () => {
    expect(HARDHAT_WALLETS[REGISTRAR_ADDRESS]).toBeDefined();
  });

  it("has role Registrar", () => {
    expect(HARDHAT_WALLETS[REGISTRAR_ADDRESS].role).toBe("Registrar");
  });
});

describe("CONTRACT_ADDRESS", () => {
  it("is a valid Ethereum address", () => {
    expect(CONTRACT_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

// ── transferCreditOnChain / retireCreditOnChain (mocked ethers) ───────────────

jest.mock("ethers", () => {
  const mockWait = jest.fn().mockResolvedValue({});
  const mockTx = { hash: "0xMOCKHASH", wait: mockWait };
  const mockContract = {
    transferCredit: jest.fn().mockResolvedValue(mockTx),
    retireCredit: jest.fn().mockResolvedValue(mockTx),
  };
  return {
    JsonRpcProvider: jest.fn(),
    Wallet: jest.fn().mockImplementation(() => ({})),
    Contract: jest.fn().mockImplementation(() => mockContract),
  };
});

import { transferCreditOnChain, retireCreditOnChain } from "@/lib/contract";
import { Contract } from "ethers";

describe("transferCreditOnChain", () => {
  it("returns the tx hash on success", async () => {
    const hash = await transferCreditOnChain(
      "CRED-001",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
    expect(hash).toBe("0xMOCKHASH");
  });

  it("calls contract.transferCredit with correct args", async () => {
    await transferCreditOnChain(
      "CRED-XYZ",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
    const contractInstance = (Contract as jest.Mock).mock.results[0].value;
    expect(contractInstance.transferCredit).toHaveBeenCalledWith(
      "CRED-XYZ",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    );
  });

  it("throws when address is not in HARDHAT_WALLETS", async () => {
    await expect(
      transferCreditOnChain("CRED-001", "0xRecipient", "0xUNKNOWN")
    ).rejects.toThrow(/No wallet found/);
  });
});

describe("retireCreditOnChain", () => {
  it("returns the tx hash on success", async () => {
    const hash = await retireCreditOnChain(
      "CRED-001",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
    expect(hash).toBe("0xMOCKHASH");
  });

  it("calls contract.retireCredit with correct args", async () => {
    await retireCreditOnChain(
      "CRED-RETIRE",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
    const contractInstance = (Contract as jest.Mock).mock.results[0].value;
    expect(contractInstance.retireCredit).toHaveBeenCalledWith("CRED-RETIRE");
  });

  it("throws when address is not in HARDHAT_WALLETS", async () => {
    await expect(retireCreditOnChain("CRED-001", "0xUNKNOWN")).rejects.toThrow(
      /No wallet found/
    );
  });
});
