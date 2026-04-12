"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Info,
  Leaf,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  issueCredit,
  type MintPayload,
  type MintResponse,
} from "@/lib/api";

function riskColor(score: number) {
  if (score >= 0.7)
    return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", label: "HIGH RISK" };
  if (score >= 0.4)
    return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "MEDIUM RISK" };
  return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "LOW RISK" };
}

function sanitizeInt(v: string) {
  return v.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
}

type MintFormState = {
  project_id: string;
  project_type: string;
  tonnes: string;
  vintage_year: string;
  owner_id: string;
  developer_id: string;
  regulator_id: string;
};

const initialMint: MintFormState = {
  project_id: "VCS-001",
  project_type: "Cookstoves",
  tonnes: "5000",
  vintage_year: "2022",
  owner_id: "GreenCorp-Ltd",
  developer_id: "Dev-Org-Alpha",
  regulator_id: "GOV-EPA-001",
};

export default function DeveloperPage() {
  const [mintForm, setMintForm] = useState<MintFormState>(initialMint);
  const [mintResult, setMintResult] = useState<MintResponse | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onMintSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const payload: MintPayload = {
      project_id: mintForm.project_id.trim(),
      project_type: mintForm.project_type.trim(),
      tonnes: Number(mintForm.tonnes),
      vintage_year: Number(mintForm.vintage_year),
      owner_id: mintForm.owner_id.trim(),
      developer_id: mintForm.developer_id.trim(),
      regulator_id: mintForm.regulator_id.trim(),
    };

    try {
      const res = await issueCredit(payload);
      setMintResult(res);
      setMessage({ type: "ok", text: `✓ Credit ${res.credit_id} minted in block #${res.block_number} on Ethereum.` });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Mint request failed." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-100 via-green-50 to-emerald-100/80 px-6 py-10 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Developer Console</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground md:text-base">
              Submit carbon credit issuance requests. Each mint is AI-scored by the Isolation Forest model and permanently recorded on Ethereum.
            </p>
          </div>
          <Button variant="outline" onClick={() => (window.location.href = "/explorer")}>
            Open Explorer
          </Button>
        </div>

        {message && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${message.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
              }`}
          >
            {message.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {message.text}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-2">
          {/* ── Mint form ── */}
          <Card className="border border-border/70 bg-white shadow-sm">
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FlaskConical className="h-5 w-5 text-primary" /> Issue Carbon Credit
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={onMintSubmit} className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="project_id">Project ID</Label>
                  <Input
                    id="project_id"
                    placeholder="VCS-001"
                    value={mintForm.project_id}
                    onChange={(e) => setMintForm((p) => ({ ...p, project_id: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="project_type">Project Type</Label>
                  <Input
                    id="project_type"
                    placeholder="e.g. Cookstoves, Wind, REDD+"
                    value={mintForm.project_type}
                    onChange={(e) => setMintForm((p) => ({ ...p, project_type: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="tonnes">Tonnes of CO₂</Label>
                  <Input
                    id="tonnes"
                    inputMode="numeric"
                    placeholder="e.g. 500000"
                    value={mintForm.tonnes}
                    onChange={(e) =>
                      setMintForm((p) => ({ ...p, tonnes: sanitizeInt(e.target.value) }))
                    }
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="vintage_year">Vintage Year</Label>
                  <Input
                    id="vintage_year"
                    inputMode="numeric"
                    placeholder="e.g. 2011"
                    value={mintForm.vintage_year}
                    onChange={(e) =>
                      setMintForm((p) => ({ ...p, vintage_year: sanitizeInt(e.target.value) }))
                    }
                    required
                  />
                </div>

                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="owner_id">Owner ID</Label>
                  <Input
                    id="owner_id"
                    placeholder="e.g. GreenCorp-Ltd"
                    value={mintForm.owner_id}
                    onChange={(e) => setMintForm((p) => ({ ...p, owner_id: e.target.value }))}
                    required
                  />
                </div>

                {/* Endorsement policy: dual approval */}
                <div className="grid gap-2">
                  <Label htmlFor="developer_id">Developer ID (Endorsement)</Label>
                  <Input
                    id="developer_id"
                    placeholder="e.g. Dev-Org-Alpha"
                    value={mintForm.developer_id}
                    onChange={(e) => setMintForm((p) => ({ ...p, developer_id: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="regulator_id">Regulator ID (Gov. Approval)</Label>
                  <Input
                    id="regulator_id"
                    placeholder="e.g. GOV-EPA-001"
                    value={mintForm.regulator_id}
                    onChange={(e) => setMintForm((p) => ({ ...p, regulator_id: e.target.value }))}
                    required
                  />
                </div>

                <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-muted-foreground md:col-span-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  Risk features (R ratio, M flag, T flag, Vintage Age) are auto-computed by the AI engine. Both Developer <em>and</em> Regulator IDs are required by the Solidity endorsement policy.
                </div>

                <div className="md:col-span-2">
                  <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90">
                    {loading ? "Scoring + Minting on Ethereum…" : "Score & Mint Credit"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* ── AI Score + Ethereum result ── */}
          <Card className="border border-border/70 bg-white shadow-sm">
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-lg">AI Risk Score &amp; On-Chain Result</CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              {!mintResult ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <Leaf className="h-12 w-12 text-muted-foreground/30" />
                  <p className="text-sm">
                    Mint a credit to see the AI risk score,
                    <br />
                    computed features, and Ethereum transaction here.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Risk score hero */}
                  {(() => {
                    const c = riskColor(mintResult.ai_risk_score);
                    return (
                      <div className={`flex items-center justify-between rounded-xl border ${c.border} ${c.bg} px-5 py-4`}>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Fraud Risk</p>
                          <p className={`mt-1 text-4xl font-bold ${c.text}`}>{mintResult.ai_risk_score.toFixed(4)}</p>
                        </div>
                        <Badge className={`${c.bg} ${c.text} border ${c.border} px-3 py-1 text-sm`}>{c.label}</Badge>
                      </div>
                    );
                  })()}

                  {/* Auto-computed features */}
                  {mintResult.computed_features && (
                    <>
                      <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Auto-Computed ML Features</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">R Ratio</p>
                            <p className="mt-0.5 font-mono text-base font-semibold text-foreground">{mintResult.computed_features.R_ratio.toFixed(2)}×</p>
                          </div>
                          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">Vintage Age</p>
                            <p className="mt-0.5 font-mono text-base font-semibold text-foreground">{mintResult.computed_features.Vintage_Age} yrs</p>
                          </div>
                          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">M Flag</p>
                            <p className={`mt-0.5 font-mono text-base font-semibold ${mintResult.computed_features.M_flag ? "text-red-600" : "text-emerald-600"}`}>
                              {mintResult.computed_features.M_flag ? "1 — High-risk type" : "0 — Normal type"}
                            </p>
                          </div>
                          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                            <p className="text-muted-foreground">T Flag</p>
                            <p className={`mt-0.5 font-mono text-base font-semibold ${mintResult.computed_features.T_flag ? "text-red-600" : "text-emerald-600"}`}>
                              {mintResult.computed_features.T_flag ? "1 — Volume spike" : "0 — Normal issuance"}
                            </p>
                          </div>
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}

                  {/* Ethereum transaction details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Credit ID</span>
                      <span className="font-mono font-medium">{mintResult.credit_id}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Owner</span>
                      <span className="font-mono">{mintResult.owner_id}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Tonnes CO₂</span>
                      <span className="font-semibold">{mintResult.tonnes.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Block Number</span>
                      <span className="font-mono font-semibold text-primary">#{mintResult.block_number}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground">Tx Hash</span>
                      <span className="break-all font-mono text-xs text-foreground">{mintResult.tx_hash}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground">Contract</span>
                      <span className="break-all font-mono text-xs text-foreground">{mintResult.contract_address}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* MetaMask integration info */}
        <Card className="border border-emerald-100 bg-emerald-50/50">
          <CardContent className="flex items-start gap-4 pt-5">
            <Wallet className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
            <div>
              <p className="font-medium text-foreground">Transfer &amp; Retire via MetaMask</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ownership transfers and credit retirements are executed directly from your browser wallet using{" "}
                <strong>MetaMask + ethers.js</strong>. This connects directly to the{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">CarbonCredit.sol</code> contract at{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                  {mintResult?.contract_address ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3"}
                </code>{" "}
                — no API intermediary needed.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
