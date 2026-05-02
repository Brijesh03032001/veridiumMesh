const { expect } = require("chai");
const { ethers } = require("hardhat");

// ── Proof-of-Work helper ──────────────────────────────────────────────────────
const POW_DIFFICULTY = (2n ** 256n - 1n) >> 8n;

function mineNonce(creditId) {
  let nonce = 0n;
  while (true) {
    const hash = BigInt(
      ethers.solidityPackedKeccak256(["string", "uint256"], [creditId, nonce])
    );
    if (hash <= POW_DIFFICULTY) return nonce;
    nonce++;
  }
}

// ── Merkle leaf helper ────────────────────────────────────────────────────────
function creditLeaf(creditId, tonnes, ownerAddr, aiRiskScore) {
  return ethers.solidityPackedKeccak256(
    ["string", "uint256", "address", "uint256"],
    [creditId, tonnes, ownerAddr, aiRiskScore]
  );
}

// ── ecrecover endorsement signing helper ──────────────────────────────────────
// Mirrors Solidity: endorsementHash = toEthSignedMessageHash(keccak256(creditId ++ tonnes ++ owner))
async function signEndorsement(creditId, tonnes, ownerAddr, signer) {
  const raw = ethers.solidityPackedKeccak256(
    ["string", "uint256", "address"],
    [creditId, tonnes, ownerAddr]
  );
  return signer.signMessage(ethers.getBytes(raw));
}

describe("CarbonCredit", function () {
  let contract;
  let admin, developerSigner, regulatorSigner, buyer, stranger, extraRegistrar;

  beforeEach(async function () {
    [admin, developerSigner, regulatorSigner, buyer, stranger, extraRegistrar] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("CarbonCredit");
    contract = await Factory.deploy();
    await contract.waitForDeployment();

    await contract.addDeveloper(developerSigner.address);
    await contract.addRegulator(regulatorSigner.address);
  });

  // ── Role management (Decentralization) ───────────────────────────────────
  describe("Role management", function () {
    it("deployer is the admin", async function () {
      expect(await contract.admin()).to.equal(admin.address);
    });

    it("deployer is a registrar by default", async function () {
      expect(await contract.isRegistrar(admin.address)).to.equal(true);
    });

    it("admin can add a second registrar", async function () {
      await contract.addRegistrar(extraRegistrar.address);
      expect(await contract.isRegistrar(extraRegistrar.address)).to.equal(true);
    });

    it("admin can remove a registrar", async function () {
      await contract.addRegistrar(extraRegistrar.address);
      await contract.removeRegistrar(extraRegistrar.address);
      expect(await contract.isRegistrar(extraRegistrar.address)).to.equal(false);
    });

    it("non-admin cannot add a registrar", async function () {
      await expect(
        contract.connect(stranger).addRegistrar(stranger.address)
      ).to.be.revertedWith("CarbonCredit: caller is not the admin");
    });

    it("developerSigner is registered as developer", async function () {
      expect(await contract.isDeveloper(developerSigner.address)).to.equal(true);
    });

    it("regulatorSigner is registered as regulator", async function () {
      expect(await contract.isRegulator(regulatorSigner.address)).to.equal(true);
    });
  });

  // ── issueCredit ───────────────────────────────────────────────────────────
  describe("issueCredit", function () {
    it("mints ERC-721 NFT, emits CreditIssued, stores correct data", async function () {
      const nonce  = mineNonce("CRED-001");
      const devSig = await signEndorsement("CRED-001", 1000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-001", 1000, buyer.address, regulatorSigner);

      await expect(
        contract.issueCredit("CRED-001", 1000, "DEV-001", "REG-001", 2500, buyer.address, nonce, devSig, regSig)
      )
        .to.emit(contract, "CreditIssued")
        .withArgs("CRED-001", buyer.address, 1000, 2500, "DEV-001", "REG-001", 0n);

      const credit = await contract.getCredit("CRED-001");
      expect(credit.tonnes).to.equal(1000);
      expect(credit.owner).to.equal(buyer.address);
      expect(credit.isRetired).to.equal(false);
      expect(credit.tokenId).to.equal(0);
    });

    it("reverts on duplicate creditId", async function () {
      const nonce  = mineNonce("CRED-DUP");
      const devSig = await signEndorsement("CRED-DUP", 100, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-DUP", 100, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-DUP", 100, "D", "R", 1000, buyer.address, nonce, devSig, regSig);
      await expect(
        contract.issueCredit("CRED-DUP", 100, "D", "R", 1000, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: creditId already exists");
    });

    it("reverts when called by non-registrar", async function () {
      const nonce  = mineNonce("CRED-X");
      const devSig = await signEndorsement("CRED-X", 100, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-X", 100, buyer.address, regulatorSigner);
      await expect(
        contract.connect(stranger).issueCredit("CRED-X", 100, "D", "R", 1000, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: caller is not a registrar");
    });

    it("reverts when developerId is empty", async function () {
      const nonce  = mineNonce("CRED-NDEV");
      const devSig = await signEndorsement("CRED-NDEV", 100, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-NDEV", 100, buyer.address, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-NDEV", 100, "", "REG-001", 1000, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: developerId required");
    });

    it("reverts when regulatorId is empty", async function () {
      const nonce  = mineNonce("CRED-NREG");
      const devSig = await signEndorsement("CRED-NREG", 100, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-NREG", 100, buyer.address, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-NREG", 100, "DEV-001", "", 1000, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: regulatorId required");
    });

    it("reverts when tonnes is zero", async function () {
      const nonce  = mineNonce("CRED-ZERO");
      const devSig = await signEndorsement("CRED-ZERO", 0, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-ZERO", 0, buyer.address, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-ZERO", 0, "D", "R", 1000, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: tonnes must be positive");
    });

    it("reverts when risk score is too high", async function () {
      const nonce  = mineNonce("CRED-RISK");
      const devSig = await signEndorsement("CRED-RISK", 100, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-RISK", 100, buyer.address, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-RISK", 100, "D", "R", 7500, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: risk score too high, credit rejected");
    });

    it("reverts when owner is zero address", async function () {
      const nonce  = mineNonce("CRED-ZERO-ADDR");
      const devSig = await signEndorsement("CRED-ZERO-ADDR", 100, ethers.ZeroAddress, developerSigner);
      const regSig = await signEndorsement("CRED-ZERO-ADDR", 100, ethers.ZeroAddress, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-ZERO-ADDR", 100, "D", "R", 1000, ethers.ZeroAddress, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: owner cannot be zero address");
    });

    it("reverts when PoW nonce is invalid", async function () {
      const devSig = await signEndorsement("CRED-BADPOW", 100, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-BADPOW", 100, buyer.address, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-BADPOW", 100, "D", "R", 1000, buyer.address, 999999999n, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: proof of work not satisfied");
    });
  });

  // ── ecrecover multi-sig endorsement ──────────────────────────────────────
  describe("ecrecover endorsement", function () {
    it("reverts when developer signature is from an unregistered address", async function () {
      const nonce  = mineNonce("CRED-BADSIG1");
      const devSig = await signEndorsement("CRED-BADSIG1", 100, buyer.address, stranger);
      const regSig = await signEndorsement("CRED-BADSIG1", 100, buyer.address, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-BADSIG1", 100, "D", "R", 1000, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: invalid developer signature");
    });

    it("reverts when regulator signature is from an unregistered address", async function () {
      const nonce  = mineNonce("CRED-BADSIG2");
      const devSig = await signEndorsement("CRED-BADSIG2", 100, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-BADSIG2", 100, buyer.address, stranger);
      await expect(
        contract.issueCredit("CRED-BADSIG2", 100, "D", "R", 1000, buyer.address, nonce, devSig, regSig)
      ).to.be.revertedWith("CarbonCredit: invalid regulator signature");
    });

    it("reverts when developer and regulator are the same signer", async function () {
      await contract.addDeveloper(buyer.address);
      await contract.addRegulator(buyer.address);
      const nonce = mineNonce("CRED-SAMESIG");
      const sig   = await signEndorsement("CRED-SAMESIG", 100, buyer.address, buyer);
      await expect(
        contract.issueCredit("CRED-SAMESIG", 100, "D", "R", 1000, buyer.address, nonce, sig, sig)
      ).to.be.revertedWith("CarbonCredit: developer and regulator must differ");
    });

    it("endorsementHash is deterministic", async function () {
      const h1 = await contract.endorsementHash("CRED-X", 1000, buyer.address);
      const h2 = await contract.endorsementHash("CRED-X", 1000, buyer.address);
      expect(h1).to.equal(h2);
    });

    it("endorsementHash changes with different inputs", async function () {
      const h1 = await contract.endorsementHash("CRED-A", 1000, buyer.address);
      const h2 = await contract.endorsementHash("CRED-B", 1000, buyer.address);
      expect(h1).to.not.equal(h2);
    });
  });

  // ── ERC-721 token standard ────────────────────────────────────────────────
  describe("ERC-721", function () {
    beforeEach(async function () {
      const nonce  = mineNonce("CRED-NFT1");
      const devSig = await signEndorsement("CRED-NFT1", 500, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-NFT1", 500, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-NFT1", 500, "D", "R", 2000, buyer.address, nonce, devSig, regSig);
    });

    it("token name and symbol are correct", async function () {
      expect(await contract.name()).to.equal("CarbonCredit");
      expect(await contract.symbol()).to.equal("CCR");
    });

    it("minted credit has tokenId 0 and is owned by buyer", async function () {
      expect(await contract.ownerOf(0)).to.equal(buyer.address);
    });

    it("balanceOf returns 1 after one mint to buyer", async function () {
      expect(await contract.balanceOf(buyer.address)).to.equal(1);
    });

    it("creditToTokenId and tokenToCreditId are bidirectional", async function () {
      expect(await contract.creditToTokenId("CRED-NFT1")).to.equal(0);
      expect(await contract.tokenToCreditId(0)).to.equal("CRED-NFT1");
    });

    it("getTokenId returns the correct tokenId", async function () {
      expect(await contract.getTokenId("CRED-NFT1")).to.equal(0);
    });

    it("tokenId increments for each new mint", async function () {
      const nonce  = mineNonce("CRED-NFT2");
      const devSig = await signEndorsement("CRED-NFT2", 500, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-NFT2", 500, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-NFT2", 500, "D", "R", 2000, buyer.address, nonce, devSig, regSig);
      expect(await contract.getTokenId("CRED-NFT2")).to.equal(1);
    });

    it("retiring a credit burns the NFT (ownerOf reverts)", async function () {
      await contract.connect(buyer).retireCredit("CRED-NFT1");
      await expect(contract.ownerOf(0)).to.be.reverted;
    });

    it("direct transferFrom is blocked (use transferCredit instead)", async function () {
      await expect(
        contract.connect(buyer).transferFrom(buyer.address, stranger.address, 0)
      ).to.be.revertedWith("CarbonCredit: use transferCredit()");
    });
  });

  // ── Proof of Work ─────────────────────────────────────────────────────────
  describe("Proof of Work", function () {
    it("mineNonce() always produces a valid nonce", async function () {
      const creditId = "CRED-POW-TEST";
      const nonce    = mineNonce(creditId);
      const hash     = BigInt(
        ethers.solidityPackedKeccak256(["string", "uint256"], [creditId, nonce])
      );
      expect(hash <= POW_DIFFICULTY).to.equal(true);
    });

    it("POW_DIFFICULTY constant matches Solidity", async function () {
      expect(await contract.POW_DIFFICULTY()).to.equal(POW_DIFFICULTY);
    });

    it("emits MerkleRootUpdated after successful mint", async function () {
      const nonce  = mineNonce("CRED-MR1");
      const devSig = await signEndorsement("CRED-MR1", 500, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-MR1", 500, buyer.address, regulatorSigner);
      await expect(
        contract.issueCredit("CRED-MR1", 500, "D", "R", 1000, buyer.address, nonce, devSig, regSig)
      ).to.emit(contract, "MerkleRootUpdated");
    });
  });

  // ── Merkle Tree ───────────────────────────────────────────────────────────
  describe("Merkle Tree", function () {
    it("merkleRoot is zero before any credits are issued", async function () {
      expect(await contract.merkleRoot()).to.equal(ethers.ZeroHash);
    });

    it("merkleRoot equals the single leaf after one mint", async function () {
      const nonce  = mineNonce("CRED-MT1");
      const devSig = await signEndorsement("CRED-MT1", 1000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-MT1", 1000, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-MT1", 1000, "D", "R", 2000, buyer.address, nonce, devSig, regSig);

      const root = await contract.merkleRoot();
      const leaf = creditLeaf("CRED-MT1", 1000, buyer.address, 2000);
      expect(root).to.equal(leaf);
    });

    it("getCreditLeafHash is deterministic and uses mintedTo", async function () {
      const nonce  = mineNonce("CRED-MT2");
      const devSig = await signEndorsement("CRED-MT2", 2000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-MT2", 2000, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-MT2", 2000, "D", "R", 3000, buyer.address, nonce, devSig, regSig);

      const contractLeaf = await contract.getCreditLeafHash("CRED-MT2");
      const expectedLeaf = creditLeaf("CRED-MT2", 2000, buyer.address, 3000);
      expect(contractLeaf).to.equal(expectedLeaf);
    });

    it("leaf hash is stable after transfer (uses original mintedTo owner)", async function () {
      const nonce  = mineNonce("CRED-STABLE");
      const devSig = await signEndorsement("CRED-STABLE", 1000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-STABLE", 1000, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-STABLE", 1000, "D", "R", 2000, buyer.address, nonce, devSig, regSig);

      const leafBefore = await contract.getCreditLeafHash("CRED-STABLE");
      await contract.connect(buyer).transferCredit("CRED-STABLE", stranger.address);
      const leafAfter = await contract.getCreditLeafHash("CRED-STABLE");
      expect(leafBefore).to.equal(leafAfter);
    });

    it("totalCredits increments on each mint", async function () {
      expect(await contract.totalCredits()).to.equal(0);

      const n1 = mineNonce("CRED-TC1");
      const d1 = await signEndorsement("CRED-TC1", 100, buyer.address, developerSigner);
      const r1 = await signEndorsement("CRED-TC1", 100, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-TC1", 100, "D", "R", 1000, buyer.address, n1, d1, r1);
      expect(await contract.totalCredits()).to.equal(1);

      const n2 = mineNonce("CRED-TC2");
      const d2 = await signEndorsement("CRED-TC2", 200, stranger.address, developerSigner);
      const r2 = await signEndorsement("CRED-TC2", 200, stranger.address, regulatorSigner);
      await contract.issueCredit("CRED-TC2", 200, "D", "R", 1000, stranger.address, n2, d2, r2);
      expect(await contract.totalCredits()).to.equal(2);
    });

    it("verifyCredit returns true for valid single-leaf proof", async function () {
      const nonce  = mineNonce("CRED-VERIFY");
      const devSig = await signEndorsement("CRED-VERIFY", 1000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-VERIFY", 1000, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-VERIFY", 1000, "D", "R", 2500, buyer.address, nonce, devSig, regSig);

      const leaf  = await contract.getCreditLeafHash("CRED-VERIFY");
      const valid = await contract.verifyCredit([], leaf);
      expect(valid).to.equal(true);
    });

    it("verifyCredit returns false for tampered leaf", async function () {
      const nonce  = mineNonce("CRED-FAKE");
      const devSig = await signEndorsement("CRED-FAKE", 1000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-FAKE", 1000, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-FAKE", 1000, "D", "R", 2500, buyer.address, nonce, devSig, regSig);

      const fakeLeaf = ethers.keccak256(ethers.toUtf8Bytes("tampered"));
      const valid    = await contract.verifyCredit([], fakeLeaf);
      expect(valid).to.equal(false);
    });

    it("merkleRoot changes after each new mint", async function () {
      const n1 = mineNonce("CRED-CHANGE1");
      const d1 = await signEndorsement("CRED-CHANGE1", 100, buyer.address, developerSigner);
      const r1 = await signEndorsement("CRED-CHANGE1", 100, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-CHANGE1", 100, "D", "R", 1000, buyer.address, n1, d1, r1);
      const root1 = await contract.merkleRoot();

      const n2 = mineNonce("CRED-CHANGE2");
      const d2 = await signEndorsement("CRED-CHANGE2", 200, stranger.address, developerSigner);
      const r2 = await signEndorsement("CRED-CHANGE2", 200, stranger.address, regulatorSigner);
      await contract.issueCredit("CRED-CHANGE2", 200, "D", "R", 1000, stranger.address, n2, d2, r2);
      const root2 = await contract.merkleRoot();

      expect(root1).to.not.equal(root2);
    });
  });

  // ── transferCredit ────────────────────────────────────────────────────────
  describe("transferCredit", function () {
    beforeEach(async function () {
      const nonce  = mineNonce("CRED-T01");
      const devSig = await signEndorsement("CRED-T01", 1000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-T01", 1000, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-T01", 1000, "DEV", "REG", 5000, buyer.address, nonce, devSig, regSig);
    });

    it("transfers ownership and emits CreditTransferred", async function () {
      await expect(contract.connect(buyer).transferCredit("CRED-T01", stranger.address))
        .to.emit(contract, "CreditTransferred")
        .withArgs("CRED-T01", buyer.address, stranger.address);

      const credit = await contract.getCredit("CRED-T01");
      expect(credit.owner).to.equal(stranger.address);
    });

    it("ERC-721 ownerOf updates after transfer", async function () {
      await contract.connect(buyer).transferCredit("CRED-T01", stranger.address);
      expect(await contract.ownerOf(0)).to.equal(stranger.address);
    });

    it("balanceOf updates correctly after transfer", async function () {
      await contract.connect(buyer).transferCredit("CRED-T01", stranger.address);
      expect(await contract.balanceOf(buyer.address)).to.equal(0);
      expect(await contract.balanceOf(stranger.address)).to.equal(1);
    });

    it("reverts when caller is not the owner", async function () {
      await expect(
        contract.connect(stranger).transferCredit("CRED-T01", buyer.address)
      ).to.be.revertedWith("CarbonCredit: caller is not the credit owner");
    });

    it("reverts transfer to zero address", async function () {
      await expect(
        contract.connect(buyer).transferCredit("CRED-T01", ethers.ZeroAddress)
      ).to.be.revertedWith("CarbonCredit: cannot transfer to zero address");
    });

    it("reverts transfer to self", async function () {
      await expect(
        contract.connect(buyer).transferCredit("CRED-T01", buyer.address)
      ).to.be.revertedWith("CarbonCredit: cannot transfer to yourself");
    });
  });

  // ── retireCredit ──────────────────────────────────────────────────────────
  describe("retireCredit", function () {
    beforeEach(async function () {
      const nonce  = mineNonce("CRED-R01");
      const devSig = await signEndorsement("CRED-R01", 1000, buyer.address, developerSigner);
      const regSig = await signEndorsement("CRED-R01", 1000, buyer.address, regulatorSigner);
      await contract.issueCredit("CRED-R01", 1000, "DEV", "REG", 3000, buyer.address, nonce, devSig, regSig);
    });

    it("retires a credit, emits CreditRetired, marks isRetired true", async function () {
      await expect(contract.connect(buyer).retireCredit("CRED-R01"))
        .to.emit(contract, "CreditRetired")
        .withArgs("CRED-R01", buyer.address);

      const credit = await contract.getCredit("CRED-R01");
      expect(credit.isRetired).to.equal(true);
      expect(credit.owner).to.equal(ethers.ZeroAddress);
    });

    it("reverts transfer after retirement", async function () {
      await contract.connect(buyer).retireCredit("CRED-R01");
      await expect(
        contract.connect(buyer).transferCredit("CRED-R01", stranger.address)
      ).to.be.revertedWith("CarbonCredit: credit is already retired");
    });

    it("reverts double retire", async function () {
      await contract.connect(buyer).retireCredit("CRED-R01");
      await expect(
        contract.connect(buyer).retireCredit("CRED-R01")
      ).to.be.revertedWith("CarbonCredit: credit is already retired");
    });

    it("reverts when caller is not the owner", async function () {
      await expect(
        contract.connect(stranger).retireCredit("CRED-R01")
      ).to.be.revertedWith("CarbonCredit: caller is not the credit owner");
    });
  });
});
