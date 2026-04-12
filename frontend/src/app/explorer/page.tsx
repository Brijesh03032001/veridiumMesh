"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, Globe, Hash, Blocks, FileCode2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  fetchChainStats,
  fetchCredit,
  type ChainStatsResponse,
  type CreditResponse,
} from "@/lib/api";

function riskColor(score: number) {
  if (score >= 0.7)
    return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "HIGH RISK" };
  if (score >= 0.4)
    return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "MEDIUM RISK" };
  return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "LOW RISK" };
}

function shorten(addr: string, n = 8) {
  if (addr.length <= n * 2 + 3) return addr;
  return `${addr.slice(0, n)}\u2026${addr.slice(-n)}`;
}

export default function ExplorerPage() {
  const [creditId, setCreditId] = useState("");
  const [creditData, setCreditData] = useState<CreditResponse | null>(null);
  const [chainStats, setChainStats] = useState<ChainStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);

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

  useEffect(() => {
    void loadStats();
  }, []);

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!creditId.trim()) return;
    setSearching(true);
    setError(null);
    setCreditData(null);
    try {
      const data = await fetchCredit(creditId.trim());
      setCreditData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to lookup credit.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-100 via-green-50 to-emerald-100/80 px-6 py-10 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Ledger Explorer</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
              Inspect the live Ethereum node and look up any carbon credit on-chain by its ID.
            </p>
          </div>
          <Button variant="outline" onClick={loadStats} disabled={loadingStats}>
            {loadingStats ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Refreshing
              </>
            ) : (
              "Refresh Stats"
            )}
          </Button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Chain stats cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border border-border/70 bg-white shadow-sm">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <Globe className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Network</p>
                  <p className="mt-1 font-semibold">{chainStats?.network ?? "\u2014"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/70 bg-white shadow-sm">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <Hash className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chain ID</p>
                  <p className="mt-1 font-mono font-semibold">{chainStats?.chain_id ?? "\u2014"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/70 bg-white shadow-sm">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <Blocks className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest Block</p>
                  <p className="mt-1 font-mono font-semibold text-primary">
                    {chainStats != null ? `#${chainStats.latest_block}` : "\u2014"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/70 bg-white shadow-sm">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <FileCode2 className="mt-0.5 h-5 w-5 text-primary" />
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contract</p>
                  <p className="mt-1 break-all font-mono text-xs text-foreground" title={chainStats?.contract_address}>
                    {chainStats ? shorten(chainStats.contract_address) : "\u2014"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Credit Lookup */}
        <Card className="border border-border/70 bg-white shadow-sm">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5 text-primary" /> Credit Lookup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <form onSubmit={onLookup} className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="lookup_credit_id">Credit ID</Label>
                <Input
                  id="lookup_credit_id"
                  placeholder="CRED-XXXXXXXX"
                  value={creditId}
                  onChange={(e) => setCreditId(e.target.value)}
                />
              </div>
              <div className="sm:self-end">
                <Button type="submit" disabled={searching} className="w-full sm:w-auto">
                  {searching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Searching
                    </>
                  ) : (
                    "Lookup"
                  )}
                </Button>
              </div>
            </form>

            {creditData && (
              <>
                <Separator />
                <div className="space-y-4">
                  {/* Status badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      {creditData.credit_id}
                    </Badge>
                    <Badge
                      className={`border ${creditData.is_retired ? "border-gray-200 bg-gray-100 text-gray-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
                    >
                      {creditData.is_retired ? "RETIRED" : "ACTIVE"}
                    </Badge>
                    {(() => {
                      const c = riskColor(creditData.ai_risk_score);
                      return (
                        <Badge className={`border ${c.border} ${c.bg} ${c.text}`}>
                          {c.label}
                        </Badge>
                      );
                    })()}
                  </div>

                  {/* Risk score banner */}
                  {(() => {
                    const c = riskColor(creditData.ai_risk_score);
                    return (
                      <div className={`flex items-center justify-between rounded-xl border ${c.border} ${c.bg} px-5 py-4`}>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Fraud Risk Score</p>
                          <p className={`mt-1 text-3xl font-bold ${c.text}`}>{creditData.ai_risk_score.toFixed(4)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Scaled (\u00d710000)</p>
                          <p className="font-mono font-semibold">{creditData.ai_risk_score_scaled}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Details grid */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs text-muted-foreground">Tonnes CO\u2082</p>
                      <p className="mt-0.5 text-lg font-semibold">{creditData.tonnes.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs text-muted-foreground">Developer ID</p>
                      <p className="mt-0.5 font-medium">{creditData.developer_id}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs text-muted-foreground">Regulator ID</p>
                      <p className="mt-0.5 font-medium">{creditData.regulator_id}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs text-muted-foreground">Owner (Ethereum)</p>
                      <p className="mt-0.5 break-all font-mono text-xs text-foreground">{creditData.owner}</p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
