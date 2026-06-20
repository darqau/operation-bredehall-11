from pathlib import Path

from app.data_sync import sync_bundled_data


def test_sync_skips_when_same_directory(tmp_path):
    (tmp_path / "bredehall.db").write_bytes(b"db")
    assert sync_bundled_data(bundled_dir=tmp_path, runtime_dir=tmp_path) == []


def test_sync_copies_when_runtime_missing(tmp_path):
    bundled = tmp_path / "bundle"
    runtime = tmp_path / "runtime"
    bundled.mkdir()
    (bundled / "bredehall.db").write_bytes(b"sqlite-data")
    (bundled / "finance_config.json").write_text('{"storage_mode":"local"}', encoding="utf-8")

    synced = sync_bundled_data(bundled_dir=bundled, runtime_dir=runtime)

    assert set(synced) == {"bredehall.db", "finance_config.json"}
    assert (runtime / "bredehall.db").read_bytes() == b"sqlite-data"


def test_sync_updates_when_hash_differs(tmp_path):
    bundled = tmp_path / "bundle"
    runtime = tmp_path / "runtime"
    bundled.mkdir()
    runtime.mkdir()
    (bundled / "bredehall.db").write_bytes(b"new")
    (runtime / "bredehall.db").write_bytes(b"old")

    synced = sync_bundled_data(bundled_dir=bundled, runtime_dir=runtime)

    assert synced == ["bredehall.db"]
    assert (runtime / "bredehall.db").read_bytes() == b"new"


def test_sync_skips_when_hash_matches(tmp_path):
    bundled = tmp_path / "bundle"
    runtime = tmp_path / "runtime"
    bundled.mkdir()
    runtime.mkdir()
    (bundled / "bredehall.db").write_bytes(b"same")
    (runtime / "bredehall.db").write_bytes(b"same")

    assert sync_bundled_data(bundled_dir=bundled, runtime_dir=runtime) == []
