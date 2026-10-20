"""Regression tests for foundation model file and upload boundaries."""

import asyncio
import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "routes" / "foundation_validation.py"
spec = importlib.util.spec_from_file_location("foundation_validation", MODULE_PATH)
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


class FakeUpload:
    def __init__(self, content, filename="training.json", content_type="application/json"):
        self.content = content
        self.filename = filename
        self.content_type = content_type
        self.read_size = None

    async def read(self, size):
        self.read_size = size
        return self.content[:size]


class FoundationValidationTests(unittest.TestCase):
    def test_model_names_are_allowlisted(self):
        self.assertEqual(validation.safe_model_path("foundation_model.pth"),
                         "models/foundation_model.pth")
        self.assertEqual(validation.safe_model_path("models/foundation_model_v2.pth"),
                         "models/foundation_model_v2.pth")
        for path in ("../foundation_model.pth", "/tmp/foundation_model.pth",
                     "models/other.pth", "models/sub/foundation_model.pth",
                     "models\\foundation_model.pth", "foundation_model_v0.pth"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                validation.safe_model_path(path)

    def test_upload_is_bounded_before_json_parsing(self):
        upload = FakeUpload(b" " * (validation.MAX_UPLOAD_BYTES + 1))
        with self.assertRaises(validation.UploadTooLarge):
            asyncio.run(validation.read_training_json(upload))
        self.assertEqual(upload.read_size, validation.MAX_UPLOAD_BYTES + 1)

    def test_upload_rejects_invalid_type_and_shape(self):
        for upload in (FakeUpload(b"[]", filename="training.txt"),
                       FakeUpload(b"[]", content_type="application/octet-stream"),
                       FakeUpload(b"not json"), FakeUpload(b"{}"),
                       FakeUpload(b"[42]"),
                       FakeUpload(b'[{"origin":42}]')):
            with self.subTest(filename=upload.filename, content=upload.content[:20]):
                with self.assertRaises(ValueError):
                    asyncio.run(validation.read_training_json(upload))

    def test_upload_accepts_training_records(self):
        upload = FakeUpload(b'[{"origin":"Delhi","destination":"Mumbai"}]')
        self.assertEqual(asyncio.run(validation.read_training_json(upload)),
                         [{"origin": "Delhi", "destination": "Mumbai"}])


if __name__ == "__main__":
    unittest.main()
