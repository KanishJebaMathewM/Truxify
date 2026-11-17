import os
import tempfile
import unittest

from scripts.verify_migration_checksums import compute_sha256, verify_migrations


class TestVerifyMigrationChecksums(unittest.TestCase):
    def test_compute_sha256(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"CREATE TABLE test (id INT);")
            temp_path = f.name
        try:
            h = compute_sha256(temp_path)
            self.assertEqual(len(h), 64)
        finally:
            os.remove(temp_path)

    def test_verify_migrations_valid(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file1 = os.path.join(tmpdir, "20260101_init.sql")
            file2 = os.path.join(tmpdir, "20260102_users.sql")
            with open(file1, "w") as f:
                f.write("SELECT 1;")
            with open(file2, "w") as f:
                f.write("SELECT 2;")

            valid, manifest, errors, warnings = verify_migrations(tmpdir)
            self.assertTrue(valid)
            self.assertEqual(len(manifest), 2)
            self.assertEqual(len(errors), 0)

    def test_verify_migrations_invalid_filename(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_file = os.path.join(tmpdir, "bad_migration.sql")
            with open(bad_file, "w") as f:
                f.write("SELECT 1;")

            valid, manifest, errors, warnings = verify_migrations(tmpdir)
            self.assertFalse(valid)
            self.assertIn("Invalid migration filename format", errors[0])

    def test_verify_migrations_empty_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            empty_file = os.path.join(tmpdir, "20260101_empty.sql")
            with open(empty_file, "w") as f:
                pass

            valid, manifest, errors, warnings = verify_migrations(tmpdir)
            self.assertFalse(valid)
            self.assertIn("Empty migration file detected", errors[0])


if __name__ == "__main__":
    unittest.main()
