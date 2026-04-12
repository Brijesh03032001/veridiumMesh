/**
 * deploy.js — Deploy CarbonCredit.sol to the local Hardhat network.
 *
 * Usage:
 *   # In one terminal (keep it running):
 *   npx hardhat node
 *
 *   # In a second terminal:
 *   npx hardhat run scripts/deploy.js --network localhost
 *
 * The script prints the deployed contract address.
 * Copy that address into api/app.py → CONTRACT_ADDRESS.
 */

const hre = require("hardhat");

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
  console.log(
    "\nNext step → copy this address into api/app.py as CONTRACT_ADDRESS"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
