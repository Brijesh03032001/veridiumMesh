// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// Each carbon credit is an ERC721 NFT. Minting requires proof of work,
// dual ECDSA signatures (one developer + one regulator), and the AI risk
// score must be below the rejection threshold. Every minted credit becomes
// a leaf in an on chain Merkle tree so anyone can verify inclusion later.
contract CarbonCredit is ERC721 {

    address public admin;
    mapping(address => bool) public isRegistrar;
    mapping(address => bool) public isDeveloper;
    mapping(address => bool) public isRegulator;

    // Top 8 bits of the hash must be zero. Roughly 256 attempts on average.
    uint256 public constant POW_DIFFICULTY = type(uint256).max >> 8;

    bytes32[] private _leafHashes;
    bytes32 public  merkleRoot;

    uint256 private _nextTokenId;

    struct Credit {
        uint256 tonnes;
        string  developerId;
        string  regulatorId;
        uint256 aiRiskScore;
        address mintedTo;       // we keep the original owner so the Merkle leaf stays stable after transfers
        bool    isRetired;
    }

    mapping(string  => Credit)  private _credits;
    mapping(string  => bool)    private _exists;
    mapping(string  => uint256) public  creditToTokenId;
    mapping(uint256 => string)  public  tokenToCreditId;

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

    constructor() ERC721("CarbonCredit", "CCR") {
        admin = msg.sender;
        isRegistrar[msg.sender] = true;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "CarbonCredit: caller is not the admin");
        _;
    }

    modifier onlyRegistrar() {
        require(isRegistrar[msg.sender], "CarbonCredit: caller is not a registrar");
        _;
    }

    // The admin can grant and revoke roles so no single address controls everything
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

    // Builds the EIP191 hash that both the developer and regulator need to sign off chain
    function endorsementHash(
        string  memory _creditId,
        uint256        _tonnes,
        address        _owner
    ) public pure returns (bytes32) {
        bytes32 raw = keccak256(abi.encodePacked(_creditId, _tonnes, _owner));
        return MessageHashUtils.toEthSignedMessageHash(raw);
    }

    // Main minting function. Checks PoW, validates inputs, recovers both
    // signatures, stores the credit, mints the NFT, and updates the Merkle tree.
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
        // proof of work check
        require(
            uint256(keccak256(abi.encodePacked(_creditId, _nonce))) <= POW_DIFFICULTY,
            "CarbonCredit: proof of work not satisfied"
        );

        require(!_exists[_creditId],            "CarbonCredit: creditId already exists");
        require(_tonnes > 0,                    "CarbonCredit: tonnes must be positive");
        require(bytes(_developerId).length > 0, "CarbonCredit: developerId required");
        require(bytes(_regulatorId).length > 0, "CarbonCredit: regulatorId required");
        require(_aiRiskScore < 7000,            "CarbonCredit: risk score too high, credit rejected");
        require(_owner != address(0),           "CarbonCredit: owner cannot be zero address");

        // recover who actually signed and make sure they have the right roles
        bytes32 hash       = endorsementHash(_creditId, _tonnes, _owner);
        address devSigner  = ECDSA.recover(hash, _developerSig);
        address regSigner  = ECDSA.recover(hash, _regulatorSig);
        require(isDeveloper[devSigner], "CarbonCredit: invalid developer signature");
        require(isRegulator[regSigner], "CarbonCredit: invalid regulator signature");
        require(devSigner != regSigner, "CarbonCredit: developer and regulator must differ");

        _credits[_creditId] = Credit({
            tonnes:      _tonnes,
            developerId: _developerId,
            regulatorId: _regulatorId,
            aiRiskScore: _aiRiskScore,
            mintedTo:    _owner,
            isRetired:   false
        });
        _exists[_creditId] = true;

        // mint the NFT
        uint256 tokenId = _nextTokenId++;
        creditToTokenId[_creditId] = tokenId;
        tokenToCreditId[tokenId]   = _creditId;
        _safeMint(_owner, tokenId);

        // add this credit as a leaf and recompute the Merkle root
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

    // Burning is permanent. We burn the NFT first then mark it retired.
    function retireCredit(string memory _creditId) external {
        require(_exists[_creditId],             "CarbonCredit: credit does not exist");
        require(!_credits[_creditId].isRetired, "CarbonCredit: credit is already retired");
        uint256 tokenId = creditToTokenId[_creditId];
        require(ownerOf(tokenId) == msg.sender, "CarbonCredit: caller is not the credit owner");

        _burn(tokenId);
        _credits[_creditId].isRetired = true;
        emit CreditRetired(_creditId, msg.sender);
    }

    // We block the standard ERC721 transfer functions so people have to go through transferCredit
    function transferFrom(address, address, uint256) public pure override {
        revert("CarbonCredit: use transferCredit()");
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert("CarbonCredit: use transferCredit()");
    }

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
        // ownerOf would revert for burned tokens so we return address(0) for retired ones
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

    // Uses mintedTo (not current owner) so the leaf hash doesn't change when credits get transferred
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

    // Rebuilds the full Merkle root from all leaves. Pairs are sorted before
    // hashing so the tree is order independent (matches how OZ MerkleProof works).
    function _computeMerkleRoot() internal view returns (bytes32) {
        uint256 n = _leafHashes.length;
        if (n == 0) return bytes32(0);
        if (n == 1) return _leafHashes[0];

        uint256 size = _nextPowerOf2(n);
        bytes32[] memory nodes = new bytes32[](size);
        for (uint256 i = 0; i < n; i++) nodes[i] = _leafHashes[i];

        while (size > 1) {
            uint256 half = size >> 1;
            for (uint256 i = 0; i < half; i++) {
                bytes32 a = nodes[2 * i];
                bytes32 b = nodes[2 * i + 1];
                nodes[i] = a < b
                    ? keccak256(abi.encodePacked(a, b))
                    : keccak256(abi.encodePacked(b, a));
            }
            size = half;
        }
        return nodes[0];
    }

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
