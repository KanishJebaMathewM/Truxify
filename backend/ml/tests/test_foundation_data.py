"""Unit tests for backend/ml/foundation/data.py.

Run with: python3 -m pytest tests/test_foundation_data.py -v --no-header
"""
import numpy as np
from foundation.data import LogisticsDataProcessor, LogisticsDatasetGenerator


class TestLogisticsDataProcessor:
    """Tests for the logistics data processor."""

    def setup_method(self):
        self.processor = LogisticsDataProcessor()

    def test_prepare_sequence_builds_vocab(self):
        """Tokens must be assigned stable incremental vocab ids."""
        ids = self.processor.prepare_sequence("Delhi Mumbai cargo")
        assert ids == [0, 1, 2]
        assert self.processor.get_vocab_size() == 3

    def test_prepare_sequence_is_lowercased(self):
        """Tokenization must lowercase the input."""
        ids = self.processor.prepare_sequence("DELHI delhi")
        assert ids[0] == ids[1]

    def test_prepare_sequence_reuses_existing_vocab(self):
        """Repeated tokens must map to the same id."""
        self.processor.prepare_sequence("a b")
        ids = self.processor.prepare_sequence("b a")
        assert ids == [1, 0]

    def test_create_pretraining_data_shape(self):
        """Each item must yield tokens/labels/metadata."""
        data = [{"origin": "Delhi", "destination": "Mumbai", "cargo_type": "bulk", "route": "highway"}]
        result = self.processor.create_pretraining_data(data)
        assert len(result) == 1
        assert set(result[0].keys()) == {"tokens", "labels", "metadata"}
        assert len(result[0]["tokens"]) == len(result[0]["labels"])

    def test_create_finetuning_data_classification(self):
        """Classification task must produce 0/1 labels from is_urgent."""
        data = [
            {"origin": "Delhi", "destination": "Mumbai", "cargo_type": "bulk", "is_urgent": True},
            {"origin": "Mumbai", "destination": "Delhi", "cargo_type": "bulk", "is_urgent": False},
        ]
        result = self.processor.create_finetuning_data(data, task="classification")
        assert [r["label"] for r in result] == [1, 0]

    def test_create_finetuning_data_regression(self):
        """Regression task must normalize price by /1000."""
        data = [{"origin": "Delhi", "destination": "Mumbai", "cargo_type": "bulk", "price": 5000}]
        result = self.processor.create_finetuning_data(data, task="regression")
        assert result[0]["label"] == 5.0

    def test_unknown_task_defaults_to_zero_label(self):
        """An unrecognized task must fall back to label 0."""
        data = [{"origin": "Delhi", "destination": "Mumbai", "cargo_type": "bulk"}]
        result = self.processor.create_finetuning_data(data, task="unknown")
        assert result[0]["label"] == 0


class TestLogisticsDatasetGenerator:
    """Tests for the synthetic dataset generator."""

    def test_generate_samples_shape(self):
        """The generator must produce the requested number of samples."""
        samples = LogisticsDatasetGenerator.generate_samples(num_samples=20)
        assert len(samples) == 20

    def test_sample_has_expected_keys(self):
        """Each sample must expose the documented fields."""
        samples = LogisticsDatasetGenerator.generate_samples(num_samples=1)
        sample = samples[0]
        expected = {
            "id", "origin", "destination", "distance", "cargo_type",
            "cargo_weight", "route_type", "weather", "traffic_level",
            "time_of_day", "day_of_week", "price", "is_urgent", "timestamp",
        }
        assert expected.issubset(set(sample.keys()))

    def test_origin_and_destination_differ(self):
        """A sample's destination must differ from its origin."""
        samples = LogisticsDatasetGenerator.generate_samples(num_samples=50)
        for sample in samples:
            assert sample["destination"] != sample["origin"]

    def test_sample_values_are_in_range(self):
        """Distance/price must fall within the documented ranges."""
        samples = LogisticsDatasetGenerator.generate_samples(num_samples=50)
        for sample in samples:
            assert 50 <= sample["distance"] <= 2000
            assert 500 <= sample["price"] <= 50000
