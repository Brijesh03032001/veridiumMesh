const hre = require("hardhat");

// Hardhat account #1 is our developer signer, account #6 is the regulator
const DEVELOPER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const REGULATOR_ADDRESS = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying CarbonCredit with account:", deployer.address);
  console.log(
    "Account balance:",
    (await hre.ethers.provider.getBalance(deployer.address)).toString()
  );

  const CarbonCredit = await hre.ethers.getContractFactory("CarbonCredit");
  const carbonCredit = await CarbonCredit.deploy();

  await carbonCredit.waitForDeployment();

  const address = await carbonCredit.getAddress();
  console.log("\n✅ CarbonCredit deployed to:", address);

  console.log("\nRegistering roles...");

  await (await carbonCredit.addDeveloper(DEVELOPER_ADDRESS)).wait();
  console.log(`  ✅ Developer registered: ${DEVELOPER_ADDRESS} (GreenBuild Solutions)`);

  await (await carbonCredit.addRegulator(REGULATOR_ADDRESS)).wait();
  console.log(`  ✅ Regulator registered: ${REGULATOR_ADDRESS} (EPA Registry)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
