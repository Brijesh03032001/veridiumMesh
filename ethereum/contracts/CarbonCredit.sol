// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CarbonCredit {

    address public registrar;

    struct Credit {
        uint256 tonnes;
        string  developerId;
        string  regulatorId;
        uint256 aiRiskScore;
        address owner;
        bool    isRetired;
    }

    mapping(string => Credit) private _credits;
    mapping(string => bool)   private _exists;

    event CreditIssued(
        string  creditId,
        address indexed owner,
        uint256 tonnes,
        uint256 aiRiskScore,
        string  developerId,
        string  regulatorId
    );

    event CreditTransferred(
        string  creditId,
        address indexed from,
        address indexed to
    );

    event CreditRetired(
        string  creditId,
        address indexed owner
    );

    constructor() {
        registrar = msg.sender;
    }

    modifier onlyRegistrar() {
        require(msg.sender == registrar, "CarbonCredit: caller is not the registrar");
        _;
    }

    modifier creditExists(string memory _creditId) {
        require(_exists[_creditId], "CarbonCredit: credit does not exist");
        _;
    }

    modifier onlyOwner(string memory _creditId) {
        require(_credits[_creditId].owner == msg.sender, "CarbonCredit: caller is not the credit owner");
        _;
    }

    modifier notRetired(string memory _creditId) {
        require(!_credits[_creditId].isRetired, "CarbonCredit: credit is already retired");
        _;
    }

    function issueCredit(
        string memory _creditId,
        uint256       _tonnes,
        string memory _developerId,
        string memory _regulatorId,
        uint256       _aiRiskScore,
        address       _owner
    ) external onlyRegistrar {
        require(!_exists[_creditId],                "CarbonCredit: creditId already exists");
        require(_tonnes > 0,                        "CarbonCredit: tonnes must be positive");
        require(bytes(_developerId).length > 0,     "CarbonCredit: developerId required");
        require(bytes(_regulatorId).length > 0,     "CarbonCredit: regulatorId required");
        require(_aiRiskScore <= 10000,              "CarbonCredit: aiRiskScore out of range");
        require(_aiRiskScore < 7000,                "CarbonCredit: risk score too high, credit rejected");
        require(_owner != address(0),               "CarbonCredit: owner cannot be zero address");

        _credits[_creditId] = Credit({
            tonnes:      _tonnes,
            developerId: _developerId,
            regulatorId: _regulatorId,
            aiRiskScore: _aiRiskScore,
            owner:       _owner,
            isRetired:   false
        });
        _exists[_creditId] = true;

        emit CreditIssued(_creditId, _owner, _tonnes, _aiRiskScore, _developerId, _regulatorId);
    }

    function transferCredit(
        string memory _creditId,
        address       _to
    ) external creditExists(_creditId) onlyOwner(_creditId) notRetired(_creditId) {
        require(_to != address(0), "CarbonCredit: cannot transfer to zero address");
        require(_to != msg.sender, "CarbonCredit: cannot transfer to yourself");

        address previous = _credits[_creditId].owner;
        _credits[_creditId].owner = _to;

        emit CreditTransferred(_creditId, previous, _to);
    }

    function retireCredit(
        string memory _creditId
    ) external creditExists(_creditId) onlyOwner(_creditId) notRetired(_creditId) {
        _credits[_creditId].isRetired = true;
        emit CreditRetired(_creditId, msg.sender);
    }

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
        return (c.tonnes, c.developerId, c.regulatorId, c.aiRiskScore, c.owner, c.isRetired);
    }

    function doesCreditExist(string memory _creditId) external view returns (bool) {
        return _exists[_creditId];
    }
}
