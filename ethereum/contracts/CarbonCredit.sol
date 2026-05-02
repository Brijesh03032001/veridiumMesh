// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title  CarbonCredit
 * @notice AI-gated carbon credit registry implementing five blockchain principles:
 *
 *  1. ERC-721 NFT STANDARD — Every carbon credit is a Non-Fungible Token.
 *     Ownership is tracked by the ERC-721 ledger; MetaMask shows credits
 *     as NFTs automatically.  Retiring a credit burns the token permanently.
 *
 *  2. ecrecover MULTI-SIG ENDORSEMENT — Minting requires valid ECDSA signatures
 *     from BOTH a registered developer AND a registered regulator.  The
 *     contract recovers signer addresses on-chain via ECDSA.recover() and
 *     checks each against their respective role registry.
 *
 *  3. DECENTRALIZATION — The admin can register multiple independent registrars,
 *     developers, and regulators.  No single address controls every role.
 *
 *  4. PROOF OF WORK — Every mint requires a nonce whose keccak256 satisfies a
 *     leading-zero difficulty target (top 8 bits = 0, ≈ 256 hashes expected).
 *
 *  5. MERKLE TREE — Each credit is a leaf in an on-chain Merkle tree; inclusion
 *     proofs can be verified in O(log n) via OpenZeppelin MerkleProof.
 */
contract CarbonCredit is ERC721 {

    // ── Roles & Decentralization ───────────────────────────────────────────────
    address public admin;                          // deployer — manages role registry
    mapping(address => bool) public isRegistrar;   // can call issueCredit
    mapping(address => bool) public isDeveloper;   // must co-sign every mint
    mapping(address => bool) public isRegulator;   // must co-sign every mint

    // ── Proof of Work ─────────────────────────────────────────────────────────
    // The top 8 bits of keccak256(creditId ++ nonce) must be zero.
    // Probability per attempt = 1/256 → expected ≈ 256 hashes (< 1 second).
    uint256 public constant POW_DIFFICULTY = type(uint256).max >> 8;

    // ── Merkle Tree ───────────────────────────────────────────────────────────
    bytes32[] private _leafHashes;   // ordered list of credit leaf hashes
    bytes32 public  merkleRoot;      // current root, updated on every mint

    // ── ERC-721 token counter ─────────────────────────────────────────────────
    uint256 private _nextTokenId;

    // ── Credit storage ────────────────────────────────────────────────────────
    struct Credit {
        uint256 tonnes;
        string  developerId;
        string  regulatorId;
        uint256 aiRiskScore;
        address mintedTo;      // owner at mint time — used for stable Merkle leaf
        bool    isRetired;
    }

    mapping(string  => Credit)  private _credits;
    mapping(string  => bool)    private _exists;
    mapping(string  => uint256) public  creditToTokenId;  // creditId → ERC-721 tokenId
    mapping(uint256 => string)  public  tokenToCreditId;  // ERC-721 tokenId → creditId

    // ── Events ────────────────────────────────────────────────────────────────
    event CreditIssued(
        string  creditId,
        address indexed owner,
        uint256 tonnes,
        uint256 aiRiskScore,
        string  developerId,
        string  regulatorId,
        uint256 tokenId
    );
    event CreditTransferred(string creditId, address indexed from, address indexed to);
    event CreditRetired(string creditId, address indexed owner);
    event MerkleRootUpdated(bytes32 indexed newRoot, uint256 totalCredits);
    event RegistrarAdded(address indexed addr);
    event RegistrarRemoved(address indexed addr);
    event DeveloperAdded(address indexed addr);
    event RegulatorAdded(address indexed addr);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor() ERC721("CarbonCredit", "CCR") {
        admin = msg.sender;
        isRegistrar[msg.sender] = true;   // deployer is the first registrar
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "CarbonCredit: caller is not the admin");
        _;
    }

    modifier onlyRegistrar() {
        require(isRegistrar[msg.sender], "CarbonCredit: caller is not a registrar");
        _;
    }

    // ── Role management (Decentralization) ───────────────────────────────────

    function addRegistrar(address _addr) external onlyAdmin {
        isRegistrar[_addr] = true;
        emit RegistrarAdded(_addr);
    }

    function removeRegistrar(address _addr) external onlyAdmin {
        isRegistrar[_addr] = false;
        emit RegistrarRemoved(_addr);
    }

    function addDeveloper(address _addr) external onlyAdmin {
        isDeveloper[_addr] = true;
        emit DeveloperAdded(_addr);
    }

    function addRegulator(address _addr) external onlyAdmin {
        isRegulator[_addr] = true;
        emit RegulatorAdded(_addr);
    }

    // ── ecrecover endorsement helper ──────────────────────────────────────────

    /**
     * @notice Returns the EIP-191 hash that developers and regulators must sign
     *         off-chain before a credit can be minted.
     *         Message = toEthSignedMessageHash(keccak256(creditId ++ tonnes ++ owner))
     */
    function endorsementHash(
        string  memory _creditId,
        uint256        _tonnes,
        address        _owner
    ) public pure returns (bytes32) {
        bytes32 raw = keccak256(abi.encodePacked(_creditId, _tonnes, _owner));
        return MessageHashUtils.toEthSignedMessageHash(raw);
    }

    // ── Core functions ────────────────────────────────────────────────────────

    /**
     * @notice Mint a new carbon credit (ERC-721 NFT).
     * @param _nonce         PoW nonce: keccak256(creditId ++ nonce) <= POW_DIFFICULTY.
     * @param _developerSig  65-byte ECDSA signature from a registered developer.
     * @param _regulatorSig  65-byte ECDSA signature from a registered regulator.
     */
    function issueCredit(
        string  memory _creditId,
        uint256        _tonnes,
        string  memory _developerId,
        string  memory _regulatorId,
        uint256        _aiRiskScore,
        address        _owner,
        uint256        _nonce,
        bytes   memory _developerSig,
        bytes   memory _regulatorSig
    ) external onlyRegistrar {
        // 1. Proof-of-Work check
        require(
            uint256(keccak256(abi.encodePacked(_creditId, _nonce))) <= POW_DIFFICULTY,
            "CarbonCredit: proof of work not satisfied"
        );

        // 2. Business-rule validations
        require(!_exists[_creditId],            "CarbonCredit: creditId already exists");
        require(_tonnes > 0,                    "CarbonCredit: tonnes must be positive");
        require(bytes(_developerId).length > 0, "CarbonCredit: developerId required");
        require(bytes(_regulatorId).length > 0, "CarbonCredit: regulatorId required");
        require(_aiRiskScore < 7000,            "CarbonCredit: risk score too high, credit rejected");
        require(_owner != address(0),           "CarbonCredit: owner cannot be zero address");

        // 3. ecrecover — verify dual endorsement signatures
        bytes32 hash       = endorsementHash(_creditId, _tonnes, _owner);
        address devSigner  = ECDSA.recover(hash, _developerSig);
        address regSigner  = ECDSA.recover(hash, _regulatorSig);
        require(isDeveloper[devSigner], "CarbonCredit: invalid developer signature");
        require(isRegulator[regSigner], "CarbonCredit: invalid regulator signature");
        require(devSigner != regSigner, "CarbonCredit: developer and regulator must differ");

        // 4. Store credit data
        _credits[_creditId] = Credit({
            tonnes:      _tonnes,
            developerId: _developerId,
            regulatorId: _regulatorId,
            aiRiskScore: _aiRiskScore,
            mintedTo:    _owner,
            isRetired:   false
        });
        _exists[_creditId] = true;

        // 5. Mint ERC-721 NFT — each credit is a unique non-fungible token
        uint256 tokenId = _nextTokenId++;
        creditToTokenId[_creditId] = tokenId;
        tokenToCreditId[tokenId]   = _creditId;
        _safeMint(_owner, tokenId);

        // 6. Merkle tree update
        bytes32 leaf = keccak256(abi.encodePacked(_creditId, _tonnes, _owner, _aiRiskScore));
        _leafHashes.push(leaf);
        merkleRoot = _computeMerkleRoot();

        emit CreditIssued(_creditId, _owner, _tonnes, _aiRiskScore, _developerId, _regulatorId, tokenId);
        emit MerkleRootUpdated(merkleRoot, _leafHashes.length);
    }

    function transferCredit(string memory _creditId, address _to) external {
        require(_exists[_creditId],                          "CarbonCredit: credit does not exist");
        require(!_credits[_creditId].isRetired,              "CarbonCredit: credit is already retired");
        uint256 tokenId = creditToTokenId[_creditId];
        require(ownerOf(tokenId) == msg.sender,              "CarbonCredit: caller is not the credit owner");
        require(_to != address(0),                           "CarbonCredit: cannot transfer to zero address");
        require(_to != msg.sender,                           "CarbonCredit: cannot transfer to yourself");

        _transfer(msg.sender, _to, tokenId);
        emit CreditTransferred(_creditId, msg.sender, _to);
    }

    function retireCredit(string memory _creditId) external {
        require(_exists[_creditId],             "CarbonCredit: credit does not exist");
        require(!_credits[_creditId].isRetired, "CarbonCredit: credit is already retired");
        uint256 tokenId = creditToTokenId[_creditId];
        require(ownerOf(tokenId) == msg.sender, "CarbonCredit: caller is not the credit owner");

        // Burn the NFT first (before marking retired, to avoid _update conflicts)
        _burn(tokenId);
        _credits[_creditId].isRetired = true;
        emit CreditRetired(_creditId, msg.sender);
    }

    // ── Disable direct ERC-721 transfers (domain logic requires transferCredit) ─
    function transferFrom(address, address, uint256) public pure override {
        revert("CarbonCredit: use transferCredit()");
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert("CarbonCredit: use transferCredit()");
    }

    // ── Read functions ────────────────────────────────────────────────────────

    function getCredit(string memory _creditId)
        external view
        returns (
            uint256 tonnes,
            string  memory developerId,
            string  memory regulatorId,
            uint256 aiRiskScore,
            address owner,
            bool    isRetired,
            uint256 tokenId
        )
    {
        require(_exists[_creditId], "CarbonCredit: credit does not exist");
        Credit storage c = _credits[_creditId];
        uint256 tid = creditToTokenId[_creditId];
        // ownerOf reverts for burned tokens; return address(0) for retired credits
        address cur = c.isRetired ? address(0) : ownerOf(tid);
        return (c.tonnes, c.developerId, c.regulatorId, c.aiRiskScore, cur, c.isRetired, tid);
    }

    function doesCreditExist(string memory _creditId) external view returns (bool) {
        return _exists[_creditId];
    }

    function totalCredits() external view returns (uint256) {
        return _leafHashes.length;
    }

    function getTokenId(string memory _creditId) external view returns (uint256) {
        require(_exists[_creditId], "CarbonCredit: credit does not exist");
        return creditToTokenId[_creditId];
    }

    /**
     * @notice Returns the Merkle leaf hash for a credit.
     *         Uses mintedTo (original owner) so the leaf is stable after transfers.
     */
    function getCreditLeafHash(string memory _creditId)
        external view
        returns (bytes32)
    {
        require(_exists[_creditId], "CarbonCredit: credit does not exist");
        Credit storage c = _credits[_creditId];
        return keccak256(abi.encodePacked(_creditId, c.tonnes, c.mintedTo, c.aiRiskScore));
    }

    function verifyCredit(bytes32[] calldata proof, bytes32 leaf)
        external view
        returns (bool)
    {
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    // ── Internal: Merkle root computation ────────────────────────────────────

    function _computeMerkleRoot() internal view returns (bytes32) {
        uint256 n = _leafHashes.length;
        if (n == 0) return bytes32(0);
        if (n == 1) return _leafHashes[0];

        uint256 size = _nextPowerOf2(n);
        bytes32[] memory nodes = new bytes32[](size);
        for (uint256 i = 0; i < n; i++) nodes[i] = _leafHashes[i];
        // remaining nodes are implicitly bytes32(0)

        while (size > 1) {
            uint256 half = size >> 1;
            for (uint256 i = 0; i < half; i++) {
                bytes32 a = nodes[2 * i];
                bytes32 b = nodes[2 * i + 1];
                // Sort so the tree is order-independent (matches OZ MerkleProof)
                nodes[i] = a < b
                    ? keccak256(abi.encodePacked(a, b))
                    : keccak256(abi.encodePacked(b, a));
            }
            size = half;
        }
        return nodes[0];
    }

    /// @dev Returns the smallest power of two that is >= n.
    function _nextPowerOf2(uint256 n) internal pure returns (uint256) {
        if (n <= 1) return 1;
        n--;
        n |= n >> 1;
        n |= n >> 2;
        n |= n >> 4;
        n |= n >> 8;
        n |= n >> 16;
        n |= n >> 32;
        n |= n >> 64;
        n |= n >> 128;
        return n + 1;
    }
}
