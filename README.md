# VeridiumAI — AI-Powered Carbon Credit Fraud Detection on Ethereum

A decentralized system that uses an Isolation Forest anomaly detection model together with an Ethereum smart contract to catch fraudulent carbon credits before they ever make it on chain.

---

## What This Project Does

Carbon credit markets have a serious fraud problem. Projects inflate their issuance volumes, credits get double counted, and sometimes the projects behind them don't even exist. VeridiumAI tackles this by:

1. Running every credit through a trained Isolation Forest model before it touches the blockchain. If the AI flags it as high risk (score >= 0.7), the credit gets rejected automatically.
2. Requiring dual approval from both a project developer and a government regulator. Neither can mint a credit alone.
3. Writing the AI risk score permanently into the Ethereum smart contract so auditors can always verify that screening happened.
4. Logging every action (issuance, transfer, retirement) as Ethereum events, creating a tamper proof audit trail.
5. Giving users a web frontend with three views: a developer console for submitting credits, a regulator dashboard for reviewing and approving them, and a blockchain explorer for looking up any credit on chain.

The training data comes from the **Berkeley Voluntary Registry Offsets Database (VROD)**, a public dataset of roughly 5,700 real world carbon credit projects.

---

## Repository Structure

```
VeridiumMesh/
├── api/
│   └── app.py                    # FastAPI backend (ML scoring, PoW mining, on chain minting)
├── ethereum/
│   ├── contracts/
│   │   └── CarbonCredit.sol      # Solidity smart contract (ERC721, PoW, Merkle tree, ecrecover)
│   ├── scripts/
│   │   └── deploy.js             # Hardhat deploy script (registers developer + regulator roles)
│   ├── test/
│   │   └── CarbonCredit.test.js  # 30+ unit tests for the contract
│   └── hardhat.config.js
├── ml/
│   ├── model.py                  # scoreProject() — Isolation Forest inference
│   ├── train_isoforest.py        # Training script
│   ├── isoforest.joblib          # Trained model artifact
│   ├── scaler.joblib
│   └── norm_params.joblib
├── frontend/                     # Next.js 16 + Tailwind + shadcn/ui
│   └── src/app/
│       ├── page.tsx              # Landing page with live chain stats
│       ├── developer/page.tsx    # Developer console (submit credits via MetaMask)
│       ├── regulator/page.tsx    # Regulator dashboard (review and approve pending credits)
│       └── explorer/page.tsx     # Blockchain explorer (credit lookup, Merkle proof verification)
├── tests/                        # Python unit tests (pytest)
├── data/                         # Berkeley VROD CSVs + EDA and feature plots
├── notebooks/                    # Jupyter EDA and feature engineering notebooks
├── scripts/                      # Utility scripts (feature engineering, EDA)
└── requirements.txt
```

---

## How to Run

### Step 1 — Start the Hardhat local Ethereum node

```bash
cd ethereum
npx hardhat node
```

This starts a local node at http://127.0.0.1:8545 with 20 pre funded test accounts.

### Step 2 — Deploy the smart contract

```bash
cd ethereum
npx hardhat run scripts/deploy.js --network localhost
```

The script deploys the contract and registers the developer signer (Hardhat account #1) and regulator signer (account #6). It prints the contract address. If you restart the node, you need to redeploy.

### Step 3 — Start the FastAPI backend

```bash
source veridium/bin/activate
PYTHONPATH=. python -m uvicorn api.app:app --reload --port 8000
```

API docs available at http://127.0.0.1:8000/docs

### Step 4 — Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at http://localhost:3000. You'll need MetaMask installed and connected to the Hardhat network (Chain ID 31337, RPC http://127.0.0.1:8545). Import one of the Hardhat test accounts into MetaMask to interact with the system.

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

## How the System Works End to End

1. A developer connects their MetaMask wallet on the Developer Console page and fills in the project details (project ID, type, tonnes, vintage year).

2. They click "Sign & Submit for Approval". MetaMask asks them to sign the request. The frontend sends it to `POST /credits/pending`.

3. The backend runs the AI model on the project features. If the risk score is too high (>= 0.7), the credit is rejected immediately. Otherwise it goes into a pending queue.

4. The regulator opens the Regulator Dashboard, sees the pending credit with its AI risk score, and clicks "Approve & Sign". MetaMask asks them to sign.

5. The backend then does the actual on chain minting: mines a proof of work nonce, generates both ECDSA endorsement signatures, and calls the smart contract's `issueCredit()` function with all 9 parameters.

6. The contract verifies the PoW, validates all inputs, recovers both signatures to confirm they came from a registered developer and regulator, stores the credit, mints an ERC721 NFT, and updates the on chain Merkle tree.

7. The credit now exists as an NFT. The owner can transfer it to someone else or retire (burn) it permanently. Both actions require MetaMask signing.

8. Anyone can look up any credit on the Explorer page, see its full details and AI risk score, and get a Merkle inclusion proof that can be verified directly against the contract.

---

## Smart Contract — CarbonCredit.sol

Written in Solidity ^0.8.28, deployed on a local Hardhat node. Every carbon credit is an ERC721 NFT.

### Functions

| Function | Who Calls It | What It Does |
|---|---|---|
| `issueCredit(creditId, tonnes, developerId, regulatorId, aiRiskScore, owner, nonce, devSig, regSig)` | Backend (after regulator approval) | Verifies PoW, recovers both ECDSA signatures, validates inputs, mints the NFT, updates the Merkle tree |
| `transferCredit(creditId, to)` | Credit owner via MetaMask | Transfers the NFT to a new address. Reverts if the credit is retired. |
| `retireCredit(creditId)` | Credit owner via MetaMask | Burns the NFT permanently. Irreversible. |
| `getCredit(creditId)` | Anyone | Returns tonnes, developerId, regulatorId, aiRiskScore, owner, isRetired, tokenId |
| `endorsementHash(creditId, tonnes, owner)` | Read only | Returns the EIP191 hash that signers need to sign off chain |
| `getCreditLeafHash(creditId)` | Read only | Returns the Merkle leaf hash for a credit |
| `verifyCredit(proof, leaf)` | Read only | Verifies a Merkle inclusion proof against the current root |
| `addDeveloper(addr)` / `addRegulator(addr)` / `addRegistrar(addr)` | Admin only | Manages role assignments for decentralized access control |

### Events (Audit Trail)

| Event | When It Fires |
|---|---|
| `CreditIssued(creditId, owner, tonnes, aiRiskScore, developerId, regulatorId, tokenId)` | Credit is minted |
| `CreditTransferred(creditId, from, to)` | Credit changes owner |
| `CreditRetired(creditId, owner)` | Credit is permanently burned |
| `MerkleRootUpdated(newRoot, totalCredits)` | Merkle tree is updated after a mint |

### Risk Score Encoding

The AI risk score is a float between 0 and 1, but Solidity doesn't do floats. So we multiply by 10,000 and store it as a uint256. For example 0.8451 becomes 8451 on chain. Divide by 10,000 to get the original float back.

---

## REST API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/credits/issue` | Scores the project with AI, mines PoW, signs both endorsements, mints on chain |
| `POST` | `/credits/pending` | Developer submits a credit for regulator review (AI scored but not minted yet) |
| `GET` | `/credits/pending` | Lists all credits waiting for regulator approval |
| `POST` | `/credits/approve/{pending_id}` | Regulator approves a pending credit, triggers on chain mint |
| `GET` | `/credits/{credit_id}` | Reads credit state from the contract |
| `GET` | `/credits/{credit_id}/proof` | Returns a Merkle inclusion proof for the credit |
| `GET` | `/chain/stats` | Live stats: chain ID, latest block, contract address, Merkle root, total credits |
| `GET` | `/chain/events` | All CreditIssued, CreditTransferred, and CreditRetired events |
| `GET` | `/stakeholders` | List of registered stakeholder names and addresses |

Transfer and retire are called directly from the browser through MetaMask and ethers.js, no server roundtrip needed.

---

## AI Scoring Layer — scoreProject() in ml/model.py

The model takes four features that get computed automatically from the project type and tonnes:

- **R_ratio**: tonnes divided by 50,000 (the peer average). Measures how inflated the claim is.
- **Vintage_Age**: 2026 minus the vintage year. Older projects are more suspicious.
- **M_flag**: 1 if the project type is historically high risk (Solar, REDD+, Wind, Hydro, etc.), 0 otherwise.
- **T_flag**: 1 if R_ratio is above 3.0 (extreme volume spike), 0 otherwise.

Returns a score between 0.0 and 1.0. Higher means more suspicious. Anything at or above 0.7 is flagged as HIGH RISK and the contract will reject it.

Example scores:
- Cookstoves project, 5,000 tonnes, recent vintage: **0.25** (low risk)
- Solar project, 600,000 tonnes, 18 year old vintage: **0.85** (high risk, rejected)

---

## Blockchain Principles Demonstrated

| Principle | Where in the Code |
|---|---|
| ERC721 NFT Standard | Every credit is a unique non fungible token. Transfers and burns use the ERC721 ledger. MetaMask shows them as NFTs. |
| ecrecover Multi Sig Endorsement | Minting requires valid ECDSA signatures from both a registered developer and a registered regulator. The contract recovers signer addresses on chain and checks them against the role registry. |
| Proof of Work | Every mint requires a nonce where keccak256(creditId + nonce) has the top 8 bits as zero. About 256 attempts on average. |
| Merkle Tree | Each credit is a leaf in an on chain Merkle tree. Inclusion proofs can be verified in O(log n) using OpenZeppelin MerkleProof. |
| Decentralization | The admin can register multiple independent registrars, developers, and regulators. No single address controls all roles. |
| Immutable Ledger | Every transaction is permanently recorded on Ethereum. |
| Audit Trail | Event logs for every issuance, transfer, and retirement. |

---

## Team

| # | Name | Role |
|---|------|------|
| 1 | **Harpreet Kaur Brar** | Chaincode and asset layer, project submission and query functions, frontend/UI development |
| 2 | **Sreeram Saravana Prasad** | Credit creation (minting logic), validation checks, AI risk score integration, frontend/UI development |
| 3 | **Asmi Umesh Pulgam** | Ownership updates and transaction handling, project report creation |
| 4 | **Brijesh Kumar** | Credit retirement logic and double spending prevention, frontend/UI development |
| 5 | **Vandhana Vemuri** | Audit functions, history tracking, endorsement policy configuration, project report creation |
