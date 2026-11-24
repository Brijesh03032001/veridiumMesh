<div align="center">

![VeridiumMesh Banner](banner/image.png)

# VeridiumMesh
### AI-Gated Carbon Credit Verification on Ethereum

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?style=flat&logo=solidity&logoColor=white)](https://soliditylang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat&logo=next.js&logoColor=white)](https://nextjs.org)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.28-FFF100?style=flat&logo=hardhat&logoColor=black)](https://hardhat.org)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-1.5-F7931E?style=flat&logo=scikit-learn&logoColor=white)](https://scikit-learn.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

*CSE540 Blockchain — Team 16 · Arizona State University · Spring 2026*

**Risky credits are blocked *before* mint, not audited after the damage.**

</div>

---

## Highlights

- Built an **AI-gated blockchain issuance platform** for a carbon-credit market facing fraud, double-counting and over-issuance at **$2B+** scale, where suspicious credits never reach the smart contract.
- Trained an **Isolation Forest** on approximately **5,700 Berkeley VROD** carbon-credit projects and used a **0.7 risk threshold** to reject submissions before minting.
- Engineered **4 risk features** — `R_ratio`, `Vintage_Age`, `M_flag`, `T_flag` — catching patterns such as **600,000-tonne** solar claims and **18-year** vintages scoring around **0.85**, against low-risk **5,000-tonne** cookstove projects at **0.25**.
- Encoded AI risk as a `uint256` scaled by **10,000**, since Solidity has no floating point — preserving decimal precision on-chain while keeping the contract deterministic and audit-friendly.
- Implemented **dual ECDSA approval** with EIP-191 hashing and Solidity `ecrecover`, requiring **2 independent signatures** from a registered developer and a regulator before `issueCredit()` can mint.
- Built **ERC-721** issuance with **4 on-chain roles** — admin, registrar, developer, regulator — plus transfer and irreversible retirement flows logged through Ethereum events.
- Added **proof-of-work** anti-spam requiring the top **8 bits** of `keccak256(creditId + nonce)` to be zero, costing roughly **256 attempts** per mint on average.
- Stored each issued credit as a **Merkle-tree leaf** and exposed **O(log n)** inclusion proofs verifiable directly against the on-chain root, so auditors never have to trust the backend.
- Delivered an **8-step lifecycle** from MetaMask submission through AI scoring, regulator approval, PoW mining, dual-signature verification, ERC-721 minting, Merkle update, transfer and retirement.
- Exposed **9 FastAPI endpoints** for issuance, pending queues, regulator approval, credit lookup, Merkle proofs, chain stats, chain events and stakeholder discovery.
- Wrote **30+ Hardhat Mocha tests** covering PoW validation, dual-signature minting, role access control, transfers, retirement, Merkle proof verification and edge-case reverts, plus a **pytest + httpx** suite against the FastAPI request paths.
- Built **3 Next.js 16 surfaces** — Developer Console, Regulator Dashboard and Blockchain Explorer — connecting MetaMask signing, backend scoring, Web3.py minting and on-chain verification.

---

## Architecture

```mermaid
flowchart TB
    DEV["Developer<br/>MetaMask"] --> API["FastAPI · 9 endpoints"]
    REG["Regulator<br/>MetaMask"] --> API

    API --> ML["Isolation Forest<br/>~5,700 Berkeley VROD projects<br/>4 features · threshold 0.7"]
    ML -->|"score 0.7 or higher"| REJ["Rejected before mint"]
    ML -->|"score below 0.7"| QUEUE["Pending approval queue"]

    QUEUE --> SIG["Dual ECDSA approval<br/>EIP-191 · developer + regulator"]
    SIG --> POW["Proof of work<br/>top 8 bits of keccak256 = 0"]
    POW --> W3["Web3.py"]
    W3 --> SC["Solidity 0.8.28 contract<br/>ERC-721 · 4 roles<br/>risk as uint256 x 10,000"]

    SC --> MT["Merkle tree<br/>O(log n) inclusion proofs"]
    SC --> EVT["Ethereum events<br/>transfer · retirement"]

    MT --> UI
    EVT --> UI["Next.js 16 · 3 surfaces<br/>Developer · Regulator · Explorer"]
    API --> UI
```

## The 8-step issuance lifecycle

```mermaid
sequenceDiagram
    participant D as Developer
    participant A as FastAPI
    participant M as Isolation Forest
    participant R as Regulator
    participant C as Solidity contract
    participant T as Merkle tree

    D->>A: submit credit (MetaMask-signed)
    A->>M: score 4 risk features
    alt risk 0.7 or higher
        M-->>D: rejected before reaching the chain
    else risk below 0.7
        M-->>A: risk score (x10,000 as uint256)
        A->>R: queue for regulator approval
        R->>A: ECDSA signature (EIP-191)
        D->>A: ECDSA signature (EIP-191)
        A->>A: mine nonce until top 8 bits of keccak256 are zero
        A->>C: issueCredit() with 2 signatures + nonce
        C->>C: ecrecover both signatures, verify PoW
        C->>C: mint ERC-721
        C->>T: append leaf, update root
        C-->>D: tokenId + inclusion proof
    end
```

---

## Risk scoring in practice

| Project | Volume | Vintage | Risk score | Outcome |
|---|---|---|---|---|
| Cookstove | 5,000 t | recent | **0.25** | Issued |
| Solar | 600,000 t | 18 years | **0.85** | Rejected before mint |

## On-chain roles

| Role | Can do |
|---|---|
| **Admin** | Manage registrar, system parameters |
| **Registrar** | Register developers and regulators |
| **Developer** | Submit credits, sign issuance, transfer |
| **Regulator** | Approve or reject, co-sign issuance |

## Tech stack

**ML** Python · scikit-learn Isolation Forest · Pandas · NumPy
**Backend** FastAPI · Uvicorn · Pydantic · Web3.py · pytest · httpx
**Chain** Solidity 0.8.28 · ERC-721 · OpenZeppelin · Hardhat · Ethereum · ECDSA · EIP-191 · `ecrecover` · keccak256 PoW · Merkle proofs
**Frontend** Next.js 16 · TypeScript · Tailwind CSS · shadcn/ui · ethers.js · MetaMask

## Quick start

```bash
git clone https://github.com/Brijesh03032001/veridiumMesh.git
cd veridiumMesh
```

```bash
npx hardhat node          # local chain
npx hardhat run scripts/deploy.js --network localhost
npx hardhat test          # 30+ Mocha tests
```

```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --port 8000
pytest                    # FastAPI request-path suite
```

```bash
cd frontend && npm install && npm run dev
```

---

**Built by [Brijesh Kumar](https://github.com/Brijesh03032001)** · [Portfolio](https://brijeshbuilds.com) · [LinkedIn](https://linkedin.com/in/brijeshkumar03)
