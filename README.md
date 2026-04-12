# VeridiumAI — AI-Powered Carbon Credit Fraud Detection on Ethereum

> A decentralized system that combines an Isolation Forest anomaly-detection model with an Ethereum smart contract (Solidity) to flag and permanently record fraudulent carbon credits on-chain.

---

## Project Description

Carbon credit markets suffer from widespread fraud: inflated issuance volumes, double-counting, and bogus project types. **VeridiumAI** addresses this by:

1. **Scoring every credit** with a trained Isolation Forest model before it touches the chain.
2. **Enforcing a dual-approval endorsement policy** — both a project developer and a government regulator must be provided before any credit can be minted.
3. **Writing the AI risk score into an immutable Ethereum smart contract** so auditors can verify that all on-chain credits were screened.
4. **Providing a full audit trail** via Ethereum event logs (`CreditIssued`, `CreditTransferred`, `CreditRetired`).
5. **Providing a developer console and blockchain explorer** via a Next.js frontend so any user can mint, transfer, retire, and inspect credits in real time.

The dataset used is the **Berkeley Voluntary Registry Offsets Database (VROD)** — a public dataset of ~5,700 real-world carbon credit projects used to train the anomaly detector.

---

## Repository Structure

```
veridium-ai/
├── api/
│   └── app.py                  # FastAPI backend: ML scoring + Ethereum issueCredit()
├── ethereum/                   # Hardhat project (Ethereum smart contract)
│   ├── contracts/
│   │   └── CarbonCredit.sol    # Solidity smart contract (issueCredit / transferCredit / retireCredit)
│   ├── scripts/
│   │   └── deploy.js           # Hardhat deploy script
│   ├── test/
│   │   └── CarbonCredit.test.js # 14 unit tests for the contract
│   └── hardhat.config.js
├── ml/
│   ├── model.py                # score_project() — Isolation Forest inference
│   ├── train_isoforest.py      # Training script
│   ├── isoforest.joblib        # Trained model artifact
│   ├── scaler.joblib
│   └── norm_params.joblib
├── frontend/                   # Next.js 16 + Tailwind + shadcn/ui
│   └── src/app/
│       ├── page.tsx            # Landing page (live chain stats)
│       ├── developer/page.tsx  # Developer console (mint / transfer / retire)
│       └── explorer/page.tsx   # Blockchain explorer (lookup by credit ID)
├── tests/                      # Python unit tests (pytest)
├── data/                       # Berkeley VROD CSVs + EDA/feature plots
├── notebooks/                  # Jupyter EDA and feature-engineering notebooks
├── scripts/                    # Utility scripts (feature engineering, EDA)
└── requirements.txt
```

---

## How to Run

### Step 1 — Start the Hardhat local Ethereum node

```bash
cd ethereum
npx hardhat node
# Starts at http://127.0.0.1:8545
# Pre-funds 20 accounts with 10,000 ETH each (test only)
```

### Step 2 — Deploy the smart contract (run once per node session)

```bash
cd ethereum
npx hardhat run scripts/deploy.js --network localhost
# Prints: ✅ CarbonCredit deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

> **Note:** If you restart the Hardhat node, redeploy and update `CONTRACT_ADDRESS` in `api/app.py`.

### Step 3 — Start the FastAPI backend

```bash
# From project root
source veridium/bin/activate
PYTHONPATH=. python -m uvicorn api.app:app --reload --port 8000
```

API docs: http://127.0.0.1:8000/docs

### Step 4 — Start the frontend (optional)

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:3000

### Running Python Tests

```bash
PYTHONPATH=. python -m pytest tests/ -v
```

### Running Solidity Contract Tests

```bash
cd ethereum
npx hardhat test
```

---

## Smart Contract — `CarbonCredit.sol`

Deployed on a local Hardhat Ethereum node. Written in Solidity ^0.8.20. All business logic that was previously in the Python `CarbonCreditContract` class is now enforced on-chain.

### Functions

| Function | Who calls it | Description |
|---|---|---|
| `issueCredit(creditId, tonnes, developerId, regulatorId, aiRiskScore)` | FastAPI backend | Mints a new credit. Enforces dual-endorsement policy. Stores AI risk score (×10,000). |
| `transferCredit(creditId, to)` | Credit owner (via frontend / MetaMask) | Transfers ownership to a new Ethereum address. Reverts if retired. |
| `retireCredit(creditId)` | Credit owner (via frontend / MetaMask) | Permanently retires (burns) a credit. Irreversible. |
| `getCredit(creditId)` | Anyone | Returns `(tonnes, owner, isRetired, aiRiskScore, developerId, regulatorId)`. |

### Events (Audit Trail)

| Event | Emitted when |
|---|---|
| `CreditIssued(creditId, owner, tonnes, aiRiskScore, developerId, regulatorId)` | Credit is minted |
| `CreditTransferred(creditId, from, to)` | Credit changes owner |
| `CreditRetired(creditId, owner)` | Credit is retired |

### Risk Score Encoding

AI risk score is stored as `uint256 = float × 10,000` to avoid floating-point in Solidity.  
Example: `0.8451` → stored as `8451`. Divide by `10,000` to recover the float.

---

## REST API Endpoints (`api/app.py`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/credits/issue` | ML scores the project → calls `issueCredit()` on the Solidity contract |
| `GET` | `/credits/{credit_id}` | Reads credit state from the contract (tonnes, owner, isRetired, aiRiskScore) |
| `GET` | `/chain/stats` | Live stats from Ethereum node (chainId, latest block, contract address) |

Transfer and Retire are called directly from the browser via MetaMask + ethers.js (no server roundtrip needed).

---

## AI Scoring Layer — `score_project()` (`ml/model.py`)

```python
def score_project(features: dict) -> float:
    """
    Input features (auto-computed by the API from project_type + tonnes):
      - R_ratio:     tonnes / 50,000  (inflation vs peer average)
      - Vintage_Age: 2026 - vintage_year
      - M_flag:      1 if project type is historically high-risk (Solar, REDD+, Wind, etc.)
      - T_flag:      1 if R_ratio > 3.0 (extreme volume spike)

    Returns a risk score in [0.0, 1.0].
    Higher = more anomalous = higher fraud risk.
    Score >= 0.7 → HIGH RISK.
    """
```

**Example scores:**
- Cookstoves project, 5,000 tonnes, recent: `0.25` ✅ Low risk
- Solar project, 600,000 tonnes, 18-year-old vintage: `0.85` 🚨 High risk

---

## Blockchain Principles Demonstrated

| Principle | Where |
|---|---|
| Immutable ledger | Ethereum — every transaction is permanently recorded on-chain |
| Smart contract | `CarbonCredit.sol` — enforces all credit lifecycle rules in Solidity |
| Endorsement policy | `issueCredit()` requires non-empty `developerId` + `regulatorId` |
| Digital signatures | MetaMask / Ethereum accounts — only the key owner can transfer or retire |
| Audit trail | Ethereum event logs (`CreditIssued`, `CreditTransferred`, `CreditRetired`) |
| Consensus | Hardhat local node (PoA); deployable to any EVM-compatible network |
| Fraud detection | Isolation Forest ML model — risk score stored permanently on-chain |

---

## Team

| # | Name | Role |
|---|------|------|
| 1 | **Harpreet Kaur Brar** | Chaincode and asset layer — asset modeling, project submission, and query functions. Additionally: frontend/UI development. |
| 2 | **Sreeram Saravana Prasad** | Credit creation (minting logic), validation checks, and integration of AI risk scores. Additionally: frontend/UI development. |
| 3 | **Asmi Umesh Pulgam** | Ownership updates and transaction handling. Additionally: project report creation. |
| 4 | **Brijesh Kumar** | Credit retirement logic and double-spending prevention. Additionally: frontend/UI development. |
| 5 | **Vandhana Vemuri** | Audit functions, history tracking, and endorsement policy configuration. Additionally: project report creation. |
