/**
 * Tests for WalletContext — connect, disconnect, useWallet hook.
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet } from "@/lib/WalletContext";

// ── Helper component that exposes wallet state via data-testid ────────────────

function WalletDisplay() {
  const { wallet, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="wallet-name">{wallet?.name ?? "none"}</span>
      <span data-testid="wallet-address">{wallet?.address ?? "none"}</span>
      <span data-testid="wallet-role">{wallet?.role ?? "none"}</span>
      <button
        onClick={() =>
          connect({ address: "0xABC", name: "Alice", role: "Developer" })
        }
      >
        Connect Alice
      </button>
      <button onClick={disconnect}>Disconnect</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <WalletProvider>
      <WalletDisplay />
    </WalletProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WalletContext", () => {
  it("starts with no wallet connected", () => {
    renderWithProvider();
    expect(screen.getByTestId("wallet-name").textContent).toBe("none");
    expect(screen.getByTestId("wallet-address").textContent).toBe("none");
    expect(screen.getByTestId("wallet-role").textContent).toBe("none");
  });

  it("connects a wallet and exposes name, address, role", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByRole("button", { name: "Connect Alice" }));
    expect(screen.getByTestId("wallet-name").textContent).toBe("Alice");
    expect(screen.getByTestId("wallet-address").textContent).toBe("0xABC");
    expect(screen.getByTestId("wallet-role").textContent).toBe("Developer");
  });

  it("disconnects and clears wallet state", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByRole("button", { name: "Connect Alice" }));
    expect(screen.getByTestId("wallet-name").textContent).toBe("Alice");

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByTestId("wallet-name").textContent).toBe("none");
    expect(screen.getByTestId("wallet-address").textContent).toBe("none");
  });

  it("replaces wallet when connect is called a second time", async () => {
    function TwoConnects() {
      const { wallet, connect } = useWallet();
      return (
        <div>
          <span data-testid="name">{wallet?.name ?? "none"}</span>
          <button onClick={() => connect({ address: "0xAAA", name: "Alice", role: "Developer" })}>
            Alice
          </button>
          <button onClick={() => connect({ address: "0xBBB", name: "Bob", role: "Buyer" })}>
            Bob
          </button>
        </div>
      );
    }
    render(
      <WalletProvider>
        <TwoConnects />
      </WalletProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "Alice" }));
    expect(screen.getByTestId("name").textContent).toBe("Alice");
    await userEvent.click(screen.getByRole("button", { name: "Bob" }));
    expect(screen.getByTestId("name").textContent).toBe("Bob");
  });

  it("throws if useWallet is used outside WalletProvider", () => {
    // Suppress React error boundary output
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<WalletDisplay />)).toThrow(
      "useWallet must be used inside WalletProvider"
    );
    consoleSpy.mockRestore();
  });
});
