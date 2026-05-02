import { JsonRpcProvider, BrowserProvider, Wallet, Contract } from "ethers";
import type { Eip1193Provider } from "ethers";

export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const RPC_URL = process.env.NEXT_PUBLIC_HARDHAT_RPC ?? "http://127.0.0.1:8545";

const ABI = [
  // ── Core domain functions ────────────────────────────────────────────────
  "function transferCredit(string _creditId, address _to) external",
  "function retireCredit(string _creditId) external",
  "function getCredit(string _creditId) external view returns (uint256 tonnes, string developerId, string regulatorId, uint256 aiRiskScore, address owner, bool isRetired, uint256 tokenId)",
  "function doesCreditExist(string _creditId) external view returns (bool)",
  "function getTokenId(string _creditId) external view returns (uint256)",
  // ── ERC-721 standard ──────────────────────────────────────────────────────
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function creditToTokenId(string) external view returns (uint256)",
  "function tokenToCreditId(uint256) external view returns (string)",
  // ── Merkle Tree ───────────────────────────────────────────────────────────
  "function merkleRoot() external view returns (bytes32)",
  "function totalCredits() external view returns (uint256)",
  "function getCreditLeafHash(string _creditId) external view returns (bytes32)",
  "function verifyCredit(bytes32[] calldata proof, bytes32 leaf) external view returns (bool)",
  // ── ecrecover & roles (read-only) ─────────────────────────────────────────
  "function endorsementHash(string _creditId, uint256 _tonnes, address _owner) external pure returns (bytes32)",
  "function admin() external view returns (address)",
  "function isRegistrar(address) external view returns (bool)",
  "function isDeveloper(address) external view returns (bool)",
  "function isRegulator(address) external view returns (bool)",
  // ── PoW ───────────────────────────────────────────────────────────────────
  "function POW_DIFFICULTY() external view returns (uint256)",
];

export const REGISTRAR_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export const HARDHAT_WALLETS: Record<string, { name: string; role: string; privateKey: string }> = {
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266": {
    name: "VeridiumAI",
    role: "Registrar",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": {
    name: "GreenBuild Solutions",
    role: "Developer",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": {
    name: "EcoForest Initiative",
    role: "Developer",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906": {
    name: "SolarVerde Projects",
    role: "Developer",
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  },
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65": {
    name: "CarbonMarket Exchange",
    role: "Buyer",
    privateKey: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926b",
  },
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc": {
    name: "BlueSky Offset Fund",
    role: "Buyer",
    privateKey: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  },
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9": {
    name: "EPA Registry",
    role: "Regulator",
    privateKey: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  },
};

// ── Hardhat wallet helpers (existing – use pre-loaded private keys) ────────────

function getWallet(signerAddress: string): Wallet {
  const entry = HARDHAT_WALLETS[signerAddress];
  if (!entry) throw new Error(`No wallet found for ${signerAddress}`);
  const provider = new JsonRpcProvider(RPC_URL);
  return new Wallet(entry.privateKey, provider);
}

export async function transferCreditOnChain(creditId: string, to: string, signerAddress: string): Promise<string> {
  const wallet = getWallet(signerAddress);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, wallet);
  const tx = await contract.transferCredit(creditId, to);
  await tx.wait();
  return tx.hash as string;
}

export async function retireCreditOnChain(creditId: string, signerAddress: string): Promise<string> {
  const wallet = getWallet(signerAddress);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, wallet);
  const tx = await contract.retireCredit(creditId);
  await tx.wait();
  return tx.hash as string;
}

// ── MetaMask helpers (real browser wallet signing) ────────────────────────────

export function isMetaMaskAvailable(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function getMetaMaskAddress(): Promise<string> {
  if (!isMetaMaskAvailable()) throw new Error("MetaMask is not installed.");
  const provider = new BrowserProvider(window.ethereum as Eip1193Provider);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  return signer.address;
}

export async function transferCreditWithMetaMask(creditId: string, to: string): Promise<string> {
  if (!isMetaMaskAvailable()) throw new Error("MetaMask is not installed.");
  const provider = new BrowserProvider(window.ethereum as Eip1193Provider);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
  const tx = await contract.transferCredit(creditId, to);
  await tx.wait();
  return tx.hash as string;
}

export async function retireCreditWithMetaMask(creditId: string): Promise<string> {
  if (!isMetaMaskAvailable()) throw new Error("MetaMask is not installed.");
  const provider = new BrowserProvider(window.ethereum as Eip1193Provider);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
  const tx = await contract.retireCredit(creditId);
  await tx.wait();
  return tx.hash as string;
}

// ── Merkle Tree helpers (read-only) ──────────────────────────────────────────

export async function getMerkleRoot(): Promise<string> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  const root = await contract.merkleRoot() as string;
  return root;
}

export async function getCreditLeafHash(creditId: string): Promise<string> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return (await contract.getCreditLeafHash(creditId)) as string;
}

export async function verifyCredit(proof: string[], leaf: string): Promise<boolean> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return (await contract.verifyCredit(proof, leaf)) as boolean;
}

export async function getTotalCredits(): Promise<number> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return Number(await contract.totalCredits());
}

// ── ERC-721 helpers (read-only) ───────────────────────────────────────────────

export async function getTokenOwner(tokenId: number): Promise<string> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return (await contract.ownerOf(tokenId)) as string;
}

export async function getTokenBalance(ownerAddress: string): Promise<number> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return Number(await contract.balanceOf(ownerAddress));
}

export async function getTokenId(creditId: string): Promise<number> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return Number(await contract.getTokenId(creditId));
}

// ── Role helpers (read-only) ──────────────────────────────────────────────────

export async function isRegistrar(address: string): Promise<boolean> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return (await contract.isRegistrar(address)) as boolean;
}

export async function isDeveloper(address: string): Promise<boolean> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return (await contract.isDeveloper(address)) as boolean;
}

export async function isRegulator(address: string): Promise<boolean> {
  const provider = new JsonRpcProvider(RPC_URL);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);
  return (await contract.isRegulator(address)) as boolean;
}
