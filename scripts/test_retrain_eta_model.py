import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Ensure repo root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Provide mocks for optional dependencies so tests pass deterministically across all environments
for mod in ["joblib", "pandas", "sklearn.ensemble", "psycopg2", "psycopg2.extras", "numpy"]:
    if mod not in sys.modules:
        try:
            __import__(mod)
        except ImportError:
            sys.modules[mod] = MagicMock()

import scripts.retrain_eta_model as retrain_module


class TestRetrainEtaModel(unittest.TestCase):
    def test_generate_mock_data_structure(self):
        mock_np = MagicMock()
        mock_np.random.randint.return_value = 10
        mock_np.random.uniform.return_value = 50.0
        mock_np.random.choice.return_value = 1
        with patch.dict(sys.modules, {"numpy": mock_np}):
            data = retrain_module._generate_mock_data()
            self.assertEqual(len(data), 1500)
            first_item = data[0]
            self.assertIn("distance_km", first_item)
            self.assertIn("route_eta_seconds", first_item)
            self.assertIn("avg_speed_kmh", first_item)
            self.assertIn("traffic_score", first_item)

    def test_fetch_trip_data_fallback_without_db(self):
        with patch.dict(os.environ, {"DATABASE_URL": ""}):
            with patch.object(retrain_module, "_generate_mock_data", return_value=[{"trip_id": 1}]):
                result = retrain_module.fetch_trip_data()
                self.assertEqual(result, [{"trip_id": 1}])

    def test_main_insufficient_rows_aborts(self):
        with patch.object(retrain_module, "fetch_trip_data", return_value=[{"trip_id": 1}]):
            status = retrain_module.main()
            self.assertEqual(status, 1)

    def test_main_success_flow(self):
        mock_rows = [{"trip_id": i} for i in range(1100)]
        with patch.object(retrain_module, "fetch_trip_data", return_value=mock_rows):
            with patch.object(retrain_module, "train", return_value=True) as mock_train:
                status = retrain_module.main()
                self.assertEqual(status, 0)
                mock_train.assert_called_once_with(mock_rows)


if __name__ == "__main__":
    unittest.main()
