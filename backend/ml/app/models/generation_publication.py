"""Exact local publication snapshots; ordinary exceptions are recoverable."""

import os
import shutil
from contextlib import contextmanager

from . import base


class PublicationRecoveryError(RuntimeError):
    """Recovery failed; preserved snapshots require operator reconciliation."""


class PublicationSnapshot:
    def __init__(self, model_name):
        self.model_name = model_name
        self.files = []
        self.was_deleted = model_name in base._deleted_reader_models

    def prepare(self):
        flat = base.get_model_path(self.model_name)
        paths = (
            base._active_ptr_path(self.model_name),
            base._previous_ptr_path(self.model_name),
            flat,
            base.get_meta_path(self.model_name),
            base._artifact_signature_path(flat),
        )
        for path in paths:
            backup = base._unique_temp(path) if os.path.exists(path) else None
            self.files.append((path, backup))
            if backup:
                # Disk-backed snapshots do not retain large pickles in RAM.
                shutil.copyfile(path, backup)
                with open(backup, "rb") as source:
                    os.fsync(source.fileno())

    def recover(self):
        try:
            for path, backup in self.files:
                if backup is None:
                    try:
                        os.remove(path)
                    except FileNotFoundError:
                        pass
                else:
                    temporary = base._unique_temp(path)
                    try:
                        shutil.copyfile(backup, temporary)
                        with open(temporary, "rb") as source:
                            os.fsync(source.fileno())
                        os.replace(temporary, path)
                    finally:
                        try:
                            os.remove(temporary)
                        except OSError:
                            pass
            if self.was_deleted:
                base._deleted_reader_models.add(self.model_name)
            else:
                base._deleted_reader_models.discard(self.model_name)
        except OSError as exc:
            # Keep backups for manual reconciliation; do not erase evidence.
            raise PublicationRecoveryError("Native publication recovery failed") from exc

    def cleanup(self):
        for _, backup in self.files:
            if backup:
                try:
                    os.remove(backup)
                except OSError:
                    pass


@contextmanager
def recoverable_publication(model_name):
    """Caller retains the existing model writer through preparation/recovery."""
    snapshot = PublicationSnapshot(model_name)
    try:
        snapshot.prepare()
    except BaseException:
        snapshot.cleanup()
        raise
    try:
        yield
    except BaseException:
        snapshot.recover()
        snapshot.cleanup()
        raise
    else:
        snapshot.cleanup()
