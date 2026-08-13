#!/usr/bin/env python3
"""
Regression test for scripts/check-definer-search-path.py

Reproduces issue #11555: a SECURITY DEFINER function whose `SET search_path`
clause sits more than 4000 characters after the `CREATE ... FUNCTION` header
start must still be classified as pinned. The buggy implementation truncated
the scanned window to 4000 chars and reported such functions as unpinned.
"""
import importlib.util
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "check-definer-search-path.py"
)
_spec = importlib.util.spec_from_file_location("check_definer_search_path", _SCRIPT_PATH)
checker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(checker)


def _long_function(name: str, padding_chars: int, pinned: bool = True) -> str:
    args = ", ".join(f"a{i} int" for i in range(padding_chars // 8 + 1))
    header_pad = "-- " + ("x" * max(0, padding_chars)) + "\n"
    set_clause = "SET search_path = public, pg_temp\n" if pinned else ""
    return f"""
{header_pad}
CREATE OR REPLACE FUNCTION {name}({args})
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
{set_clause}AS $$
BEGIN
  RETURN 1;
END;
$$;
"""


def test_long_pinned_function_is_classified_as_pinned() -> None:
    sql = _long_function("long_pinned_fn", 5000, pinned=True)
    assert len(sql) > 4000
    set_idx = sql.lower().index("set search_path")
    assert set_idx > 4000, "fixture must place SET search_path beyond the old 4000-char window"

    latest, altered = checker.audit_sql([("migration.sql", sql)])
    entry = latest["long_pinned_fn"]
    src, is_definer, has_path = entry

    assert is_definer is True
    assert has_path is True, "long function with SET search_path must be detected as pinned"

    unpinned = [
        (n, s)
        for n, (s, d, p) in latest.items()
        if d and not p and n not in altered
    ]
    assert unpinned == [], f"expected no unpinned definers, got {unpinned}"


def test_long_unpinned_function_is_flagged() -> None:
    sql = _long_function("long_unpinned_fn", 5000, pinned=False)
    assert len(sql) > 4000

    latest, altered = checker.audit_sql([("migration.sql", sql)])
    entry = latest["long_unpinned_fn"]
    src, is_definer, has_path = entry

    assert is_definer is True
    assert has_path is False, "long function without SET search_path must be flagged as unpinned"

    unpinned = [
        (n, s)
        for n, (s, d, p) in latest.items()
        if d and not p and n not in altered
    ]
    assert ("long_unpinned_fn", "migration.sql") in unpinned


def test_search_path_from_later_statement_is_not_a_false_positive() -> None:
    # A long function WITHOUT its own SET search_path, followed later in the
    # file by an unrelated ALTER FUNCTION ... SET search_path that does NOT name
    # this function. The terminator-based parser must not mistake that later
    # statement for this function's header.
    fn = _long_function("real_unpinned_fn", 5000, pinned=False)
    later = (
        "\n-- some other statement far below\n"
        "ALTER FUNCTION unrelated_fn(int) SET search_path = public, pg_temp;\n"
    )
    sql = fn + later

    latest, altered = checker.audit_sql([("migration.sql", sql)])
    entry = latest["real_unpinned_fn"]
    src, is_definer, has_path = entry

    assert is_definer is True
    assert has_path is False, "SET search_path from a later unrelated statement must not pin this function"
    assert "real_unpinned_fn" not in altered


if __name__ == "__main__":
    test_long_pinned_function_is_classified_as_pinned()
    test_long_unpinned_function_is_flagged()
    test_search_path_from_later_statement_is_not_a_false_positive()
    print("ok: long pinned/unpinned functions and terminator bounds verified")
