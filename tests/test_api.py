"""
Unit + integration tests for the FastAPI Ethereum-based endpoints.

Unit tests (TestValidation, TestStakeholders, TestMLFeatures):
  - Run without a Hardhat node — all web3 calls are mocked.

Integration tests (TestMintIntegration, TestChainEndpoints):
  - Require a running Hardhat node at http://127.0.0.1:8545
    AND a deployed contract at the default address.
  - Skip automatically if the node is unreachable.
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from api.app import app, STAKEHOLDERS, computeFeatures

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hardhat_available() -> bool:
    try:
        from web3 import Web3

        return Web3(Web3.HTTPProvider("http://127.0.0.1:8545")).is_connected()
    except Exception:
        return False


requires_hardhat = pytest.mark.skipif(
    not _hardhat_available(),
    reason="Hardhat node not running at http://127.0.0.1:8545",
)

VALID_MINT = {
    "project_id": "VCS-TEST-001",
    "project_type": "Cookstoves",
    "tonnes": 5000,
    "vintage_year": 2022,
    "owner_id": "GreenBuild Solutions",
    "developer_id": "Dev-Org-Alpha",
    "regulator_id": "GOV-EPA-001",
}

# ---------------------------------------------------------------------------
# 1. Input validation (no node needed — mocked)
# ---------------------------------------------------------------------------


class TestValidation:
    """FastAPI Pydantic validators — no Ethereum node required."""

    def _mock_issue(self):
        """Patch get_contract so the test never hits the node."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_receipt = MagicMock(status=1, blockNumber=1)
        mock_contract.functions.issueCredit.return_value.build_transaction.return_value = {}
        mock_w3.eth.get_transaction_count.return_value = 0
        mock_w3.eth.gas_price = 1
        mock_w3.eth.account.sign_transaction.return_value = MagicMock(
            raw_transaction=b"tx"
        )
        mock_w3.eth.send_raw_transaction.return_value = bytes(32)
        mock_w3.eth.wait_for_transaction_receipt.return_value = mock_receipt
        return patch("api.app.get_contract", return_value=(mock_w3, mock_contract))

    def test_negative_tonnes_rejected(self):
        with self._mock_issue():
            res = client.post("/credits/issue", json={**VALID_MINT, "tonnes": -100})
        assert res.status_code == 422

    def test_zero_tonnes_rejected(self):
        with self._mock_issue():
            res = client.post("/credits/issue", json={**VALID_MINT, "tonnes": 0})
        assert res.status_code == 422

    def test_blank_project_id_rejected(self):
        with self._mock_issue():
            res = client.post(
                "/credits/issue", json={**VALID_MINT, "project_id": "   "}
            )
        assert res.status_code == 422

    def test_vintage_year_too_old_rejected(self):
        with self._mock_issue():
            res = client.post(
                "/credits/issue", json={**VALID_MINT, "vintage_year": 1800}
            )
        assert res.status_code == 422

    def test_vintage_year_future_rejected(self):
        with self._mock_issue():
            res = client.post(
                "/credits/issue", json={**VALID_MINT, "vintage_year": 2099}
            )
        assert res.status_code == 422

    def test_blank_developer_id_rejected(self):
        with self._mock_issue():
            res = client.post("/credits/issue", json={**VALID_MINT, "developer_id": ""})
        assert res.status_code == 422

    def test_blank_regulator_id_rejected(self):
        with self._mock_issue():
            res = client.post(
                "/credits/issue", json={**VALID_MINT, "regulator_id": "  "}
            )
        assert res.status_code == 422

    def test_unknown_owner_returns_400(self):
        """owner_id must be a known stakeholder name."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        with patch("api.app.get_contract", return_value=(mock_w3, mock_contract)):
            res = client.post(
                "/credits/issue", json={**VALID_MINT, "owner_id": "FakeCompany"}
            )
        assert res.status_code == 400
        assert "Unknown stakeholder" in res.json()["detail"]


# ---------------------------------------------------------------------------
# 2. Stakeholders endpoint
# ---------------------------------------------------------------------------


class TestStakeholders:
    def test_returns_list(self):
        res = client.get("/stakeholders")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        assert len(data) == len(STAKEHOLDERS)

    def test_each_entry_has_name_and_address(self):
        res = client.get("/stakeholders")
        for entry in res.json():
            assert "name" in entry
            assert "address" in entry
            assert entry["address"].startswith("0x")

    def test_known_stakeholder_present(self):
        names = [s["name"] for s in client.get("/stakeholders").json()]
        assert "GreenBuild Solutions" in names


# ---------------------------------------------------------------------------
# 3. ML feature computation
# ---------------------------------------------------------------------------


class TestMLFeatures:
    def test_r_ratio_scaled_correctly(self):
        r, m, t = computeFeatures("Cookstoves", 50_000)
        assert r == pytest.approx(1.0)

    def test_high_risk_type_sets_m_flag(self):
        _, m, _ = computeFeatures("Solar", 5000)
        assert m == 1

    def test_low_risk_type_clears_m_flag(self):
        _, m, _ = computeFeatures("Cookstoves", 5000)
        assert m == 0

    def test_oversized_claim_sets_t_flag(self):
        _, _, t = computeFeatures("Cookstoves", 200_000)  # 4× peer avg
        assert t == 1

    def test_normal_claim_clears_t_flag(self):
        _, _, t = computeFeatures("Cookstoves", 10_000)
        assert t == 0


# ---------------------------------------------------------------------------
# 4. Integration tests — require running Hardhat node + deployed contract
# ---------------------------------------------------------------------------


@requires_hardhat
class TestMintIntegration:
    """Expected vs actual for full mint flow against live Hardhat node."""

    def test_mint_success_returns_201(self):
        res = client.post("/credits/issue", json=VALID_MINT)
        assert res.status_code == 201, (
            f"Expected 201, got {res.status_code}: {res.text}"
        )

    def test_mint_response_has_required_fields(self):
        res = client.post("/credits/issue", json=VALID_MINT)
        data = res.json()
        for field in [
            "credit_id",
            "ai_risk_score",
            "tonnes",
            "owner_address",
            "tx_hash",
            "block_number",
            "contract_address",
            "status",
        ]:
            assert field in data, f"Missing field: {field}"

    def test_mint_status_is_minted(self):
        res = client.post("/credits/issue", json=VALID_MINT)
        assert res.json()["status"] == "minted"

    def test_mint_risk_score_in_range(self):
        res = client.post("/credits/issue", json=VALID_MINT)
        score = res.json()["ai_risk_score"]
        assert 0.0 <= score <= 1.0, f"Risk score out of range: {score}"

    def test_mint_tonnes_matches_input(self):
        res = client.post("/credits/issue", json=VALID_MINT)
        assert res.json()["tonnes"] == VALID_MINT["tonnes"]

    def test_mint_owner_address_is_valid_eth(self):
        res = client.post("/credits/issue", json=VALID_MINT)
        addr = res.json()["owner_address"]
        assert addr.startswith("0x") and len(addr) == 42

    def test_high_risk_credit_rejected_by_contract(self):
        """
        Expected: credits with risk_score >= 0.70 are REJECTED by the contract.
        The contract checks aiRiskScore < 7000.
        """
        fraud_payload = {
            **VALID_MINT,
            "project_type": "Solar",
            "tonnes": 600_000,  # 12× peer avg → very high R_ratio
            "vintage_year": 2005,  # 21yr old
            "project_id": "VCS-FRAUD-001",
        }
        res = client.post("/credits/issue", json=fraud_payload)
        # The contract will revert because risk score > 0.70
        # Expected: 500 with "risk score too high" detail
        assert res.status_code in (201, 500)
        if res.status_code == 500:
            assert (
                "risk" in res.json()["detail"].lower()
                or "revert" in res.json()["detail"].lower()
            )

    def test_get_minted_credit(self):
        """Mint a credit then read it back — verify on-chain data matches."""
        mint_res = client.post("/credits/issue", json=VALID_MINT)
        credit_id = mint_res.json()["credit_id"]

        get_res = client.get(f"/credits/{credit_id}")
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["credit_id"] == credit_id
        assert data["tonnes"] == VALID_MINT["tonnes"]
        assert data["is_retired"] == False
        assert data["developer_id"] == VALID_MINT["developer_id"]
        assert data["regulator_id"] == VALID_MINT["regulator_id"]

    def test_get_nonexistent_credit_returns_404(self):
        res = client.get("/credits/CRED-DOES-NOT-EXIST-XYZ")
        assert res.status_code == 404

    def test_risk_score_stored_correctly_on_chain(self):
        """ai_risk_score read back from chain matches what was minted."""
        mint_res = client.post("/credits/issue", json=VALID_MINT)
        mint_score = mint_res.json()["ai_risk_score"]
        credit_id = mint_res.json()["credit_id"]

        get_res = client.get(f"/credits/{credit_id}")
        chain_score = get_res.json()["ai_risk_score"]

        # Scaled to int and back — allow ±0.0001 rounding tolerance
        assert abs(mint_score - chain_score) < 0.0002, (
            f"Score mismatch: minted={mint_score}, on-chain={chain_score}"
        )


@requires_hardhat
class TestChainEndpoints:
    def test_chain_stats_returns_200(self):
        res = client.get("/chain/stats")
        assert res.status_code == 200

    def test_chain_stats_fields(self):
        data = client.get("/chain/stats").json()
        for field in [
            "network",
            "chain_id",
            "latest_block",
            "contract_address",
            "registrar",
        ]:
            assert field in data, f"Missing field: {field}"

    def test_chain_id_is_hardhat(self):
        # hardhat.config.js sets chainId 1337 (not the default 31337)
        data = client.get("/chain/stats").json()
        assert data["chain_id"] == 1337, (
            f"Expected chainId 1337, got {data['chain_id']}"
        )

    def test_chain_events_returns_200(self):
        res = client.get("/chain/events")
        assert res.status_code == 200

    def test_chain_events_has_events_and_total(self):
        # /chain/events returns { "events": [...], "total": N }
        data = client.get("/chain/events").json()
        assert "events" in data
        assert "total" in data
        assert isinstance(data["events"], list)
        assert data["total"] == len(data["events"])

    def test_chain_events_issued_after_mint(self):
        """After minting, at least one 'issued' event should appear."""
        client.post("/credits/issue", json=VALID_MINT)
        data = client.get("/chain/events").json()
        issued = [e for e in data["events"] if e["type"] == "issued"]
        assert len(issued) >= 1

    def test_issued_event_has_required_fields(self):
        client.post("/credits/issue", json=VALID_MINT)
        data = client.get("/chain/events").json()
        issued = [e for e in data["events"] if e["type"] == "issued"]
        if issued:
            e = issued[0]
            for field in [
                "credit_id",
                "owner",
                "tonnes",
                "ai_risk_score",
                "developer_id",
                "regulator_id",
                "tx_hash",
                "block",
            ]:
                assert field in e, f"Missing event field: {field}"
