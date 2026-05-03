from ml.model import scoreProject


class TestScoreProject:
    def test_returns_float_in_range(self):
        score = scoreProject({
            "R_ratio": 1.0, "Vintage_Age": 5, "M_flag": 0, "T_flag": 0,
        })
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0

    def test_suspicious_project_scores_higher(self):
        normal = scoreProject({
            "R_ratio": 1.0, "Vintage_Age": 3, "M_flag": 0, "T_flag": 0,
        })
        suspicious = scoreProject({
            "R_ratio": 15.0, "Vintage_Age": 20, "M_flag": 1, "T_flag": 1,
        })
        assert suspicious > normal

    def test_edge_case_zero_values(self):
        score = scoreProject({
            "R_ratio": 0.0, "Vintage_Age": 0, "M_flag": 0, "T_flag": 0,
        })
        assert 0.0 <= score <= 1.0
