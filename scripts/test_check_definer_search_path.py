#!/usr/bin/env python3
"""
Regression tests for scripts/check-definer-search-path.py.

Reproduces #11554: a SECURITY DEFINER function whose declaration header is
longer than 4000 characters must still be recognised as pinning its
search_path (the old code only inspected the first 4000 chars of the
definition).
"""
import os
import subprocess
import sys
import textwrap

import pytest

SCRIPT = os.path.join(os.path.dirname(__file__), "check-definer-search-path.py")


def _run(tmp_path, sql: str) -> int:
    migrations = tmp_path / "supabase" / "migrations"
    migrations.mkdir(parents=True)
    (migrations / "0001_long_func.sql").write_text(sql, encoding="utf-8")
    return subprocess.run(
        [sys.executable, SCRIPT],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    ).returncode


def _long_header(prefix: str) -> str:
    # Pad the declaration with comment lines so the header exceeds 4000 chars
    # and the `SET search_path` clause lands well past the old 4000-char window.
    padding = "\n".join(f"-- padding line {i:04d} for issue #11554" for i in range(120))
    return textwrap.dedent(
        f"""
        create or replace function public.very_long_function({prefix})
        returns void
        language plpgsql
        {padding}
        security definer
        set search_path = public, pg_temp
        as $$
        begin
            null;
        end;
        $$ language plpgsql;
        """
    )


def test_long_function_with_search_path_passes(tmp_path):
    sql = _long_header("arg1 int, arg2 int, arg3 int")
    assert _run(tmp_path, sql) == 0


def test_long_function_without_search_path_fails(tmp_path):
    # Same length, but no `SET search_path` -> correctly flagged.
    padding = "\n".join(f"-- padding line {i:04d} for issue #11554" for i in range(120))
    sql = textwrap.dedent(
        f"""
        create or replace function public.very_long_unpinned(arg1 int, arg2 int, arg3 int)
        returns void
        language plpgsql
        {padding}
        security definer
        as $$
        begin
            null;
        end;
        $$ language plpgsql;
        """
    )
    assert _run(tmp_path, sql) == 1


def test_short_function_with_search_path_passes(tmp_path):
    sql = textwrap.dedent(
        """
        create or replace function public.short_func()
        returns void
        language plpgsql
        security definer
        set search_path = public, pg_temp
        as $$
        begin
            null;
        end;
        $$ language plpgsql;
        """
    )
    assert _run(tmp_path, sql) == 0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
