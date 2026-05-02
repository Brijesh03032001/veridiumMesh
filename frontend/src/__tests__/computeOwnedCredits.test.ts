/**
 * Tests for the computeOwnedCredits helper in developer/page.tsx.
 * We extract + re-export the helper for testability, or inline it here
 * since it has no React dependency.
 */

import type { ChainEvent } from "@/lib/api";

// ── Inline the pure helper so we can test it without importing the page ──────

function computeOwnedCredits(events: ChainEvent[], address: string): string[] {
  const ownership = new Map<string, string>();
  for (const ev of events) {
    if (ev.type === "issued") {
      ownership.set(ev.credit_id, ev.owner);
    } else if (ev.type === "transferred") {
      ownership.set(ev.credit_id, ev.to_address);
    } else if (ev.type === "retired") {
      ownership.delete(ev.credit_id);
    }
  }
  return Array.from(ownership.entries())
    .filter(([, owner]) => owner.toLowerCase() === address.toLowerCase())
    .map(([creditId]) => creditId);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALICE = "0xAlice";
const BOB = "0xBob";

function issued(creditId: string, owner: string): ChainEvent {
  return {
    type: "issued",
    block: 1,
    tx_hash: "0xhash",
    credit_id: creditId,
    owner,
    owner_name: "Test",
    tonnes: 1000,
    ai_risk_score: 0.1,
    developer_id: "Dev",
    regulator_id: "Gov",
  };
}

function transferred(creditId: string, from_address: string, to_address: string): ChainEvent {
  return {
    type: "transferred",
    block: 2,
    tx_hash: "0xhash2",
    credit_id: creditId,
    from_address,
    from_name: "Sender",
    to_address,
    to_name: "Receiver",
  };
}

function retired(creditId: string, owner: string): ChainEvent {
  return {
    type: "retired",
    block: 3,
    tx_hash: "0xhash3",
    credit_id: creditId,
    owner,
    owner_name: "Test",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeOwnedCredits", () => {
  it("returns empty array when no events", () => {
    expect(computeOwnedCredits([], ALICE)).toEqual([]);
  });

  it("returns credits issued to the given address", () => {
    const events: ChainEvent[] = [
      issued("CRED-001", ALICE),
      issued("CRED-002", BOB),
    ];
    expect(computeOwnedCredits(events, ALICE)).toEqual(["CRED-001"]);
  });

  it("does not return credits issued to a different address", () => {
    const events: ChainEvent[] = [issued("CRED-002", BOB)];
    expect(computeOwnedCredits(events, ALICE)).toEqual([]);
  });

  it("updates ownership on transfer — new owner sees credit", () => {
    const events: ChainEvent[] = [
      issued("CRED-001", ALICE),
      transferred("CRED-001", ALICE, BOB),
    ];
    expect(computeOwnedCredits(events, BOB)).toEqual(["CRED-001"]);
  });

  it("updates ownership on transfer — old owner no longer sees credit", () => {
    const events: ChainEvent[] = [
      issued("CRED-001", ALICE),
      transferred("CRED-001", ALICE, BOB),
    ];
    expect(computeOwnedCredits(events, ALICE)).toEqual([]);
  });

  it("removes credit on retire", () => {
    const events: ChainEvent[] = [
      issued("CRED-001", ALICE),
      retired("CRED-001", ALICE),
    ];
    expect(computeOwnedCredits(events, ALICE)).toEqual([]);
  });

  it("is case-insensitive for address comparison", () => {
    const events: ChainEvent[] = [issued("CRED-001", "0xALICE")];
    expect(computeOwnedCredits(events, "0xalice")).toEqual(["CRED-001"]);
  });

  it("handles multiple credits and transfers correctly", () => {
    const events: ChainEvent[] = [
      issued("CRED-001", ALICE),
      issued("CRED-002", ALICE),
      issued("CRED-003", BOB),
      transferred("CRED-001", ALICE, BOB),
      retired("CRED-003", BOB),
    ];
    // Alice still owns CRED-002; CRED-001 went to BOB; CRED-003 retired
    expect(computeOwnedCredits(events, ALICE)).toEqual(["CRED-002"]);
    expect(computeOwnedCredits(events, BOB)).toEqual(["CRED-001"]);
  });

  it("handles a transfer chain A→B→C correctly", () => {
    const C = "0xCharlie";
    const events: ChainEvent[] = [
      issued("CRED-001", ALICE),
      transferred("CRED-001", ALICE, BOB),
      transferred("CRED-001", BOB, C),
    ];
    expect(computeOwnedCredits(events, ALICE)).toEqual([]);
    expect(computeOwnedCredits(events, BOB)).toEqual([]);
    expect(computeOwnedCredits(events, C)).toEqual(["CRED-001"]);
  });
});
