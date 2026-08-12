#!/usr/bin/env python3
"""
Fail if any SECURITY DEFINER function in supabase/migrations/ is left without a
pinned search_path.

A SECURITY DEFINER function runs with its owner's privileges but resolves
unqualified names against the *caller's* search_path, so a caller who can create
objects in a schema earlier on that path can shadow a table the body references
and have it executed as the owner.

Migrations are replayed in filename order, so a function is judged by its LAST
definition; a later `ALTER FUNCTION ... SET search_path` also counts as pinned.
"""
import glob
import os
import re
import sys

FUNC_RE = re.compile(r"create\s+or\s+replace\s+function\s+(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s*\(", re.I)
ALTER_RE = re.compile(
    r"alter\s+function\s+(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s*\([^)]*\)\s*set\s+search_path", re.I
)
BODY_RE = re.compile(r"\bas\s*\$", re.I)


def main() -> int:
    latest: dict[str, tuple[str, bool, bool]] = {}
    altered: set[str] = set()

    for path in sorted(glob.glob("supabase/migrations/*.sql")):
        sql = open(path, encoding="utf-8", errors="replace").read()

        for match in FUNC_RE.finditer(sql):
            # The header is everything before the `AS $$` body marker.
            header = BODY_RE.split(sql[match.start() : match.start() + 4000])[0]
            latest[match.group(1)] = (
                os.path.basename(path),
                bool(re.search(r"security\s+definer", header, re.I)),
                bool(re.search(r"set\s+search_path", header, re.I)),
            )

        altered.update(m.group(1) for m in ALTER_RE.finditer(sql))

    unpinned = sorted(
        (name, src)
        for name, (src, is_definer, has_path) in latest.items()
        if is_definer and not has_path and name not in altered
    )

    if unpinned:
        print("SECURITY DEFINER functions without a pinned search_path:\n")
        for name, src in unpinned:
            print(f"  {name}  (last defined in {src})")
        print(
            "\nAdd `SET search_path = public, pg_temp` to the definition, or "
            "`ALTER FUNCTION <name>(<args>) SET search_path = public, pg_temp` "
            "in a new migration."
        )
        return 1

    definers = sum(1 for _, is_definer, _ in latest.values() if is_definer)
    print(f"All {definers} SECURITY DEFINER functions pin search_path.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
