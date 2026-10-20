"""Exact native temporary-file ownership; callers hold the model mutation lock."""

import os


def owned_temporary(entry, basenames):
    """Match only an exact destination plus the generated UUID suffix."""
    for basename in basenames:
        prefix = basename + "."
        if not entry.startswith(prefix) or not entry.endswith(".tmp"):
            continue
        identifier = entry[len(prefix) : -4]
        if len(identifier) == 32 and all(
            char in "0123456789abcdef" for char in identifier
        ):
            return True
    return False


def remove_owned_temporaries(directory, basenames):
    """Remove abandoned owned files only, preserving unrelated names/directories."""
    try:
        entries = os.listdir(directory)
    except FileNotFoundError:
        return
    for entry in entries:
        if owned_temporary(entry, basenames):
            try:
                os.remove(os.path.join(directory, entry))
            except OSError:
                # Another process/removable stale path is outside local ownership.
                continue
