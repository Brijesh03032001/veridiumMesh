# VeridiumAI — AI-Powered Carbon Credit Fraud Detection on Blockchain

> A decentralized system that combines an Isolation Forest anomaly-detection model with a custom Proof-of-Work blockchain to flag fraudulent carbon credits before they are issued.

---

## Project Description

Carbon credit markets suffer from widespread fraud: inflated issuance volumes, double-counting, and bogus project types. **VeridiumAI** addresses this by:

1. **Scoring every credit** with a trained Isolation Forest model before it touches the chain.
2. **Writing the AI risk score into an immutable block** so auditors can verify that all on-chain credits were screened.
3. **Providing a developer console and blockchain explorer** via a Next.js frontend so any user can mint, transfer, retire, and inspect credits in real time.

The dataset used is the **Berkeley Voluntary Registry Offsets Database (VROD)** — a public dataset of ~5,700 real-world carbon credit projects used to train the anomaly detector.

---

## Repository Structure

```
veridium-ai/
├── api/                  # FastAPI backend (REST endpoints)
│   └── app.py
├── blockchain/           # Custom PoW blockchain (Python)
│   ├── block.py          # Block + SHA-256 mining
│   ├── blockchain.py     # Blockchain state machine
│   └── types.py          # Transaction type constants
├── ml/                   # Machine-learning layer
│   ├── train_isoforest.py
│   ├── model.py          # score_project() inference helper
│   ├── isoforest.joblib  # Trained model artifact
│   ├── scaler.joblib
│   └── norm_params.joblib
├── data/                 # Datasets and EDA/feature plots
├── notebooks/            # Jupyter EDA and feature-engineering notebooks
├── scripts/              # Utility scripts
├── frontend/             # Next.js 16 + Tailwind + shadcn/ui
│   └── src/
│       ├── app/
│       │   ├── page.tsx          # Landing page
│       │   ├── developer/        # Developer console
│       │   └── explorer/         # Blockchain explorer
│       └── lib/api.ts            # Typed API client
└── veridium/             # Python virtual environment
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
pip install fastapi uvicorn scikit-learn joblib numpy pandas pydantic

# 3. Start the API server
PYTHONPATH=. veridium/bin/python -m uvicorn api.app:app --reload --port 8000
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

### Re-training the ML model (optional)

```bash
PYTHONPATH=. veridium/bin/python ml/train_isoforest.py
```

---

## How to Use / Deploy

1. Start the **backend** (`uvicorn` on port 8000).
2. Start the **frontend** (`npm run dev` on port 3000).
3. Open `http://localhost:3000` → click **Developer Console**.
4. Fill in Project ID, Project Type, Tonnes, Vintage Year, Owner ID and click **Score + Mint Credit**.
5. The backend auto-computes risk features, runs the Isolation Forest model, and writes the result to the blockchain.
6. View the AI risk score and computed features in the console panel.
7. Use **Transfer** or **Retire** to move or burn credits.
8. Open the **Explorer** page to look up any credit by ID and inspect the full chain.

---

## Draft Contract / Code

*In this system the "contract" is implemented as a Python blockchain state machine rather than an on-chain Solidity contract. The components below define the rules, data structures, and transaction logic that govern how carbon credits are created, transferred, and retired — analogous to the functions of a smart contract.*

---

### Component 1 — `Block` (`blockchain/block.py`)

**Purpose:** Represents one immutable unit of the chain. Stores transactions and enforces integrity via SHA-256 Proof-of-Work mining.

```python
class Block:
    def __init__(self, index: int, transactions: list,
                 previous_hash: str, nonce: int = 0):
        """
        Create a new block.
        - index:         position in the chain (0 = genesis)
        - transactions:  list of transaction dicts included in this block
        - previous_hash: hash of the preceding block (links the chain)
        - nonce:         incremented during mining to satisfy difficulty target
        """

    def calculate_merkle_root(self) -> str:
        """
        SHA-256 hash of all transactions (JSON-serialised, keys sorted).
        Ensures any tampering with transaction data invalidates the block hash.
        """

    def calculate_hash(self) -> str:
        """
        SHA-256 over (index + timestamp + merkle_root + previous_hash + nonce).
        Uniquely fingerprints this block's content.
        """

    def mine_block(self, difficulty: int):
        """
        Proof-of-Work: increment nonce until hash starts with `difficulty` zeros.
        Prevents cheap block forgery.
        """
```

---

### Component 2 — `Blockchain` (`blockchain/blockchain.py`)

**Purpose:** The state machine that owns all credit records, enforces business rules, and maintains the append-only chain.

```python
class Blockchain:
    def __init__(self, difficulty: int = 2):
        """
        Initialise with an empty chain and create the genesis block.
        - credits:    dict mapping credit_id → metadata (tonnes, type, status)
        - ownership:  dict mapping (credit_id, owner_id) → units held
        """

    def apply_transaction(self, tx: dict):
        """
        Execute one of three transaction types and mutate state accordingly:

        MINT_CREDIT  — registers a new credit and assigns all tonnes to the issuer.
                       Requires: credit_id, owner_id, tonnes, project_type,
                                 vintage_year, ai_risk_score.

        TRANSFER_CREDIT — moves `units` from from_owner to to_owner.
                          Reverts if credit is retired or sender lacks sufficient units.

        RETIRE_CREDIT  — permanently marks a credit as 'retired';
                         units can no longer be transferred.
                         Reverts if the caller holds 0 units.
        """

    def mine_pending_transactions(self) -> Block:
        """
        Bundle all pending transactions into a new Block, mine it (PoW),
        append it to the chain, and clear the pending queue.
        Returns the newly mined Block.
        """

    def is_chain_valid(self) -> bool:
        """
        Walk the full chain and verify:
        1. Each block's stored hash matches its recomputed hash.
        2. Each block's previous_hash matches the actual hash of the prior block.
        Returns False on any inconsistency (tamper detection).
        """
```

---

### Component 3 — Transaction Type Constants (`blockchain/types.py`)

```python
MINT_CREDIT     = "MINT_CREDIT"      # Issue a new carbon credit
TRANSFER_CREDIT = "TRANSFER_CREDIT"  # Move units between owners
RETIRE_CREDIT   = "RETIRE_CREDIT"    # Permanently burn a credit
```

---

### Component 4 — AI Scoring Layer (`ml/model.py`)

**Purpose:** Runs the trained Isolation Forest model to produce a fraud risk score (0–1) before a credit is written to the chain.

```python
def score_project(
    r_ratio: float,       # Issuance volume relative to peer average
    vintage_age: int,     # Years since the project vintage year
    m_flag: int,          # 1 if project type is historically high-risk
    t_flag: int           # 1 if issuance volume spikes relative to baseline
) -> float:
    """
    Normalise inputs, apply the pre-trained IsolationForest,
    and return a risk score in [0, 1].
    Higher score = more anomalous = higher fraud risk.
    Threshold ≥ 0.8 → HIGH RISK (flagged).
    """
```

---

### Component 5 — REST API (`api/app.py`)

**Purpose:** FastAPI layer that wires the AI model to the blockchain and exposes HTTP endpoints for the frontend.

```python
POST /credits/issue
    """
    Auto-compute risk features from project_type and tonnes,
    call score_project(), and — if accepted — mint the credit
    and mine a new block. Returns the credit_id, ai_risk_score,
    computed_features, block_index, and block_hash.
    """

POST /credits/transfer
    """
    Validate ownership, apply a TRANSFER_CREDIT transaction,
    and mine a new block.
    """

POST /credits/retire
    """
    Permanently retire a credit by applying a RETIRE_CREDIT
    transaction and mining a block.
    """

GET /credits/{credit_id}
    """
    Look up the on-chain metadata for a credit by its ID.
    """

GET /chain/validate
    """
    Run is_chain_valid() and return True/False plus the chain length.
    """

GET /chain
    """
    Return a serialised view of all blocks in the chain.
    """
```

---

## Team

| # | Name | Role |
|---|------|------|
| 1 | **Harpreet Kaur Brar** | Primary responsibility: chaincode and asset layer — asset modeling, project submission, and query functions. Additionally: frontend/UI development. |
| 2 | **Sreeram Saravana Prasad** | Credit creation (minting logic), validation checks, and integration of AI risk scores. Additionally: frontend/UI development. |
| 3 | **Asmi Umesh Pulgam** | Ownership updates and transaction handling. Additionally: project report creation. |
| 4 | **Brijesh Kumar** | Credit retirement logic and double-spending prevention. Additionally: frontend/UI development. |
| 5 | **Vandhana Vemuri** | Audit functions, history tracking, and endorsement policy configuration. Additionally: project report creation. |


