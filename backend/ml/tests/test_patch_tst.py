"""Unit tests for backend/ml/transformers/patch_tst.py.

Run with: python3 -m pytest tests/test_patch_tst.py -v --no-header
"""
import numpy as np
from transformers.patch_tst import PatchTSTPriceForecaster


class TestCreatePatches:
    """Tests for the sub-series patch tokenization."""

    def setup_method(self):
        self.model = PatchTSTPriceForecaster(patch_len=4, stride=2)

    def test_patch_count(self):
        """Patches are taken every stride steps over the series."""
        series = np.arange(10, dtype=float)
        patches = self.model.create_patches(series)
        # i = 0, 2, 4, 6 → 4 patches
        assert patches.shape == (4, 4)

    def test_patches_are_overlapping_sub_series(self):
        """Consecutive patches must shift by the stride."""
        series = np.arange(10, dtype=float)
        patches = self.model.create_patches(series)
        assert np.array_equal(patches[1], patches[0] + 2)

    def test_short_series_yields_single_patch(self):
        """A series shorter than patch_len + stride yields one patch."""
        series = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        patches = self.model.create_patches(series)
        assert patches.shape == (1, 4)


class TestForecastNextDays:
    """Tests for the multi-day price forecast."""

    def setup_method(self):
        self.model = PatchTSTPriceForecaster(patch_len=4, stride=2)

    def test_returns_expected_keys(self):
        """The forecast must expose the documented fields."""
        series = np.arange(1, 21, dtype=float)
        result = self.model.forecast_next_days(series, forecast_horizon_days=7)
        assert set(result.keys()) == {
            "forecast_horizon_days",
            "forecasted_prices",
            "mean_expected_price",
        }

    def test_forecast_length_matches_horizon(self):
        """The forecasted_prices list must have one entry per horizon day."""
        series = np.arange(1, 21, dtype=float)
        result = self.model.forecast_next_days(series, forecast_horizon_days=5)
        assert len(result["forecasted_prices"]) == 5
        assert result["forecast_horizon_days"] == 5

    def test_forecast_trend_is_linear(self):
        """Forecast prices must increase by 0.15 per day."""
        series = np.arange(1, 21, dtype=float)
        result = self.model.forecast_next_days(series, forecast_horizon_days=5)
        prices = result["forecasted_prices"]
        assert np.allclose(np.diff(prices), 0.15)

    def test_mean_price_matches_forecast_average(self):
        """mean_expected_price must equal the mean of the forecasted prices."""
        series = np.arange(1, 21, dtype=float)
        result = self.model.forecast_next_days(series, forecast_horizon_days=7)
        expected = round(float(np.mean(result["forecasted_prices"])), 2)
        assert result["mean_expected_price"] == expected
