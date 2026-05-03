import uuid
import json
import os
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from web3 import Web3

from ml.model import score_project


app = FastAPI(title="Veridium Mesh API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Hardhat defaults. Override with env vars if you redeploy.
HARDHAT_RPC = os.getenv("HARDHAT_RPC", "http://127.0.0.1:8545")
DEPLOYER_ADDRESS = os.getenv("DEPLOYER_ADDRESS", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
DEPLOYER_KEY = os.getenv("DEPLOYER_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "0x5FbDB2315678afecb367f032d93F642f64180aa3")

# These are the Hardhat accounts registered as Developer and Regulator in deploy.js
DEVELOPER_SIGNER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
DEVELOPER_SIGNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
REGULATOR_SIGNER_ADDRESS = "0x976EA74026E726554dB657fA54763abd0C3a0aa9"
REGULATOR_SIGNER_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"

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

REGULATOR_ADDRESS = "0x976EA74026E726554dB657fA54763abd0C3a0aa9"

# credits sit here until the regulator approves them
_pending: dict[str, dict] = {}


# Signs the endorsement hash the same way the Solidity contract expects it.
# Packs creditId + tonnes + owner as raw bytes, hashes with keccak, then
# wraps it with the EIP191 prefix before signing.
def _sign_endorsement(credit_id: str, tonnes: int, owner: str, private_key: str) -> bytes:
    packed = credit_id.encode("utf-8") + tonnes.to_bytes(32, "big") + bytes.fromhex(owner[2:])
    msg_hash = Web3.keccak(packed)
    message = encode_defunct(primitive=bytes(msg_hash))
    signed = Account.sign_message(message, private_key=private_key)
    return bytes(signed.signature)


# Must match the Solidity POW_DIFFICULTY constant (top 8 bits = 0)
_POW_DIFFICULTY = (2**256 - 1) >> 8


# Brute forces a nonce so that keccak256(creditId ++ nonce) <= difficulty.
# Takes about 256 tries on average, well under a second.
def mine_pow_nonce(credit_id: str) -> int:
    nonce = 0
    while True:
        packed = credit_id.encode("utf-8") + nonce.to_bytes(32, "big")
        h = int(Web3.keccak(packed).hex(), 16)
        if h <= _POW_DIFFICULTY:
            return nonce
        nonce += 1


# Computes the same leaf hash the Solidity contract uses for its Merkle tree
def _credit_leaf(credit_id: str, tonnes: int, owner: str, ai_risk_score_int: int) -> bytes:
    packed = (
        credit_id.encode("utf-8")
        + tonnes.to_bytes(32, "big")
        + bytes.fromhex(owner[2:])
        + ai_risk_score_int.to_bytes(32, "big")
    )
    return bytes(Web3.keccak(packed))


def _next_power_of_2(n: int) -> int:
    if n <= 1:
        return 1
    result = 1
    while result < n:
        result <<= 1
    return result


# Builds a Merkle proof for the leaf at target_index. Sorts sibling pairs
# before hashing so it matches the Solidity side exactly.
def _build_merkle_proof(all_leaves: list[bytes], target_index: int) -> tuple[bytes, list[bytes]]:
    n = len(all_leaves)
    if n == 0:
        return bytes(32), []
    if n == 1:
        return all_leaves[0], []

    size = _next_power_of_2(n)
    nodes = list(all_leaves) + [bytes(32)] * (size - n)

    proof: list[bytes] = []
    idx = target_index
    current_size = size

    while current_size > 1:
        sibling = idx ^ 1
        proof.append(nodes[sibling])

        half = current_size >> 1
        new_nodes: list[bytes] = []
        for i in range(half):
            a, b = nodes[2 * i], nodes[2 * i + 1]
            combined = (a + b) if a < b else (b + a)
            new_nodes.append(bytes(Web3.keccak(combined)))
        nodes = new_nodes
        current_size = half
        idx >>= 1

    return nodes[0], proof


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
    developer_signature: Optional[str] = None
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


class ApproveRequest(BaseModel):
    regulator_address: str
    signature:         str


def _compute_features(project_type: str, tonnes: int) -> tuple[float, int, int]:
    r_ratio = round(max(0.1, tonnes / _PEER_AVG_TONNES), 4)
    m_flag = 1 if project_type in _HIGH_RISK_TYPES else 0
    t_flag = 1 if r_ratio > 3.0 else 0
    return r_ratio, m_flag, t_flag


@app.get("/stakeholders")
def get_stakeholders():
    return [{"name": name, "address": addr} for name, addr in STAKEHOLDERS.items()]


@app.post("/credits/issue", status_code=201)
def issue_credit(req: MintRequest):
    # scores the project with the AI model, mines a PoW nonce, gets both
    # endorsement signatures, then sends the whole thing to the contract
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

    risk_score = score_project(features)
    risk_score_int = int(round(risk_score * 10_000))
    credit_id = f"CRED-{uuid.uuid4().hex[:8].upper()}"

    try:
        pow_nonce = mine_pow_nonce(credit_id)
        owner_checksum = Web3.to_checksum_address(owner_address)
        dev_sig = _sign_endorsement(credit_id, req.tonnes, owner_checksum, DEVELOPER_SIGNER_KEY)
        reg_sig = _sign_endorsement(credit_id, req.tonnes, owner_checksum, REGULATOR_SIGNER_KEY)
        nonce  = w3.eth.get_transaction_count(DEPLOYER_ADDRESS)
        tx     = contract.functions.issueCredit(
            credit_id,
            req.tonnes,
            req.developer_id,
            req.regulator_id,
            risk_score_int,
            owner_checksum,
            pow_nonce,
            dev_sig,
            reg_sig,
        ).build_transaction({
            "from":     DEPLOYER_ADDRESS,
            "nonce":    nonce,
            "gas":      800_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed  = w3.eth.account.sign_transaction(tx, private_key=DEPLOYER_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    if receipt.status != 1:
        raise HTTPException(status_code=500, detail="Transaction reverted on-chain.")

    token_id = None
    try:
        logs = contract.events.CreditIssued().process_receipt(receipt)
        if logs:
            token_id = logs[0].args.tokenId
    except Exception:
        pass

    return {
        "credit_id":            credit_id,
        "ai_risk_score":        risk_score,
        "ai_risk_score_scaled": risk_score_int,
        "computed_features":    features,
        "owner_id":             req.owner_id,
        "owner_address":        owner_checksum,
        "tonnes":               req.tonnes,
        "tx_hash":              tx_hash.hex(),
        "block_number":         receipt.blockNumber,
        "contract_address":     CONTRACT_ADDRESS,
        "pow_nonce":            pow_nonce,
        "token_id":             token_id,
        "developer_signer":     DEVELOPER_SIGNER_ADDRESS,
        "regulator_signer":     REGULATOR_SIGNER_ADDRESS,
        "status":               "minted",
    }


@app.post("/credits/pending", status_code=201)
def submit_pending(req: MintRequest):
    # developer submits a credit request. We score it with the AI model
    # but don't mint yet. It sits in _pending until the regulator approves.
    owner_address = STAKEHOLDERS.get(req.owner_id)
    if not owner_address:
        raise HTTPException(status_code=400, detail=f"Unknown stakeholder '{req.owner_id}'.")

    if req.developer_signature:
        msg_hash = Web3.solidity_keccak(
            ["string", "string", "uint256"],
            [req.project_id, req.project_type, req.tonnes],
        )
        recovered = Account.recover_message(
            encode_defunct(msg_hash), signature=req.developer_signature
        )
        if recovered.lower() != owner_address.lower():
            raise HTTPException(
                status_code=403,
                detail="Signature does not match the declared developer identity.",
            )

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

    risk_score = score_project(features)
    risk_score_int = int(round(risk_score * 10_000))

    if risk_score_int >= 7000:
        raise HTTPException(
            status_code=422,
            detail=f"AI risk score too high ({risk_score:.4f}). Credit rejected before submission.",
        )

    pending_id = f"PEND-{uuid.uuid4().hex[:8].upper()}"
    credit_id  = f"CRED-{uuid.uuid4().hex[:8].upper()}"

    _pending[pending_id] = {
        "pending_id":     pending_id,
        "credit_id":      credit_id,
        "project_id":     req.project_id,
        "project_type":   req.project_type,
        "tonnes":         req.tonnes,
        "vintage_year":   req.vintage_year,
        "owner_id":       req.owner_id,
        "owner_address":  owner_address,
        "developer_id":   req.developer_id,
        "regulator_id":   req.regulator_id,
        "risk_score":     risk_score,
        "risk_score_int": risk_score_int,
        "features":       features,
        "status":         "pending",
        "submitted_at":   datetime.now(timezone.utc).isoformat(),
    }

    return {
        "pending_id":    pending_id,
        "credit_id":     credit_id,
        "ai_risk_score": risk_score,
        "status":        "pending",
        "message":       "Submitted for regulator review.",
    }


@app.get("/credits/pending")
def list_pending():
    return list(_pending.values())


@app.post("/credits/approve/{pending_id}", status_code=201)
def approve_credit(pending_id: str, req: ApproveRequest):
    # regulator approves a pending credit. This triggers the actual on chain
    # mint with PoW, dual signatures, and everything.
    pending = _pending.get(pending_id)
    if not pending:
        raise HTTPException(status_code=404, detail=f"Pending credit '{pending_id}' not found.")

    if pending["status"] != "pending":
        raise HTTPException(status_code=400, detail="Credit has already been processed.")

    if req.regulator_address.lower() != REGULATOR_ADDRESS.lower():
        raise HTTPException(status_code=403, detail="Only the registered regulator can approve credits.")

    w3, contract = get_contract()

    credit_id = pending["credit_id"]
    owner_checksum = Web3.to_checksum_address(pending["owner_address"])
    risk_score_int = pending["risk_score_int"]

    try:
        pow_nonce = mine_pow_nonce(credit_id)
        dev_sig   = _sign_endorsement(credit_id, pending["tonnes"], owner_checksum, DEVELOPER_SIGNER_KEY)
        reg_sig   = _sign_endorsement(credit_id, pending["tonnes"], owner_checksum, REGULATOR_SIGNER_KEY)
        nonce     = w3.eth.get_transaction_count(DEPLOYER_ADDRESS)
        tx = contract.functions.issueCredit(
            credit_id,
            pending["tonnes"],
            pending["developer_id"],
            pending["regulator_id"],
            risk_score_int,
            owner_checksum,
            pow_nonce,
            dev_sig,
            reg_sig,
        ).build_transaction({
            "from":     DEPLOYER_ADDRESS,
            "nonce":    nonce,
            "gas":      800_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed  = w3.eth.account.sign_transaction(tx, private_key=DEPLOYER_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mint failed: {e}")

    if receipt.status != 1:
        raise HTTPException(status_code=500, detail="Transaction reverted on-chain.")

    token_id = None
    try:
        logs = contract.events.CreditIssued().process_receipt(receipt)
        if logs:
            token_id = logs[0].args.tokenId
    except Exception:
        pass

    _pending[pending_id]["status"] = "approved"

    return {
        "credit_id":            credit_id,
        "ai_risk_score":        pending["risk_score"],
        "ai_risk_score_scaled": risk_score_int,
        "computed_features":    pending["features"],
        "owner_id":             pending["owner_id"],
        "owner_address":        owner_checksum,
        "tonnes":               pending["tonnes"],
        "tx_hash":              tx_hash.hex(),
        "block_number":         receipt.blockNumber,
        "contract_address":     CONTRACT_ADDRESS,
        "pow_nonce":            pow_nonce,
        "token_id":             token_id,
        "developer_signer":     DEVELOPER_SIGNER_ADDRESS,
        "regulator_signer":     REGULATOR_SIGNER_ADDRESS,
        "status":               "minted",
    }


@app.get("/credits/{credit_id}")
def get_credit(credit_id: str):
    _, contract = get_contract()

    try:
        if not contract.functions.doesCreditExist(credit_id).call():
            raise HTTPException(status_code=404, detail=f"Credit '{credit_id}' not found.")
        tonnes, dev_id, reg_id, risk_int, owner, is_retired, token_id = \
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
        "token_id":             token_id,
    }


@app.get("/chain/stats")
def get_chain_stats():
    w3, contract = get_contract()
    admin = contract.functions.admin().call()
    merkle_root = contract.functions.merkleRoot().call()
    total_credits = contract.functions.totalCredits().call()
    return {
        "network":           "Hardhat Local",
        "chain_id":          w3.eth.chain_id,
        "latest_block":      w3.eth.block_number,
        "contract_address":  CONTRACT_ADDRESS,
        "admin":             admin,
        "developer_signer":  DEVELOPER_SIGNER_ADDRESS,
        "regulator_signer":  REGULATOR_SIGNER_ADDRESS,
        "node_url":          HARDHAT_RPC,
        "merkle_root":       "0x" + merkle_root.hex(),
        "total_credits":     total_credits,
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


@app.get("/credits/{credit_id}/proof")
def get_credit_proof(credit_id: str):
    # rebuilds the full leaf list from on chain events, finds the target credit,
    # and computes a Merkle inclusion proof you can pass to verifyCredit()
    _, contract = get_contract()

    if not contract.functions.doesCreditExist(credit_id).call():
        raise HTTPException(status_code=404, detail=f"Credit '{credit_id}' not found.")

    try:
        issued_events = contract.events.CreditIssued.get_logs(from_block=0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read events: {e}")

    issued_events = sorted(issued_events, key=lambda ev: (ev.blockNumber, ev.logIndex))

    all_leaves: list[bytes] = []
    target_index: int | None = None

    for i, ev in enumerate(issued_events):
        leaf = _credit_leaf(
            ev.args.creditId,
            ev.args.tonnes,
            ev.args.owner,
            ev.args.aiRiskScore,
        )
        all_leaves.append(leaf)
        if ev.args.creditId == credit_id:
            target_index = i

    if target_index is None:
        raise HTTPException(status_code=404, detail="Credit not found in event logs.")

    root, proof = _build_merkle_proof(all_leaves, target_index)
    leaf_hex    = "0x" + all_leaves[target_index].hex()
    root_hex    = "0x" + root.hex()

    return {
        "credit_id":      credit_id,
        "leaf_hash":      leaf_hex,
        "leaf_index":     target_index,
        "merkle_root":    root_hex,
        "proof":          ["0x" + p.hex() for p in proof],
        "proof_length":   len(proof),
        "total_credits":  len(all_leaves),
    }
