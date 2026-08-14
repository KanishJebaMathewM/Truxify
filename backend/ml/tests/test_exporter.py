"""Unit tests for backend/ml/nas/exporter.py.

Run with: python3 -m pytest tests/test_exporter.py -v --no-header
"""
import json
import os
import tempfile

from nas.exporter import ModelExporter


class TestExportQuantizedManifest:
    """Tests for the INT8 quantized manifest export."""

    def setup_method(self):
        self.exporter = ModelExporter()

    def test_returns_manifest_with_expected_keys(self):
        """The manifest must expose the documented fields."""
        manifest = self.exporter.export_quantized_manifest([0.5, -0.5])
        assert set(manifest.keys()) == {
            "format",
            "quant_scale",
            "weights",
            "pruned_channels",
            "accuracy_drop_pct",
        }
        assert manifest["format"] == "INT8_QUANTIZED_ONNX"
        assert manifest["quant_scale"] == 127

    def test_weights_are_scaled_to_int8(self):
        """Weights must be quantized as int(w * 127)."""
        manifest = self.exporter.export_quantized_manifest([0.5, -0.5, 1.0])
        assert manifest["weights"] == [63, -63, 127]

    def test_writes_manifest_to_file(self):
        """The manifest must be written as JSON to the output filename."""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "model.json")
            self.exporter.export_quantized_manifest([0.25, 0.75], output_filename=path)
            with open(path, "r") as f:
                loaded = json.load(f)
            assert loaded["weights"] == [31, 95]

    def test_empty_weights_produce_empty_list(self):
        """An empty weight list must yield an empty quantized list."""
        manifest = self.exporter.export_quantized_manifest([])
        assert manifest["weights"] == []
