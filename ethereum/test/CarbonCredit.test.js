/**
 * CarbonCredit.test.js — Basic unit tests for CarbonCredit.sol
 *
 * Run:  npx hardhat test
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CarbonCredit", function () {
  let carbonCredit;
  let owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const CarbonCredit = await ethers.getContractFactory("CarbonCredit");
    carbonCredit = await CarbonCredit.deploy();
    await carbonCredit.waitForDeployment();
  });

  // -------------------------------------------------------------------------
  // issueCredit
  // -------------------------------------------------------------------------

  describe("issueCredit", function () {
    it("should issue a credit and emit CreditIssued event", async function () {
      await expect(
        carbonCredit.issueCredit(
          "CRED-TEST01",
          1000,
          "DEV-001",
          "REG-001",
          2464  // 0.2464 × 10000
        )
      )
        .to.emit(carbonCredit, "CreditIssued")
        .withArgs("CRED-TEST01", owner.address, 1000, 2464, "DEV-001", "REG-001");
    });

    it("should store correct credit data", async function () {
      await carbonCredit.issueCredit("CRED-TEST02", 500, "DEV-002", "REG-002", 8451);
      const credit = await carbonCredit.getCredit("CRED-TEST02");
      expect(credit.tonnes).to.equal(500);
      expect(credit.aiRiskScore).to.equal(8451);
      expect(credit.owner).to.equal(owner.address);
      expect(credit.isRetired).to.equal(false);
    });

    it("should revert on duplicate creditId", async function () {
      await carbonCredit.issueCredit("CRED-DUP", 100, "D", "R", 1000);
      await expect(
        carbonCredit.issueCredit("CRED-DUP", 100, "D", "R", 1000)
      ).to.be.revertedWith("CarbonCredit: creditId already exists");
    });

    it("should revert when developerId is empty (endorsement policy)", async function () {
      await expect(
        carbonCredit.issueCredit("CRED-NDEV", 100, "", "REG-001", 1000)
      ).to.be.revertedWith("CarbonCredit: developerId required (endorsement)");
    });

    it("should revert when regulatorId is empty (endorsement policy)", async function () {
      await expect(
        carbonCredit.issueCredit("CRED-NREG", 100, "DEV-001", "", 1000)
      ).to.be.revertedWith("CarbonCredit: regulatorId required (endorsement)");
    });

    it("should revert when tonnes is zero", async function () {
      await expect(
        carbonCredit.issueCredit("CRED-ZERO", 0, "D", "R", 0)
      ).to.be.revertedWith("CarbonCredit: tonnes must be positive");
    });
  });

  // -------------------------------------------------------------------------
  // transferCredit
  // -------------------------------------------------------------------------

  describe("transferCredit", function () {
    beforeEach(async function () {
      await carbonCredit.issueCredit("CRED-T01", 1000, "DEV", "REG", 5000);
    });

    it("should transfer ownership and emit CreditTransferred event", async function () {
      await expect(carbonCredit.transferCredit("CRED-T01", addr1.address))
        .to.emit(carbonCredit, "CreditTransferred")
        .withArgs("CRED-T01", owner.address, addr1.address);

      const credit = await carbonCredit.getCredit("CRED-T01");
      expect(credit.owner).to.equal(addr1.address);
    });

    it("should revert when caller is not the owner", async function () {
      await expect(
        carbonCredit.connect(addr1).transferCredit("CRED-T01", addr2.address)
      ).to.be.revertedWith("CarbonCredit: caller is not the credit owner");
    });

    it("should revert transfer to zero address", async function () {
      await expect(
        carbonCredit.transferCredit("CRED-T01", ethers.ZeroAddress)
      ).to.be.revertedWith("CarbonCredit: cannot transfer to zero address");
    });

    it("should revert transfer to self", async function () {
      await expect(
        carbonCredit.transferCredit("CRED-T01", owner.address)
      ).to.be.revertedWith("CarbonCredit: cannot transfer to yourself");
    });
  });

  // -------------------------------------------------------------------------
  // retireCredit
  // -------------------------------------------------------------------------

  describe("retireCredit", function () {
    beforeEach(async function () {
      await carbonCredit.issueCredit("CRED-R01", 1000, "DEV", "REG", 3000);
    });

    it("should retire a credit and emit CreditRetired event", async function () {
      await expect(carbonCredit.retireCredit("CRED-R01"))
        .to.emit(carbonCredit, "CreditRetired")
        .withArgs("CRED-R01", owner.address);

      const credit = await carbonCredit.getCredit("CRED-R01");
      expect(credit.isRetired).to.equal(true);
    });

    it("should revert transfer of a retired credit", async function () {
      await carbonCredit.retireCredit("CRED-R01");
      await expect(
        carbonCredit.transferCredit("CRED-R01", addr1.address)
      ).to.be.revertedWith("CarbonCredit: credit is already retired");
    });

    it("should revert double-retire", async function () {
      await carbonCredit.retireCredit("CRED-R01");
      await expect(
        carbonCredit.retireCredit("CRED-R01")
      ).to.be.revertedWith("CarbonCredit: credit is already retired");
    });

    it("should revert when caller is not owner", async function () {
      await expect(
        carbonCredit.connect(addr1).retireCredit("CRED-R01")
      ).to.be.revertedWith("CarbonCredit: caller is not the credit owner");
    });
  });
});
