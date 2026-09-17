from __future__ import annotations

import pytest

from ib_tws_agent.config import DEFAULT_LISTEN, Config, ConfigError, load_config, write_config


def test_write_then_load_round_trips(tmp_path):
    path = write_config("https://app.example", tmp_path / "config.toml")

    assert path.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'
    assert load_config(path) == Config(origins=("https://app.example",), listen=DEFAULT_LISTEN)


def test_write_creates_the_parent_directory(tmp_path):
    path = write_config("https://app.example", tmp_path / "nested" / "dir" / "config.toml")
    assert path.exists()


@pytest.mark.parametrize("origin", ["app.example", "https://app.example/", "https://app.example/path", "ftp://x", ""])
def test_write_refuses_anything_but_a_bare_origin(tmp_path, origin):
    with pytest.raises(ConfigError):
        write_config(origin, tmp_path / "config.toml")


def test_missing_file_names_the_init_command(tmp_path):
    with pytest.raises(ConfigError, match="ib-tws-agent init --origin"):
        load_config(tmp_path / "config.toml")


def test_several_origins_are_all_kept(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('origins = ["https://app.example", "http://localhost:5173"]\nlisten = 8123\n', encoding="utf-8")
    assert load_config(path) == Config(origins=("https://app.example", "http://localhost:5173"), listen=8123)


def test_write_lowercases_the_origin_so_a_browsers_origin_header_can_ever_match(tmp_path):
    path = write_config("https://App.Example", tmp_path / "config.toml")

    assert path.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'
    assert load_config(path) == Config(origins=("https://app.example",), listen=DEFAULT_LISTEN)


def test_load_lowercases_origins_from_a_hand_edited_file(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('origins = ["https://App.Example"]\nlisten = 8100\n', encoding="utf-8")

    assert load_config(path) == Config(origins=("https://app.example",), listen=8100)


@pytest.mark.parametrize(
    "body",
    [
        "origins = []\n",
        'origins = "https://app.example"\n',
        'origins = ["https://app.example"]\nlisten = 0\n',
        'origins = ["https://app.example"]\nlisten = "8100"\n',
        "not toml at all [[[",
    ],
)
def test_invalid_file_is_refused(tmp_path, body):
    path = tmp_path / "config.toml"
    path.write_text(body, encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(path)
