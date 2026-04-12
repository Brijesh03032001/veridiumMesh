// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CarbonCredit
 * @notice AI-powered carbon credit registry.
 *         Each credit is minted by the VeridiumAI backend (which first runs
 *         the Isolation Forest fraud scorer), then transferred or retired by
 *         the credit owner via MetaMask.
 *
 * Design decisions mirrored from the Python CarbonCreditContract:
 *  - Endorsement policy: developerId + regulatorId must be non-empty to mint.
 *  - ai_risk_score is stored as uint256 = float * 10_000 (e.g. 0.8451 → 8451).
 *  - Only the current owner may transfer or retire a credit.
 *  - A retired credit can never be transferred again.
 *  - All state changes emit an event (replacing the Python chain-walk audit trail).
 */
contract CarbonCredit {

    // -----------------------------------------------------------------------
    // Data structures
    // -----------------------------------------------------------------------

    struct Credit {
        uint256 tonnes;         // CO₂ tonnes represented by this credit
        string  developerId;    // project developer (endorsement party 1)
        string  regulatorId;    // regulator who approved (endorsement party 2)
        uint256 aiRiskScore;    // fraud score × 10_000  (0 = clean, 10000 = max risk)
        address owner;          // current owner's Ethereum address
        bool    isRetired;      // once true, credit can no longer be transferred
    }

    // creditId (string) → Credit
    mapping(string => Credit) private _credits;

    // Track which creditIds exist so we can revert on duplicates
    mapping(string => bool) private _exists;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event CreditIssued(
        string  indexed creditId,
        address indexed owner,
        uint256 tonnes,
        uint256 aiRiskScore,
        string  developerId,
        string  regulatorId
    );

    event CreditTransferred(
        string  indexed creditId,
        address indexed from,
        address indexed to
    );

    event CreditRetired(
        string  indexed creditId,
        address indexed owner
    );

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier creditExists(string memory _creditId) {
        require(_exists[_creditId], "CarbonCredit: credit does not exist");
        _;
    }

    modifier onlyOwner(string memory _creditId) {
        require(
            _credits[_creditId].owner == msg.sender,
            "CarbonCredit: caller is not the credit owner"
        );
        _;
    }

    modifier notRetired(string memory _creditId) {
        require(
            !_credits[_creditId].isRetired,
            "CarbonCredit: credit is already retired"
        );
        _;
    }

    // -----------------------------------------------------------------------
    // Write functions
    // -----------------------------------------------------------------------

    /**
     * @notice Issue a new carbon credit.
     * @dev Called by the FastAPI backend (Account #0 on the local Hardhat node).
     *      Both developerId and regulatorId must be non-empty — this mirrors the
     *      dual-endorsement policy from the Python CarbonCreditContract.
     *
     * @param _creditId     Unique credit identifier (e.g. "CRED-1A2B3C4D")
     * @param _tonnes       Number of CO₂ tonnes this credit represents
     * @param _developerId  Project developer identifier
     * @param _regulatorId  Regulator / approver identifier
     * @param _aiRiskScore  Isolation Forest score × 10_000
     */
    function issueCredit(
        string memory _creditId,
        uint256       _tonnes,
        string memory _developerId,
        string memory _regulatorId,
        uint256       _aiRiskScore
    ) external {
        require(!_exists[_creditId],        "CarbonCredit: creditId already exists");
        require(_tonnes > 0,                "CarbonCredit: tonnes must be positive");
        require(bytes(_developerId).length > 0, "CarbonCredit: developerId required (endorsement)");
        require(bytes(_regulatorId).length > 0, "CarbonCredit: regulatorId required (endorsement)");
        require(_aiRiskScore <= 10000,      "CarbonCredit: aiRiskScore must be <= 10000");

        _credits[_creditId] = Credit({
            tonnes:      _tonnes,
            developerId: _developerId,
            regulatorId: _regulatorId,
            aiRiskScore: _aiRiskScore,
            owner:       msg.sender,
            isRetired:   false
        });
        _exists[_creditId] = true;

        emit CreditIssued(_creditId, msg.sender, _tonnes, _aiRiskScore, _developerId, _regulatorId);
    }

    /**
     * @notice Transfer ownership of a credit to a new Ethereum address.
     * @dev Only the current owner can call this. Credit must not be retired.
     *
     * @param _creditId  The credit to transfer
     * @param _to        New owner's address
     */
    function transferCredit(
        string memory _creditId,
        address       _to
    )
        external
        creditExists(_creditId)
        onlyOwner(_creditId)
        notRetired(_creditId)
    {
        require(_to != address(0), "CarbonCredit: cannot transfer to zero address");
        require(_to != msg.sender, "CarbonCredit: cannot transfer to yourself");

        address previous = _credits[_creditId].owner;
        _credits[_creditId].owner = _to;

        emit CreditTransferred(_creditId, previous, _to);
    }

    /**
     * @notice Permanently retire a credit (burn it as a carbon offset).
     * @dev Only the current owner can retire. Retired credits cannot be
     *      transferred — this is enforced by the notRetired modifier on
     *      transferCredit.
     *
     * @param _creditId  The credit to retire
     */
    function retireCredit(
        string memory _creditId
    )
        external
        creditExists(_creditId)
        onlyOwner(_creditId)
        notRetired(_creditId)
    {
        _credits[_creditId].isRetired = true;

        emit CreditRetired(_creditId, msg.sender);
    }

    // -----------------------------------------------------------------------
    // Read functions
    // -----------------------------------------------------------------------

    /**
     * @notice Fetch all stored fields for a given credit.
     * @return tonnes       CO₂ tonnes
     * @return developerId  Developer identifier
     * @return regulatorId  Regulator identifier
     * @return aiRiskScore  Fraud score × 10_000
     * @return owner        Current owner address
     * @return isRetired    Whether the credit has been retired
     */
    function getCredit(string memory _creditId)
        external
        view
        creditExists(_creditId)
        returns (
            uint256 tonnes,
            string  memory developerId,
            string  memory regulatorId,
            uint256 aiRiskScore,
            address owner,
            bool    isRetired
        )
    {
        Credit storage c = _credits[_creditId];
        return (
            c.tonnes,
            c.developerId,
            c.regulatorId,
            c.aiRiskScore,
            c.owner,
            c.isRetired
        );
    }

    /**
     * @notice Check whether a creditId has been issued.
     */
    function doesCreditExist(string memory _creditId) external view returns (bool) {
        return _exists[_creditId];
    }
}
