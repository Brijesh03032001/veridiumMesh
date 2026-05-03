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

from ml.model import scoreProject


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

artifactPath = Path(__file__).resolve().parent.parent / \
    "ethereum/artifacts/contracts/CarbonCredit.sol/CarbonCredit.json"

STAKEHOLDERS = {
    "GreenBuild Solutions":  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "EcoForest Initiative":  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "SolarVerde Projects":   "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "CarbonMarket Exchange": "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "BlueSky Offset Fund":   "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
}

highRiskTypes = {
    "Renewable Energy", "Hydro", "Hydropower", "Wind", "Biomass",
    "Fossil fuel replacement", "Solar", "Landfill Gas", "REDD+",
}
peerAvgTonnes = 50_000

REGULATOR_ADDRESS = "0x976EA74026E726554dB657fA54763abd0C3a0aa9"

# credits sit here until the regulator approves them
pendingCredits: dict[str, dict] = {}


# Signs the endorsement hash the same way the Solidity contract expects it.
# Packs creditId + tonnes + owner as raw bytes, hashes with keccak, then
# wraps it with the EIP191 prefix before signing.
def signEndorsement(creditId: str, tonnes: int, owner: str, privateKey: str) -> bytes:
    packed = creditId.encode("utf-8") + tonnes.to_bytes(32, "big") + bytes.fromhex(owner[2:])
    msgHash = Web3.keccak(packed)
    message = encode_defunct(primitive=bytes(msgHash))
    signed = Account.sign_message(message, private_key=privateKey)
    return bytes(signed.signature)


# Must match the Solidity POW_DIFFICULTY constant (top 8 bits = 0)
powDifficulty = (2**256 - 1) >> 8


# Brute forces a nonce so that keccak256(creditId ++ nonce) <= difficulty.
# Takes about 256 tries on average, well under a second.
def minePowNonce(creditId: str) -> int:
    nonce = 0
    while True:
        packed = creditId.encode("utf-8") + nonce.to_bytes(32, "big")
        h = int(Web3.keccak(packed).hex(), 16)
        if h <= powDifficulty:
            return nonce
        nonce += 1


# Computes the same leaf hash the Solidity contract uses for its Merkle tree
def creditLeaf(creditId: str, tonnes: int, owner: str, aiRiskScoreInt: int) -> bytes:
    packed = (
        creditId.encode("utf-8")
        + tonnes.to_bytes(32, "big")
        + bytes.fromhex(owner[2:])
        + aiRiskScoreInt.to_bytes(32, "big")
    )
    return bytes(Web3.keccak(packed))


def nextPowerOf2(n: int) -> int:
    if n <= 1:
        return 1
    result = 1
    while result < n:
        result <<= 1
    return result


# Builds a Merkle proof for the leaf at targetIndex. Sorts sibling pairs
# before hashing so it matches the Solidity side exactly.
def buildMerkleProof(allLeaves: list[bytes], targetIndex: int) -> tuple[bytes, list[bytes]]:
    n = len(allLeaves)
    if n == 0:
        return bytes(32), []
    if n == 1:
        return allLeaves[0], []

    size = nextPowerOf2(n)
    nodes = list(allLeaves) + [bytes(32)] * (size - n)

    proof: list[bytes] = []
    idx = targetIndex
    currentSize = size

    while currentSize > 1:
        sibling = idx ^ 1
        proof.append(nodes[sibling])

        half = currentSize >> 1
        newNodes: list[bytes] = []
        for i in range(half):
            a, b = nodes[2 * i], nodes[2 * i + 1]
            combined = (a + b) if a < b else (b + a)
            newNodes.append(bytes(Web3.keccak(combined)))
        nodes = newNodes
        currentSize = half
        idx >>= 1

    return nodes[0], proof


def connectToChain():
    w3 = Web3(Web3.HTTPProvider(HARDHAT_RPC))
    if not w3.is_connected():
        raise RuntimeError(f"Cannot reach Hardhat node at {HARDHAT_RPC}")
    with open(artifactPath) as f:
        abi = json.load(f)["abi"]
    contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=abi)
    return w3, contract


try:
    cachedW3, cachedContract = connectToChain()
except Exception as e:
    cachedW3 = cachedContract = None
    print(f"[WARNING] Ethereum node not available at startup: {e}")


def getContract():
    global cachedW3, cachedContract
    if cachedW3 is None or not cachedW3.is_connected():
        try:
            cachedW3, cachedContract = connectToChain()
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))
    return cachedW3, cachedContract


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
    def notBlank(cls, v: str, info) -> str:
        if not v or not v.strip():
            raise ValueError(f"{info.field_name} must not be blank.")
        return v.strip()

    @field_validator("tonnes")
    @classmethod
    def positiveTonnes(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("tonnes must be positive.")
        return v

    @field_validator("vintage_year")
    @classmethod
    def validVintage(cls, v: int) -> int:
        if v < 1990 or v > 2026:
            raise ValueError("vintage_year must be between 1990 and 2026.")
        return v


class ApproveRequest(BaseModel):
    regulator_address: str
    signature:         str


def computeFeatures(projectType: str, tonnes: int) -> tuple[float, int, int]:
    rRatio = round(max(0.1, tonnes / peerAvgTonnes), 4)
    mFlag = 1 if projectType in highRiskTypes else 0
    tFlag = 1 if rRatio > 3.0 else 0
    return rRatio, mFlag, tFlag


@app.get("/stakeholders")
def getStakeholders():
    return [{"name": name, "address": addr} for name, addr in STAKEHOLDERS.items()]


@app.post("/credits/issue", status_code=201)
def issueCredit(req: MintRequest):
    # scores the project with the AI model, mines a PoW nonce, gets both
    # endorsement signatures, then sends the whole thing to the contract
    w3, contract = getContract()

    ownerAddress = STAKEHOLDERS.get(req.owner_id)
    if not ownerAddress:
        raise HTTPException(status_code=400, detail=f"Unknown stakeholder '{req.owner_id}'.")

    vintageAge = 2026 - req.vintage_year
    rRatio, mFlag, tFlag = (
        (req.r_ratio, req.m_flag, req.t_flag)
        if None not in (req.r_ratio, req.m_flag, req.t_flag)
        else computeFeatures(req.project_type, req.tonnes)
    )

    features = {
        "R_ratio":     rRatio,
        "Vintage_Age": vintageAge,
        "M_flag":      mFlag,
        "T_flag":      tFlag,
    }

    riskScore = scoreProject(features)
    riskScoreInt = int(round(riskScore * 10_000))
    creditId = f"CRED-{uuid.uuid4().hex[:8].upper()}"

    try:
        powNonce = minePowNonce(creditId)
        ownerChecksum = Web3.to_checksum_address(ownerAddress)
        devSig = signEndorsement(creditId, req.tonnes, ownerChecksum, DEVELOPER_SIGNER_KEY)
        regSig = signEndorsement(creditId, req.tonnes, ownerChecksum, REGULATOR_SIGNER_KEY)
        nonce = w3.eth.get_transaction_count(DEPLOYER_ADDRESS)
        tx = contract.functions.issueCredit(
            creditId,
            req.tonnes,
            req.developer_id,
            req.regulator_id,
            riskScoreInt,
            ownerChecksum,
            powNonce,
            devSig,
            regSig,
        ).build_transaction({
            "from":     DEPLOYER_ADDRESS,
            "nonce":    nonce,
            "gas":      800_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = w3.eth.account.sign_transaction(tx, private_key=DEPLOYER_KEY)
        txHash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(txHash, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    if receipt.status != 1:
        raise HTTPException(status_code=500, detail="Transaction reverted on-chain.")

    tokenId = None
    try:
        logs = contract.events.CreditIssued().process_receipt(receipt)
        if logs:
            tokenId = logs[0].args.tokenId
    except Exception:
        pass

    return {
        "credit_id":            creditId,
        "ai_risk_score":        riskScore,
        "ai_risk_score_scaled": riskScoreInt,
        "computed_features":    features,
        "owner_id":             req.owner_id,
        "owner_address":        ownerChecksum,
        "tonnes":               req.tonnes,
        "tx_hash":              txHash.hex(),
        "block_number":         receipt.blockNumber,
        "contract_address":     CONTRACT_ADDRESS,
        "pow_nonce":            powNonce,
        "token_id":             tokenId,
        "developer_signer":     DEVELOPER_SIGNER_ADDRESS,
        "regulator_signer":     REGULATOR_SIGNER_ADDRESS,
        "status":               "minted",
    }


@app.post("/credits/pending", status_code=201)
def submitPending(req: MintRequest):
    # developer submits a credit request. We score it with the AI model
    # but don't mint yet. It sits in pendingCredits until the regulator approves.
    ownerAddress = STAKEHOLDERS.get(req.owner_id)
    if not ownerAddress:
        raise HTTPException(status_code=400, detail=f"Unknown stakeholder '{req.owner_id}'.")

    if req.developer_signature:
        msgHash = Web3.solidity_keccak(
            ["string", "string", "uint256"],
            [req.project_id, req.project_type, req.tonnes],
        )
        recovered = Account.recover_message(
            encode_defunct(msgHash), signature=req.developer_signature
        )
        if recovered.lower() != ownerAddress.lower():
            raise HTTPException(
                status_code=403,
                detail="Signature does not match the declared developer identity.",
            )

    vintageAge = 2026 - req.vintage_year
    rRatio, mFlag, tFlag = (
        (req.r_ratio, req.m_flag, req.t_flag)
        if None not in (req.r_ratio, req.m_flag, req.t_flag)
        else computeFeatures(req.project_type, req.tonnes)
    )

    features = {
        "R_ratio":     rRatio,
        "Vintage_Age": vintageAge,
        "M_flag":      mFlag,
        "T_flag":      tFlag,
    }

    riskScore = scoreProject(features)
    riskScoreInt = int(round(riskScore * 10_000))

    if riskScoreInt >= 7000:
        raise HTTPException(
            status_code=422,
            detail=f"AI risk score too high ({riskScore:.4f}). Credit rejected before submission.",
        )

    pendingId = f"PEND-{uuid.uuid4().hex[:8].upper()}"
    creditId = f"CRED-{uuid.uuid4().hex[:8].upper()}"

    pendingCredits[pendingId] = {
        "pending_id":     pendingId,
        "credit_id":      creditId,
        "project_id":     req.project_id,
        "project_type":   req.project_type,
        "tonnes":         req.tonnes,
        "vintage_year":   req.vintage_year,
        "owner_id":       req.owner_id,
        "owner_address":  ownerAddress,
        "developer_id":   req.developer_id,
        "regulator_id":   req.regulator_id,
        "risk_score":     riskScore,
        "risk_score_int": riskScoreInt,
        "features":       features,
        "status":         "pending",
        "submitted_at":   datetime.now(timezone.utc).isoformat(),
    }

    return {
        "pending_id":    pendingId,
        "credit_id":     creditId,
        "ai_risk_score": riskScore,
        "status":        "pending",
        "message":       "Submitted for regulator review.",
    }


@app.get("/credits/pending")
def listPending():
    return list(pendingCredits.values())


@app.post("/credits/approve/{pending_id}", status_code=201)
def approveCredit(pending_id: str, req: ApproveRequest):
    # regulator approves a pending credit. This triggers the actual on chain
    # mint with PoW, dual signatures, and everything.
    pending = pendingCredits.get(pending_id)
    if not pending:
        raise HTTPException(status_code=404, detail=f"Pending credit '{pending_id}' not found.")

    if pending["status"] != "pending":
        raise HTTPException(status_code=400, detail="Credit has already been processed.")

    if req.regulator_address.lower() != REGULATOR_ADDRESS.lower():
        raise HTTPException(status_code=403, detail="Only the registered regulator can approve credits.")

    w3, contract = getContract()

    creditId = pending["credit_id"]
    ownerChecksum = Web3.to_checksum_address(pending["owner_address"])
    riskScoreInt = pending["risk_score_int"]

    try:
        powNonce = minePowNonce(creditId)
        devSig = signEndorsement(creditId, pending["tonnes"], ownerChecksum, DEVELOPER_SIGNER_KEY)
        regSig = signEndorsement(creditId, pending["tonnes"], ownerChecksum, REGULATOR_SIGNER_KEY)
        nonce = w3.eth.get_transaction_count(DEPLOYER_ADDRESS)
        tx = contract.functions.issueCredit(
            creditId,
            pending["tonnes"],
            pending["developer_id"],
            pending["regulator_id"],
            riskScoreInt,
            ownerChecksum,
            powNonce,
            devSig,
            regSig,
        ).build_transaction({
            "from":     DEPLOYER_ADDRESS,
            "nonce":    nonce,
            "gas":      800_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = w3.eth.account.sign_transaction(tx, private_key=DEPLOYER_KEY)
        txHash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(txHash, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mint failed: {e}")

    if receipt.status != 1:
        raise HTTPException(status_code=500, detail="Transaction reverted on-chain.")

    tokenId = None
    try:
        logs = contract.events.CreditIssued().process_receipt(receipt)
        if logs:
            tokenId = logs[0].args.tokenId
    except Exception:
        pass

    pendingCredits[pending_id]["status"] = "approved"

    return {
        "credit_id":            creditId,
        "ai_risk_score":        pending["risk_score"],
        "ai_risk_score_scaled": riskScoreInt,
        "computed_features":    pending["features"],
        "owner_id":             pending["owner_id"],
        "owner_address":        ownerChecksum,
        "tonnes":               pending["tonnes"],
        "tx_hash":              txHash.hex(),
        "block_number":         receipt.blockNumber,
        "contract_address":     CONTRACT_ADDRESS,
        "pow_nonce":            powNonce,
        "token_id":             tokenId,
        "developer_signer":     DEVELOPER_SIGNER_ADDRESS,
        "regulator_signer":     REGULATOR_SIGNER_ADDRESS,
        "status":               "minted",
    }


@app.get("/credits/{credit_id}")
def getCredit(credit_id: str):
    _, contract = getContract()

    try:
        if not contract.functions.doesCreditExist(credit_id).call():
            raise HTTPException(status_code=404, detail=f"Credit '{credit_id}' not found.")
        tonnes, devId, regId, riskInt, owner, isRetired, tokenId = \
            contract.functions.getCredit(credit_id).call()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contract call failed: {e}")

    addrToName = {v: k for k, v in STAKEHOLDERS.items()}

    return {
        "credit_id":            credit_id,
        "tonnes":               tonnes,
        "developer_id":         devId,
        "regulator_id":         regId,
        "ai_risk_score":        riskInt / 10_000,
        "ai_risk_score_scaled": riskInt,
        "owner":                owner,
        "owner_name":           addrToName.get(owner, "Unknown"),
        "is_retired":           isRetired,
        "token_id":             tokenId,
    }


@app.get("/chain/stats")
def getChainStats():
    w3, contract = getContract()
    admin = contract.functions.admin().call()
    merkleRoot = contract.functions.merkleRoot().call()
    totalCredits = contract.functions.totalCredits().call()
    return {
        "network":           "Hardhat Local",
        "chain_id":          w3.eth.chain_id,
        "latest_block":      w3.eth.block_number,
        "contract_address":  CONTRACT_ADDRESS,
        "admin":             admin,
        "developer_signer":  DEVELOPER_SIGNER_ADDRESS,
        "regulator_signer":  REGULATOR_SIGNER_ADDRESS,
        "node_url":          HARDHAT_RPC,
        "merkle_root":       "0x" + merkleRoot.hex(),
        "total_credits":     totalCredits,
    }


@app.get("/chain/events")
def getChainEvents():
    _, contract = getContract()

    try:
        issued = contract.events.CreditIssued.get_logs(from_block=0)
        transferred = contract.events.CreditTransferred.get_logs(from_block=0)
        retired = contract.events.CreditRetired.get_logs(from_block=0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read event logs: {e}")

    addrToName = {v: k for k, v in STAKEHOLDERS.items()}
    events = []

    for e in issued:
        owner = e.args.owner
        events.append({
            "type":          "issued",
            "block":         e.blockNumber,
            "tx_hash":       e.transactionHash.hex(),
            "credit_id":     e.args.creditId,
            "owner":         owner,
            "owner_name":    addrToName.get(owner, "Unknown"),
            "tonnes":        e.args.tonnes,
            "ai_risk_score": e.args.aiRiskScore / 10_000,
            "developer_id":  e.args.developerId,
            "regulator_id":  e.args.regulatorId,
        })

    for e in transferred:
        fromAddr = e.args["from"]
        toAddr = e.args["to"]
        events.append({
            "type":         "transferred",
            "block":        e.blockNumber,
            "tx_hash":      e.transactionHash.hex(),
            "credit_id":    e.args.creditId,
            "from_address": fromAddr,
            "from_name":    addrToName.get(fromAddr, "Unknown"),
            "to_address":   toAddr,
            "to_name":      addrToName.get(toAddr, "Unknown"),
        })

    for e in retired:
        owner = e.args.owner
        events.append({
            "type":       "retired",
            "block":      e.blockNumber,
            "tx_hash":    e.transactionHash.hex(),
            "credit_id":  e.args.creditId,
            "owner":      owner,
            "owner_name": addrToName.get(owner, "Unknown"),
        })

    events.sort(key=lambda x: x["block"], reverse=True)
    return {"events": events, "total": len(events)}


@app.get("/credits/{credit_id}/proof")
def getCreditProof(credit_id: str):
    # rebuilds the full leaf list from on chain events, finds the target credit,
    # and computes a Merkle inclusion proof which can pass to verifyCredit()
    _, contract = getContract()

    if not contract.functions.doesCreditExist(credit_id).call():
        raise HTTPException(status_code=404, detail=f"Credit '{credit_id}' not found.")

    try:
        issuedEvents = contract.events.CreditIssued.get_logs(from_block=0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read events: {e}")

    issuedEvents = sorted(issuedEvents, key=lambda ev: (ev.blockNumber, ev.logIndex))

    allLeaves: list[bytes] = []
    targetIndex: int | None = None

    for i, ev in enumerate(issuedEvents):
        leaf = creditLeaf(
            ev.args.creditId,
            ev.args.tonnes,
            ev.args.owner,
            ev.args.aiRiskScore,
        )
        allLeaves.append(leaf)
        if ev.args.creditId == credit_id:
            targetIndex = i

    if targetIndex is None:
        raise HTTPException(status_code=404, detail="Credit not found in event logs.")

    root, proof = buildMerkleProof(allLeaves, targetIndex)
    leafHex = "0x" + allLeaves[targetIndex].hex()
    rootHex = "0x" + root.hex()

    return {
        "credit_id":      credit_id,
        "leaf_hash":      leafHex,
        "leaf_index":     targetIndex,
        "merkle_root":    rootHex,
        "proof":          ["0x" + p.hex() for p in proof],
        "proof_length":   len(proof),
        "total_credits":  len(allLeaves),
    }
