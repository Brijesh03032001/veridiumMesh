"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Search, Globe, Hash, Blocks, FileCode2,
  Loader2, Activity, ArrowRightLeft, Flame, Sprout,
  TreePine, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  fetchChainStats,
  fetchCredit,
  fetchEvents,
  fetchCreditProof,
  type ChainStatsResponse,
  type CreditResponse,
  type ChainEvent,
  type MerkleProofResponse,
} from "@/lib/api";
import { verifyCredit } from "@/lib/contract";

function riskColor(score: number) {
  if (score >= 0.7) return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "HIGH RISK" };
  if (score >= 0.4) return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "MEDIUM RISK" };
  return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "LOW RISK" };
}

function shorten(addr: string, n = 6) {
  if (addr.length <= n * 2 + 3) return addr;
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

function EventRow({ event }: { event: ChainEvent }) {
  if (event.type === "issued") {
    const risk = riskColor(event.ai_risk_score);
    return (
      <div className="flex items-start gap-4 py-4">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <Sprout className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-sm">{event.credit_id}</span>
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs">ISSUED</Badge>
            <Badge className={`border ${risk.border} ${risk.bg} ${risk.text} text-xs`}>{risk.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.tonnes.toLocaleString()} tonnes · Risk {event.ai_risk_score.toFixed(4)} · {event.developer_id} / {event.regulator_id}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground/70">{shorten(event.tx_hash, 10)} · block #{event.block}</p>
        </div>
      </div>
    );
  }

  if (event.type === "transferred") {
    return (
      <div className="flex items-start gap-4 py-4">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
          <ArrowRightLeft className="h-4 w-4 text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-sm">{event.credit_id}</span>
            <Badge className="border border-blue-200 bg-blue-50 text-blue-700 text-xs">TRANSFERRED</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {shorten(event.from_address)} → {shorten(event.to_address)}
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground/70">{shorten(event.tx_hash, 10)} · block #{event.block}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 py-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100">
        <Flame className="h-4 w-4 text-orange-500" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold text-sm">{event.credit_id}</span>
          <Badge className="border border-orange-200 bg-orange-50 text-orange-700 text-xs">RETIRED</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Permanently burned by {shorten(event.owner)}</p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground/70">{shorten(event.tx_hash, 10)} · block #{event.block}</p>
      </div>
    </div>
  );
}

export default function ExplorerPage() {
  const router = useRouter();
  const [creditId, setCreditId]     = useState("");
  const [creditData, setCreditData] = useState<CreditResponse | null>(null);
  const [chainStats, setChainStats] = useState<ChainStatsResponse | null>(null);
  const [events, setEvents]         = useState<ChainEvent[]>([]);
  const [error, setError]           = useState<string | null>(null);
  const [searching, setSearching]   = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);

  // Merkle proof state
  const [proofData, setProofData]           = useState<MerkleProofResponse | null>(null);
  const [proofLoading, setProofLoading]     = useState(false);
  const [proofError, setProofError]         = useState<string | null>(null);
  const [verifyResult, setVerifyResult]     = useState<boolean | null>(null);
  const [verifyLoading, setVerifyLoading]   = useState(false);

  async function loadStats() {
    setLoadingStats(true);
    setError(null);
    try {
      const stats = await fetchChainStats();
      setChainStats(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chain stats.");
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadEvents() {
    try {
      const res = await fetchEvents();
      setEvents(res.events);
    } catch {
      // silently ignore — events panel is non-critical
    }
  }

  useEffect(() => {
    void loadStats();
    void loadEvents();
    const poll = setInterval(loadEvents, 5000);
    return () => clearInterval(poll);
  }, []);

  async function onLookup(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!creditId.trim()) return;
    setSearching(true);
    setError(null);
    setCreditData(null);
    setProofData(null);
    setProofError(null);
    setVerifyResult(null);
    try {
      setCreditData(await fetchCredit(creditId.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Credit not found.");
    } finally {
      setSearching(false);
    }
  }

  async function onGetProof() {
    if (!creditData) return;
    setProofLoading(true);
    setProofError(null);
    setProofData(null);
    setVerifyResult(null);
    try {
      setProofData(await fetchCreditProof(creditData.credit_id));
    } catch (err) {
      setProofError(err instanceof Error ? err.message : "Failed to get proof.");
    } finally {
      setProofLoading(false);
    }
  }

  async function onVerifyOnChain() {
    if (!proofData) return;
    setVerifyLoading(true);
    try {
      const ok = await verifyCredit(proofData.proof, proofData.leaf_hash);
      setVerifyResult(ok);
    } catch (err) {
      setProofError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-100 via-green-50 to-emerald-100/80 px-6 py-10 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7">

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Ledger Explorer</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
              Live view of the Ethereum event log — every issuance, transfer, and retirement on the chain.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => router.push("/developer")}>
              Developer Console
            </Button>
            <Button variant="outline" onClick={loadStats} disabled={loadingStats}>
              {loadingStats ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Refreshing</> : "Refresh Stats"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        {/* Chain stats — now 6 cards: 4 base + Merkle Root + Total Credits */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[
            { icon: <Globe className="h-5 w-5 text-primary" />, label: "Network",         value: chainStats?.network },
            { icon: <Hash className="h-5 w-5 text-primary" />,  label: "Chain ID",        value: chainStats?.chain_id?.toString() },
            { icon: <Blocks className="h-5 w-5 text-primary" />,label: "Latest Block",    value: chainStats ? `#${chainStats.latest_block}` : undefined },
            { icon: <FileCode2 className="h-5 w-5 text-primary" />, label: "Contract",    value: chainStats ? shorten(chainStats.contract_address) : undefined },
            { icon: <Sprout className="h-5 w-5 text-emerald-600" />, label: "Total Credits", value: chainStats ? chainStats.total_credits.toString() : undefined },
            { icon: <TreePine className="h-5 w-5 text-emerald-700" />, label: "Merkle Root", value: chainStats?.merkle_root ? shorten(chainStats.merkle_root, 8) : undefined, mono: true },
          ].map(({ icon, label, value }) => (
            <Card key={label} className="border border-border/70 bg-white shadow-sm">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  {icon}
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="mt-1 font-mono font-semibold break-all">{value ?? "—"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Activity feed + Credit lookup side by side on large screens */}
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">

          {/* Activity feed */}
          <Card className="border border-border/70 bg-white shadow-sm">
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="h-5 w-5 text-primary" /> Activity Feed
                <span className="ml-auto text-xs font-normal text-muted-foreground">live · refreshes every 5s</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                  <Activity className="h-10 w-10 opacity-20" />
                  <p className="text-sm">No activity yet. Mint a credit to see it appear here.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {events.map((ev, i) => (
                    <EventRow key={`${ev.tx_hash}-${i}`} event={ev} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Credit lookup */}
          <Card className="border border-border/70 bg-white shadow-sm">
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Search className="h-5 w-5 text-primary" /> Credit Lookup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              <form onSubmit={onLookup} className="flex flex-col gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lookup_credit_id">Credit ID</Label>
                  <Input id="lookup_credit_id" placeholder="CRED-XXXXXXXX" value={creditId}
                    onChange={(e) => setCreditId(e.target.value)} />
                </div>
                <Button type="submit" disabled={searching} className="w-full">
                  {searching ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching</> : "Lookup"}
                </Button>
              </form>

              {creditData && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-mono">{creditData.credit_id}</Badge>
                      <Badge className={`border ${creditData.is_retired ? "border-gray-200 bg-gray-100 text-gray-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                        {creditData.is_retired ? "RETIRED" : "ACTIVE"}
                      </Badge>
                      {(() => {
                        const c = riskColor(creditData.ai_risk_score);
                        return <Badge className={`border ${c.border} ${c.bg} ${c.text}`}>{c.label}</Badge>;
                      })()}
                    </div>

                    {(() => {
                      const c = riskColor(creditData.ai_risk_score);
                      return (
                        <div className={`flex items-center justify-between rounded-xl border ${c.border} ${c.bg} px-5 py-4`}>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Fraud Risk</p>
                            <p className={`mt-1 text-3xl font-bold ${c.text}`}>{creditData.ai_risk_score.toFixed(4)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Scaled (×10000)</p>
                            <p className="font-mono font-semibold">{creditData.ai_risk_score_scaled}</p>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { label: "Tonnes CO₂",       value: creditData.tonnes.toLocaleString() },
                        { label: "Developer ID",      value: creditData.developer_id },
                        { label: "Regulator ID",      value: creditData.regulator_id },
                        { label: "Owner",             value: shorten(creditData.owner) },
                      ].map(({ label, value }) => (
                        <div key={label} className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="mt-0.5 font-mono text-sm font-medium break-all">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Merkle Proof section */}
                    <Separator />
                    <div className="space-y-3">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <TreePine className="h-4 w-4 text-emerald-600" /> Merkle Inclusion Proof
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Cryptographically prove this credit exists in the on-chain Merkle tree without revealing other credits.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        onClick={onGetProof}
                        disabled={proofLoading}
                      >
                        {proofLoading ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Computing…</> : "Get Merkle Proof"}
                      </Button>

                      {proofError && (
                        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{proofError}</p>
                      )}

                      {proofData && (
                        <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                          <div className="grid gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Leaf Hash</span>
                              <p className="mt-0.5 break-all font-mono text-emerald-800">{proofData.leaf_hash}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Merkle Root</span>
                              <p className="mt-0.5 break-all font-mono text-emerald-800">{proofData.merkle_root}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Proof path ({proofData.proof_length} sibling{proofData.proof_length !== 1 ? "s" : ""}, leaf #{proofData.leaf_index} of {proofData.total_credits})
                              </span>
                              {proofData.proof.length === 0 ? (
                                <p className="mt-0.5 font-mono text-muted-foreground/60 italic">[ ] — single-leaf tree, root = leaf</p>
                              ) : (
                                <ul className="mt-1 space-y-1">
                                  {proofData.proof.map((p, i) => (
                                    <li key={i} className="break-all font-mono text-emerald-800">
                                      [{i}] {p}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>

                          <Button
                            size="sm"
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={onVerifyOnChain}
                            disabled={verifyLoading}
                          >
                            {verifyLoading
                              ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Verifying on-chain…</>
                              : <><ShieldCheck className="mr-2 h-3 w-3" />Verify On-Chain</>
                            }
                          </Button>

                          {verifyResult !== null && (
                            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                              verifyResult
                                ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                                : "border-red-300 bg-red-100 text-red-800"
                            }`}>
                              <ShieldCheck className="h-4 w-4 shrink-0" />
                              {verifyResult
                                ? "✓ Verified — contract confirms this credit is in the Merkle tree"
                                : "✗ Verification failed — leaf not found in Merkle tree"
                              }
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
