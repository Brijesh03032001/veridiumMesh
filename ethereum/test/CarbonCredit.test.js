const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CarbonCredit", function () {
  let contract;
  let developer, buyer, stranger;

  beforeEach(async function () {
    [, developer, buyer, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CarbonCredit");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  describe("issueCredit", function () {
    it("emits CreditIssued and stores correct data", async function () {
      await expect(
        contract.issueCredit("CRED-001", 1000, "DEV-001", "REG-001", 2500, developer.address)
      )
        .to.emit(contract, "CreditIssued")
        .withArgs("CRED-001", developer.address, 1000, 2500, "DEV-001", "REG-001");

      const credit = await contract.getCredit("CRED-001");
      expect(credit.tonnes).to.equal(1000);
      expect(credit.owner).to.equal(developer.address);
      expect(credit.isRetired).to.equal(false);
    });

    it("reverts on duplicate creditId", async function () {
      await contract.issueCredit("CRED-DUP", 100, "D", "R", 1000, developer.address);
      await expect(
        contract.issueCredit("CRED-DUP", 100, "D", "R", 1000, developer.address)
      ).to.be.revertedWith("CarbonCredit: creditId already exists");
    });

    it("reverts when called by non-registrar", async function () {
      await expect(
        contract.connect(stranger).issueCredit("CRED-X", 100, "D", "R", 1000, developer.address)
      ).to.be.revertedWith("CarbonCredit: caller is not the registrar");
    });

    it("reverts when developerId is empty", async function () {
      await expect(
        contract.issueCredit("CRED-NDEV", 100, "", "REG-001", 1000, developer.address)
      ).to.be.revertedWith("CarbonCredit: developerId required");
    });

    it("reverts when regulatorId is empty", async function () {
      await expect(
        contract.issueCredit("CRED-NREG", 100, "DEV-001", "", 1000, developer.address)
      ).to.be.revertedWith("CarbonCredit: regulatorId required");
    });

    it("reverts when tonnes is zero", async function () {
      await expect(
        contract.issueCredit("CRED-ZERO", 0, "D", "R", 1000, developer.address)
      ).to.be.revertedWith("CarbonCredit: tonnes must be positive");
    });

    it("reverts when risk score is too high", async function () {
      await expect(
        contract.issueCredit("CRED-RISK", 100, "D", "R", 7500, developer.address)
      ).to.be.revertedWith("CarbonCredit: risk score too high, credit rejected");
    });

    it("reverts when owner is zero address", async function () {
      await expect(
        contract.issueCredit("CRED-ZERO-ADDR", 100, "D", "R", 1000, ethers.ZeroAddress)
      ).to.be.revertedWith("CarbonCredit: owner cannot be zero address");
    });
  });

  describe("transferCredit", function () {
    beforeEach(async function () {
      await contract.issueCredit("CRED-T01", 1000, "DEV", "REG", 5000, developer.address);
    });

    it("transfers ownership and emits CreditTransferred", async function () {
      await expect(contract.connect(developer).transferCredit("CRED-T01", buyer.address))
        .to.emit(contract, "CreditTransferred")
        .withArgs("CRED-T01", developer.address, buyer.address);

      const credit = await contract.getCredit("CRED-T01");
      expect(credit.owner).to.equal(buyer.address);
    });

    it("reverts when caller is not the owner", async function () {
      await expect(
        contract.connect(stranger).transferCredit("CRED-T01", buyer.address)
      ).to.be.revertedWith("CarbonCredit: caller is not the credit owner");
    });

    it("reverts transfer to zero address", async function () {
      await expect(
        contract.connect(developer).transferCredit("CRED-T01", ethers.ZeroAddress)
      ).to.be.revertedWith("CarbonCredit: cannot transfer to zero address");
    });

    it("reverts transfer to self", async function () {
      await expect(
        contract.connect(developer).transferCredit("CRED-T01", developer.address)
      ).to.be.revertedWith("CarbonCredit: cannot transfer to yourself");
    });
  });

  describe("retireCredit", function () {
    beforeEach(async function () {
      await contract.issueCredit("CRED-R01", 1000, "DEV", "REG", 3000, developer.address);
    });

    it("retires a credit and emits CreditRetired", async function () {
      await expect(contract.connect(developer).retireCredit("CRED-R01"))
        .to.emit(contract, "CreditRetired")
        .withArgs("CRED-R01", developer.address);

      const credit = await contract.getCredit("CRED-R01");
      expect(credit.isRetired).to.equal(true);
    });

    it("reverts transfer after retirement", async function () {
      await contract.connect(developer).retireCredit("CRED-R01");
      await expect(
        contract.connect(developer).transferCredit("CRED-R01", buyer.address)
      ).to.be.revertedWith("CarbonCredit: credit is already retired");
    });

    it("reverts double retire", async function () {
      await contract.connect(developer).retireCredit("CRED-R01");
      await expect(
        contract.connect(developer).retireCredit("CRED-R01")
      ).to.be.revertedWith("CarbonCredit: credit is already retired");
    });

    it("reverts when caller is not the owner", async function () {
      await expect(
        contract.connect(stranger).retireCredit("CRED-R01")
      ).to.be.revertedWith("CarbonCredit: caller is not the credit owner");
    });
  });
});
