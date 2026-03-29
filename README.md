# VeridiumAI — AI-Powered Carbon Credit Fraud Detection on Blockchain

> A decentralized system that combines an Isolation Forest anomaly-detection model with a custom Proof-of-Work blockchain to flag fraudulent carbon credits before they are issued.

---

## Project Description

Carbon credit markets suffer from widespread fraud: inflated issuance volumes, double-counting, and bogus project types. **VeridiumAI** addresses this by:

1. **Scoring every credit** with a trained Isolation Forest model before it touches the chain.
2. **Enforcing a dual-approval endorsement policy** — both a project developer and a government regulator must sign off before any credit can be minted.
3. **Writing the AI risk score into an immutable block** so auditors can verify that all on-chain credits were screened.
4. **Providing a full audit trail** — every transaction for a credit is traceable back to its block.
5. **Providing a developer console and blockchain explorer** via a Next.js frontend so any user can mint, transfer, retire, and inspect credits in real time.

The dataset used is the **Berkeley Voluntary Registry Offsets Database (VROD)** — a public dataset of ~5,700 real-world carbon credit projects used to train the anomaly detector.

---

## Repository Structure

```
veridium-ai/
├── api/                  # FastAPI backend (REST endpoints)
│   └── app.py
├── blockchain/           # Custom PoW blockchain (Python)
│   ├── block.py          # Block + SHA-256 mining + serialisation
│   ├── blockchain.py     # Blockchain infrastructure (mining, persistence, validation)
│   ├── contract.py       # Smart contract (credit lifecycle + endorsement policy)
│   └── types.py          # Transaction type constants
├── ml/                   # Machine-learning layer
│   ├── train_isoforest.py
│   ├── model.py          # score_project() inference helper
│   ├── isoforest.joblib  # Trained model artifact
│   ├── scaler.joblib
│   └── norm_params.joblib
├── tests/                # Unit tests (pytest)
│   ├── test_blockchain.py
│   ├── test_api.py
│   └── test_model.py
├── data/                 # Datasets, EDA/feature plots, chain persistence
├── notebooks/            # Jupyter EDA and feature-engineering notebooks
├── scripts/              # Utility scripts
├── frontend/             # Next.js 16 + Tailwind + shadcn/ui
│   └── src/
│       ├── app/
│       │   ├── page.tsx          # Landing page (live stats)
│       │   ├── developer/        # Developer console
│       │   └── explorer/         # Blockchain explorer
│       └── lib/api.ts            # Typed API client
└── requirements.txt      # Python dependencies
```

---

## Dependencies & Setup

### Backend (Python 3.11+)

```bash
# 1. Create and activate virtual environment
python3 -m venv veridium
source veridium/bin/activate      # macOS/Linux
# veridium\Scripts\activate       # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the API server
PYTHONPATH=. python -m uvicorn api.app:app --reload --port 8000
```

API will be available at `http://localhost:8000`
Interactive docs at `http://localhost:8000/docs`

### Frontend (Node 18+)

```bash
cd frontend
npm install
npm run dev      # development
npm run build    # production build
```

Frontend will be available at `http://localhost:3000`

### Running Tests

```bash
PYTHONPATH=. python -m pytest tests/ -v
```

### Re-training the ML model (optional)

```bash
PYTHONPATH=. python ml/train_isoforest.py
```

---

## How to Use

1. Start the **backend** (`uvicorn` on port 8000).
2. Start the **frontend** (`npm run dev` on port 3000).
3. Open `http://localhost:3000` → click **Developer Console**.
4. Fill in Project ID, Project Type, Tonnes, Vintage Year, Owner ID, Developer ID, and Regulator ID.
5. Click **Score + Mint Credit**. The backend enforces the endorsement policy (both developer and regulator required), auto-computes risk features, runs the Isolation Forest model, and writes the result to the blockchain.
6. View the AI risk score, auto-computed features, and block metadata in the console panel.
7. Use **Transfer** to move credit units between owners, or **Retire** to permanently burn a credit.
8. Open the **Explorer** page to look up any credit by ID, view the full chain, and validate chain integrity.

---

## Smart Contract — `CarbonCreditContract` (`blockchain/contract.py`)

The smart contract is implemented as a Python class that enforces all business rules, validation checks, and state transitions for the carbon credit lifecycle. It is analogous to chaincode in Hyperledger Fabric or a Solidity contract on the EVM.

### Contract Functions

```python
class CarbonCreditContract:

    def check_endorsement(self, developer_id, regulator_id):
        """
        Dual-approval endorsement policy.
        Both a project developer and a government regulator must provide
        their identifiers before any credit can be minted. Mirrors the
        endorsement policies in Hyperledger Fabric where multiple
        organisations must sign off before a transaction is committed.
        """

    def execute(self, tx: dict):
        """
        Single entry point for all state mutations — equivalent to the
        Invoke() function in Hyperledger Fabric chaincode. Routes to:
          - _mint_credit()
          - _transfer_credit()
          - _retire_credit()
        """

    def _mint_credit(self, tx):
        """
        Register a new carbon credit on the ledger.
        Creates a credit record with status 'active' and assigns all
        tonnes to the issuing owner. AI risk score is stored on-chain.
        """

    def _transfer_credit(self, tx):
        """
        Move ownership units between participants.
        Reverts if credit is retired (prevents post-retirement transfers)
        or sender has insufficient balance (prevents double-spending).
        """

    def _retire_credit(self, tx):
        """
        Permanently burn a credit. Sets status to 'retired' — irreversible.
        Reverts if caller holds 0 units.
        """

    def query_credit(self, credit_id) -> dict:
        """Look up credit metadata by ID."""

    def query_ownership(self, credit_id) -> dict:
        """Return current ownership map {owner_id: units} for a credit."""
```

### State Stores

| Store | Key | Value |
|-------|-----|-------|
| `credits` | `credit_id` | `{tonnes, project_type, vintage_year, ai_risk_score, status}` |
| `ownership` | `(credit_id, owner_id)` | `units held` |

---

## Blockchain Infrastructure — `Blockchain` (`blockchain/blockchain.py`)

The blockchain layer handles block creation, Proof-of-Work mining, chain validation, persistence, and query operations. All business logic is delegated to the `CarbonCreditContract`.

```python
class Blockchain:

    def mine_pending_transactions(self) -> Block:
        """
        Bundle pending transactions into a new Block, mine it (PoW),
        append to the chain, execute each transaction via the smart
        contract, persist to disk, and clear the pending queue.
        """

    def is_chain_valid(self) -> bool:
        """
        Walk the full chain and verify:
        1. Each block's merkle root matches its recomputed merkle root.
        2. Each block's stored hash matches its recomputed hash.
        3. Each block's previous_hash matches the prior block's hash.
        Returns False on any inconsistency (tamper detection).
        """

    def get_credit_history(self, credit_id) -> list[dict]:
        """
        Audit trail: walk the entire chain and return every transaction
        for a given credit, annotated with block_index and block_hash.
        """

    def get_stats(self) -> dict:
        """
        Live statistics: total credits, active, retired, fraud-flagged
        (risk >= 0.8), total transactions, and chain length.
        """
```

### Persistence

The chain auto-saves to `data/chain.json` after every mine operation and reloads on startup, replaying all transactions to rebuild state. This ensures the ledger survives server restarts.

---

## Block — `Block` (`blockchain/block.py`)

```python
class Block:

    def calculate_merkle_root(self) -> str:
        """SHA-256 hash of all transactions (JSON-serialised, keys sorted)."""

    def calculate_hash(self) -> str:
        """SHA-256 over (index + timestamp + merkle_root + previous_hash + nonce)."""

    def mine_block(self, difficulty: int):
        """Proof-of-Work: increment nonce until hash starts with `difficulty` zeros."""

    def to_dict(self) -> dict:
        """Serialise block to a JSON-compatible dict for persistence."""

    @classmethod
    def from_dict(cls, data: dict) -> Block:
        """Reconstruct a Block from a serialised dict."""
```

---

## AI Scoring Layer — `score_project()` (`ml/model.py`)

Runs the trained Isolation Forest model to produce a fraud risk score (0–1) before a credit is written to the chain.

```python
def score_project(features: dict) -> float:
    """
    Input features (auto-computed by the API):
      - R_ratio:     Issuance volume relative to peer average
      - Vintage_Age: Years since the project vintage year
      - M_flag:      1 if project type is historically high-risk
      - T_flag:      1 if issuance volume spikes relative to baseline

    Returns a risk score in [0.0, 1.0].
    Higher = more anomalous = higher fraud risk.
    Threshold >= 0.8 → HIGH RISK (flagged).
    """
```

---

## REST API Endpoints (`api/app.py`)

All endpoints include input validation (positive tonnes, vintage year 1990–2026, non-blank IDs).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/credits/issue` | Enforce endorsement policy, auto-compute risk features, run AI scoring, mint credit, mine block |
| `POST` | `/credits/transfer` | Transfer ownership units between participants |
| `POST` | `/credits/retire` | Permanently retire (burn) a credit |
| `GET` | `/credits/{credit_id}` | Look up credit metadata and current ownership |
| `GET` | `/credits/{credit_id}/history` | Full audit trail of all transactions for a credit |
| `GET` | `/chain/stats` | Live statistics (total credits, flagged, active, retired, etc.) |
| `GET` | `/chain/validate` | Verify chain integrity (returns `is_valid` + `chain_length`) |
| `GET` | `/chain` | Serialised view of all blocks |

---

## Transaction Type Constants (`blockchain/types.py`)

```python
MINT_CREDIT     = "MINT_CREDIT"      # Issue a new carbon credit
TRANSFER_CREDIT = "TRANSFER_CREDIT"  # Move units between owners
RETIRE_CREDIT   = "RETIRE_CREDIT"    # Permanently burn a credit
```

---

## Tests

32 unit tests covering:

- **Blockchain**: mint, transfer, retire, double-spend prevention, chain validation, tamper detection, credit history, chain stats, endorsement policy
- **API**: input validation (blank fields, negative values, bad vintage years), endorsement enforcement, all CRUD endpoints, history and stats endpoints
- **ML Model**: score range validation, suspicious vs normal project scoring, edge cases

```bash
PYTHONPATH=. python -m pytest tests/ -v
```

---

## Team

| # | Name | Role |
|---|------|------|
| 1 | **Harpreet Kaur Brar** | Chaincode and asset layer — asset modeling, project submission, and query functions. Additionally: frontend/UI development. |
| 2 | **Sreeram Saravana Prasad** | Credit creation (minting logic), validation checks, and integration of AI risk scores. Additionally: frontend/UI development. |
| 3 | **Asmi Umesh Pulgam** | Ownership updates and transaction handling. Additionally: project report creation. |
| 4 | **Brijesh Kumar** | Credit retirement logic and double-spending prevention. Additionally: frontend/UI development. |
| 5 | **Vandhana Vemuri** | Audit functions, history tracking, and endorsement policy configuration. Additionally: project report creation. |
