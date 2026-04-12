"""
VeridiumAI — FastAPI Application (Ethereum edition)
=====================================================
The custom Python blockchain layer has been replaced with a Solidity smart
contract (ethereum/contracts/CarbonCredit.sol) deployed on a local Hardhat
node (http://127.0.0.1:8545).

This backend is now responsible ONLY for:
  1. Validating requests.
  2. Running the Isolation Forest ML risk scorer.
  3. Calling issueCredit() on the Solidity contract via web3.py.

Transfer and Retire are handled directly by the Next.js frontend using
MetaMask + ethers.js (see Claude.md section 10 – Step 4).
"""

import uuid
import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from web3 import Web3

from ml.model import score_project

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Veridium Mesh API",
    version="2.0.0",
    description=(
        "AI-powered carbon credit fraud detection – Ethereum edition. "
        "Issues credits via a Solidity smart contract on a local Hardhat node."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Ethereum / web3.py setup
# ---------------------------------------------------------------------------

# Hardhat local node — always at this address when you run `npx hardhat node`
HARDHAT_RPC = "http://127.0.0.1:8545"

# Account #0 from the Hardhat node (publicly known test key — never use on mainnet)
DEPLOYER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Address where CarbonCredit.sol was deployed.
# Re-run `npx hardhat run scripts/deploy.js --network localhost` if you restart
# the Hardhat node — the node resets state on restart and this address changes.
CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"

# Load ABI from the Hardhat compilation artifact
_ARTIFACT_PATH = Path(__file__).resolve().parent.parent / (
    "ethereum/artifacts/contracts/CarbonCredit.sol/CarbonCredit.json"
)


def _load_contract():
    """Connect to the local Hardhat node and return the contract instance."""
    w3 = Web3(Web3.HTTPProvider(HARDHAT_RPC))
    if not w3.is_connected():
        raise RuntimeError(
            "Cannot connect to Hardhat node at http://127.0.0.1:8545. "
            "Run: cd ethereum && npx hardhat node"
        )
    with open(_ARTIFACT_PATH) as f:
        artifact = json.load(f)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS),
        abi=artifact["abi"],
    )
    return w3, contract


# Initialise once at startup (will raise if Hardhat node is not running)
try:
    _w3, _contract = _load_contract()
except Exception as _e:
    _w3 = None
    _contract = None
    print(f"[WARNING] Ethereum node not reachable at startup: {_e}")


def get_contract():
    """Return (w3, contract), reconnecting if needed."""
    global _w3, _contract
    if _w3 is None or not _w3.is_connected():
        try:
            _w3, _contract = _load_contract()
        except Exception as e:
            raise HTTPException(
                status_code=503,
                detail=f"Hardhat node unavailable: {e}",
            )
    return _w3, _contract


# ---------------------------------------------------------------------------
# Pydantic request schema
# ---------------------------------------------------------------------------


class MintRequest(BaseModel):
    project_id: str
    project_type: str
    tonnes: int
    vintage_year: int
    owner_id: str
    # Endorsement policy — both required (mirrors Solidity contract require() checks)
    developer_id: str
    regulator_id: str
    # Optional ML features — auto-computed from project_type/tonnes if absent
    r_ratio: Optional[float] = None
    m_flag: Optional[int] = None
    t_flag: Optional[int] = None

    @field_validator("project_id", "project_type", "owner_id", "developer_id", "regulator_id")
    @classmethod
    def not_blank(cls, v: str, info) -> str:
        if not v or not v.strip():
            raise ValueError(f"{info.field_name} must not be blank.")
        return v.strip()

    @field_validator("tonnes")
    @classmethod
    def positive_tonnes(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("tonnes must be a positive integer.")
        return v

    @field_validator("vintage_year")
    @classmethod
    def valid_vintage(cls, v: int) -> int:
        if v < 1990 or v > 2026:
            raise ValueError("vintage_year must be between 1990 and 2026.")
        return v


# ---------------------------------------------------------------------------
# Feature auto-computation
# ---------------------------------------------------------------------------

_HIGH_RISK_TYPES = {
    "Renewable Energy",
    "Hydro",
    "Hydropower",
    "Wind",
    "Biomass",
    "Fossil fuel replacement",
    "Solar",
    "Landfill Gas",
    "REDD+",
}
_PEER_AVERAGE_TONNES = 50_000


def auto_compute_features(project_type: str, tonnes: int) -> tuple[float, int, int]:
    m_flag = 1 if project_type in _HIGH_RISK_TYPES else 0
    r_ratio = round(max(0.1, tonnes / _PEER_AVERAGE_TONNES), 4)
    t_flag = 1 if r_ratio > 3.0 else 0
    return r_ratio, m_flag, t_flag


# ---------------------------------------------------------------------------
# POST /credits/issue — Score with ML then call issueCredit() on-chain
# ---------------------------------------------------------------------------


@app.post("/credits/issue", status_code=201)
def issue_credit(req: MintRequest):
    """
    1. Auto-compute ML features (or use supplied ones).
    2. Run Isolation Forest → risk_score ∈ [0, 1].
    3. Scale score → uint256 by multiplying × 10_000.
    4. Call issueCredit() on the Solidity contract.
    5. Return credit_id, risk_score, and tx hash.
    """
    w3, contract = get_contract()

    # Feature engineering
    vintage_age = 2026 - req.vintage_year
    if req.r_ratio is None or req.m_flag is None or req.t_flag is None:
        r_ratio, m_flag, t_flag = auto_compute_features(req.project_type, req.tonnes)
    else:
        r_ratio, m_flag, t_flag = req.r_ratio, req.m_flag, req.t_flag

    computed_features = {
        "R_ratio": r_ratio,
        "Vintage_Age": vintage_age,
        "M_flag": m_flag,
        "T_flag": t_flag,
    }

    # ML scoring
    risk_score: float = score_project(computed_features)

    # Scale to uint256 (Solidity has no floats)
    ai_risk_score_int: int = int(round(risk_score * 10_000))

    credit_id = f"CRED-{uuid.uuid4().hex[:8].upper()}"

    # Build and send the transaction
    try:
        nonce = w3.eth.get_transaction_count(DEPLOYER_ADDRESS)
        tx = contract.functions.issueCredit(
            credit_id,
            req.tonnes,
            req.developer_id,
            req.regulator_id,
            ai_risk_score_int,
        ).build_transaction({
            "from": DEPLOYER_ADDRESS,
            "nonce": nonce,
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = w3.eth.account.sign_transaction(tx, private_key=DEPLOYER_PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    if receipt.status != 1:
        raise HTTPException(status_code=500, detail="Transaction reverted on-chain.")

    return {
        "credit_id": credit_id,
        "ai_risk_score": risk_score,
        "ai_risk_score_scaled": ai_risk_score_int,
        "computed_features": computed_features,
        "owner_id": req.owner_id,
        "tonnes": req.tonnes,
        "tx_hash": tx_hash.hex(),
        "block_number": receipt.blockNumber,
        "contract_address": CONTRACT_ADDRESS,
        "status": "minted",
    }


# ---------------------------------------------------------------------------
# GET /credits/{credit_id} — Read credit state from the contract
# ---------------------------------------------------------------------------


@app.get("/credits/{credit_id}")
def get_credit(credit_id: str):
    """Fetch a credit's current state from the Solidity contract."""
    w3, contract = get_contract()

    try:
        exists = contract.functions.doesCreditExist(credit_id).call()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    if not exists:
        raise HTTPException(status_code=404, detail=f"Credit '{credit_id}' not found.")

    try:
        (tonnes, dev_id, reg_id, ai_risk_score_int, owner, is_retired) = (
            contract.functions.getCredit(credit_id).call()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    return {
        "credit_id": credit_id,
        "tonnes": tonnes,
        "developer_id": dev_id,
        "regulator_id": reg_id,
        "ai_risk_score": ai_risk_score_int / 10_000,
        "ai_risk_score_scaled": ai_risk_score_int,
        "owner": owner,
        "is_retired": is_retired,
    }


# ---------------------------------------------------------------------------
# GET /chain/stats — Read network stats from the Ethereum node
# ---------------------------------------------------------------------------


@app.get("/chain/stats")
def get_chain_stats():
    """Return basic stats from the connected Ethereum node."""
    w3, _ = get_contract()
    return {
        "network": "Hardhat Local",
        "chain_id": w3.eth.chain_id,
        "latest_block": w3.eth.block_number,
        "contract_address": CONTRACT_ADDRESS,
        "node_url": HARDHAT_RPC,
    }

