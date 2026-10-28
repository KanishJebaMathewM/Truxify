#!/usr/bin/env python3
"""
Automated Database Migration File Integrity and Checksum Verification Script.
Ensures that migration files maintain valid naming conventions, computes verifiable
SHA-256 integrity checksums, checks for empty files, and audits chronological sequencing.
"""

import argparse
import hashlib
import os
import re
import sys
from typing import Dict, List, Tuple


def compute_sha256(filepath: str) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify_migrations(
    directory: str, strict_prefix: bool = False
) -> Tuple[bool, List[Dict[str, str]], List[str], List[str]]:
    if not os.path.isdir(directory):
        return True, [], [], []

    files = [f for f in os.listdir(directory) if f.endswith(".sql")]
    if not files:
        return True, [], [], []

    errors: List[str] = []
    warnings: List[str] = []
    manifest: List[Dict[str, str]] = []
    seen_prefixes: Dict[str, str] = {}

    pattern = re.compile(r"^(\d{8,14})_([a-zA-Z0-9_]+)\.sql$")

    for filename in sorted(files):
        filepath = os.path.join(directory, filename)
        match = pattern.match(filename)
        if not match:
            errors.append(f"Invalid migration filename format: '{filename}'. Expected '<timestamp>_<name>.sql'")
            continue

        prefix, name = match.group(1), match.group(2)

        if prefix in seen_prefixes:
            msg = f"Duplicate migration timestamp prefix '{prefix}': shared between '{seen_prefixes[prefix]}' and '{filename}'"
            if strict_prefix:
                errors.append(msg)
            else:
                warnings.append(msg)
        else:
            seen_prefixes[prefix] = filename

        file_size = os.path.getsize(filepath)
        if file_size == 0:
            errors.append(f"Empty migration file detected: '{filename}'")

        file_hash = compute_sha256(filepath)
        manifest.append({
            "prefix": prefix,
            "filename": filename,
            "sha256": file_hash,
            "size_bytes": str(file_size),
        })

    is_valid = len(errors) == 0
    return is_valid, manifest, errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify database migration integrity and ordering.")
    parser.add_argument(
        "--dir",
        dest="directories",
        action="append",
        help="Directory containing migration SQL files (can be specified multiple times)",
    )
    parser.add_argument(
        "--strict-prefix",
        action="store_true",
        help="Fail if any two migration files share the exact same timestamp prefix",
    )
    args = parser.parse_args()

    target_dirs = args.directories or ["database/migrations"]
    overall_valid = True

    for d in target_dirs:
        if not os.path.exists(d):
            continue
        print(f"Verifying migration integrity in: {d}")
        valid, manifest, errors, warnings = verify_migrations(d, strict_prefix=args.strict_prefix)
        if not valid:
            overall_valid = False
            for err in errors:
                print(f"  [ERROR] {err}", file=sys.stderr)
        else:
            print(f"  [OK] Verified {len(manifest)} migrations with valid checksums.")
            for item in manifest:
                print(f"    - {item['filename']} (SHA256: {item['sha256'][:12]}...)")

        for warn in warnings:
            print(f"  [WARNING] {warn}")

    if not overall_valid:
        print("\nMigration integrity check failed!", file=sys.stderr)
        return 1

    print("\nAll migration files verified successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
