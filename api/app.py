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


app = FastAPI(title="Veridium Mesh API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HARDHAT_RPC      = os.getenv("HARDHAT_RPC",         "http://127.0.0.1:8545")
DEPLOYER_ADDRESS = os.getenv("DEPLOYER_ADDRESS",    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
DEPLOYER_KEY     = os.getenv("DEPLOYER_PRIVATE_KEY","0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS",    "0x5FbDB2315678afecb367f032d93F642f64180aa3")

_ARTIFACT = Path(__file__).resolve().parent.parent / \
    "ethereum/artifacts/contracts/CarbonCredit.sol/CarbonCredit.json"

STAKEHOLDERS = {
    "GreenBuild Solutions":  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "EcoForest Initiative":  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "SolarVerde Projects":   "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "CarbonMarket Exchange": "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "BlueSky Offset Fund":   "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
}

_HIGH_RISK_TYPES = {
    "Renewable Energy", "Hydro", "Hydropower", "Wind", "Biomass",
    "Fossil fuel replacement", "Solar", "Landfill Gas", "REDD+",
}
_PEER_AVG_TONNES = 50_000


def _connect():
    w3 = Web3(Web3.HTTPProvider(HARDHAT_RPC))
    if not w3.is_connected():
        raise RuntimeError(f"Cannot reach Hardhat node at {HARDHAT_RPC}")
    with open(_ARTIFACT) as f:
        abi = json.load(f)["abi"]
    contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=abi)
    return w3, contract


try:
    _w3, _contract = _connect()
except Exception as _e:
    _w3 = _contract = None
    print(f"[WARNING] Ethereum node not available at startup: {_e}")


def get_contract():
    global _w3, _contract
    if _w3 is None or not _w3.is_connected():
        try:
            _w3, _contract = _connect()
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))
    return _w3, _contract


class MintRequest(BaseModel):
    project_id:   str
    project_type: str
    tonnes:       int
    vintage_year: int
    owner_id:     str
    developer_id: str
    regulator_id: str
    r_ratio:      Optional[float] = None
    m_flag:       Optional[int]   = None
    t_flag:       Optional[int]   = None

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
            raise ValueError("tonnes must be positive.")
        return v

    @field_validator("vintage_year")
    @classmethod
    def valid_vintage(cls, v: int) -> int:
        if v < 1990 or v > 2026:
            raise ValueError("vintage_year must be between 1990 and 2026.")
        return v


def _compute_features(project_type: str, tonnes: int) -> tuple[float, int, int]:
    r_ratio = round(max(0.1, tonnes / _PEER_AVG_TONNES), 4)
    m_flag  = 1 if project_type in _HIGH_RISK_TYPES else 0
    t_flag  = 1 if r_ratio > 3.0 else 0
    return r_ratio, m_flag, t_flag


@app.get("/stakeholders")
def get_stakeholders():
    return [{"name": name, "address": addr} for name, addr in STAKEHOLDERS.items()]


@app.post("/credits/issue", status_code=201)
def issue_credit(req: MintRequest):
    w3, contract = get_contract()

    owner_address = STAKEHOLDERS.get(req.owner_id)
    if not owner_address:
        raise HTTPException(status_code=400, detail=f"Unknown stakeholder '{req.owner_id}'.")

    vintage_age = 2026 - req.vintage_year
    r_ratio, m_flag, t_flag = (
        (req.r_ratio, req.m_flag, req.t_flag)
        if None not in (req.r_ratio, req.m_flag, req.t_flag)
        else _compute_features(req.project_type, req.tonnes)
    )

    features = {
        "R_ratio":     r_ratio,
        "Vintage_Age": vintage_age,
        "M_flag":      m_flag,
        "T_flag":      t_flag,
    }

    risk_score     = score_project(features)
    risk_score_int = int(round(risk_score * 10_000))
    credit_id      = f"CRED-{uuid.uuid4().hex[:8].upper()}"

    try:
        nonce  = w3.eth.get_transaction_count(DEPLOYER_ADDRESS)
        tx     = contract.functions.issueCredit(
            credit_id,
            req.tonnes,
            req.developer_id,
            req.regulator_id,
            risk_score_int,
            Web3.to_checksum_address(owner_address),
        ).build_transaction({
            "from":     DEPLOYER_ADDRESS,
            "nonce":    nonce,
            "gas":      300_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed  = w3.eth.account.sign_transaction(tx, private_key=DEPLOYER_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    if receipt.status != 1:
        raise HTTPException(status_code=500, detail="Transaction reverted on-chain.")

    return {
        "credit_id":            credit_id,
        "ai_risk_score":        risk_score,
        "ai_risk_score_scaled": risk_score_int,
        "computed_features":    features,
        "owner_id":             req.owner_id,
        "owner_address":        owner_address,
        "tonnes":               req.tonnes,
        "tx_hash":              tx_hash.hex(),
        "block_number":         receipt.blockNumber,
        "contract_address":     CONTRACT_ADDRESS,
        "status":               "minted",
    }


@app.get("/credits/{credit_id}")
def get_credit(credit_id: str):
    _, contract = get_contract()

    try:
        if not contract.functions.doesCreditExist(credit_id).call():
            raise HTTPException(status_code=404, detail=f"Credit '{credit_id}' not found.")
        tonnes, dev_id, reg_id, risk_int, owner, is_retired = \
            contract.functions.getCredit(credit_id).call()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    addr_to_name = {v: k for k, v in STAKEHOLDERS.items()}

    return {
        "credit_id":            credit_id,
        "tonnes":               tonnes,
        "developer_id":         dev_id,
        "regulator_id":         reg_id,
        "ai_risk_score":        risk_int / 10_000,
        "ai_risk_score_scaled": risk_int,
        "owner":                owner,
        "owner_name":           addr_to_name.get(owner, "Unknown"),
        "is_retired":           is_retired,
    }


@app.get("/chain/stats")
def get_chain_stats():
    w3, contract = get_contract()
    registrar = contract.functions.registrar().call()
    return {
        "network":          "Hardhat Local",
        "chain_id":         w3.eth.chain_id,
        "latest_block":     w3.eth.block_number,
        "contract_address": CONTRACT_ADDRESS,
        "registrar":        registrar,
        "node_url":         HARDHAT_RPC,
    }


@app.get("/chain/events")
def get_chain_events():
    _, contract = get_contract()

    try:
        issued      = contract.events.CreditIssued.get_logs(from_block=0)
        transferred = contract.events.CreditTransferred.get_logs(from_block=0)
        retired     = contract.events.CreditRetired.get_logs(from_block=0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read event logs: {e}")

    addr_to_name = {v: k for k, v in STAKEHOLDERS.items()}
    events = []

    for e in issued:
        owner = e.args.owner
        events.append({
            "type":          "issued",
            "block":         e.blockNumber,
            "tx_hash":       e.transactionHash.hex(),
            "credit_id":     e.args.creditId,
            "owner":         owner,
            "owner_name":    addr_to_name.get(owner, "Unknown"),
            "tonnes":        e.args.tonnes,
            "ai_risk_score": e.args.aiRiskScore / 10_000,
            "developer_id":  e.args.developerId,
            "regulator_id":  e.args.regulatorId,
        })

    for e in transferred:
        from_addr = e.args["from"]
        to_addr   = e.args["to"]
        events.append({
            "type":         "transferred",
            "block":        e.blockNumber,
            "tx_hash":      e.transactionHash.hex(),
            "credit_id":    e.args.creditId,
            "from_address": from_addr,
            "from_name":    addr_to_name.get(from_addr, "Unknown"),
            "to_address":   to_addr,
            "to_name":      addr_to_name.get(to_addr, "Unknown"),
        })

    for e in retired:
        owner = e.args.owner
        events.append({
            "type":       "retired",
            "block":      e.blockNumber,
            "tx_hash":    e.transactionHash.hex(),
            "credit_id":  e.args.creditId,
            "owner":      owner,
            "owner_name": addr_to_name.get(owner, "Unknown"),
        })

    events.sort(key=lambda x: x["block"], reverse=True)
    return {"events": events, "total": len(events)}
