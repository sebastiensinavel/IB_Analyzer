from __future__ import annotations

import pytest

from ib_tws_agent.config import (
    DEFAULT_LISTEN,
    Config,
    ConfigError,
    add_origin,
    list_origins,
    load_config,
    remove_origin,
)


def test_add_then_load_round_trips(tmp_path):
    path = tmp_path / "config.toml"
    assert add_origin("https://app.example", path) is True

    assert path.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'
    assert load_config(path) == Config(origins=("https://app.example",), listen=DEFAULT_LISTEN)


def test_add_creates_the_parent_directory(tmp_path):
    path = tmp_path / "nested" / "dir" / "config.toml"
    add_origin("https://app.example", path)
    assert path.exists()


def test_add_appends_to_the_existing_origins(tmp_path):
    path = tmp_path / "config.toml"
    add_origin("https://app.example", path)
    add_origin("https://dev.app.example", path)

    assert list_origins(path) == ("https://app.example", "https://dev.app.example")


def test_add_twice_is_a_no_op(tmp_path):
    path = tmp_path / "config.toml"
    add_origin("https://app.example", path)

    assert add_origin("https://App.Example", path) is False
    assert list_origins(path) == ("https://app.example",)


def test_add_keeps_a_hand_edited_port(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('origins = ["https://app.example"]\nlisten = 8123\n', encoding="utf-8")

    add_origin("https://dev.app.example", path)

    assert load_config(path) == Config(origins=("https://app.example", "https://dev.app.example"), listen=8123)


@pytest.mark.parametrize("origin", ["app.example", "https://app.example/", "https://app.example/path", "ftp://x", ""])
def test_add_refuses_anything_but_a_bare_origin(tmp_path, origin):
    path = tmp_path / "config.toml"
    with pytest.raises(ConfigError):
        add_origin(origin, path)
    assert not path.exists()


def test_add_lowercases_the_origin_so_a_browsers_origin_header_can_ever_match(tmp_path):
    path = tmp_path / "config.toml"
    add_origin("https://App.Example", path)

    assert path.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'


def test_add_refuses_to_overwrite_an_unreadable_file(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text("not toml at all [[[", encoding="utf-8")

    with pytest.raises(ConfigError):
        add_origin("https://app.example", path)
    assert path.read_text(encoding="utf-8") == "not toml at all [[["


def test_remove_drops_only_that_origin(tmp_path):
    path = tmp_path / "config.toml"
    add_origin("https://app.example", path)
    add_origin("https://dev.app.example", path)

    assert remove_origin("https://App.Example", path) is True
    assert list_origins(path) == ("https://dev.app.example",)


def test_remove_an_unknown_origin_is_a_no_op(tmp_path):
    path = tmp_path / "config.toml"
    add_origin("https://app.example", path)

    assert remove_origin("https://other.example", path) is False
    assert list_origins(path) == ("https://app.example",)


def test_remove_the_last_origin_leaves_a_file_that_asks_for_one(tmp_path):
    path = tmp_path / "config.toml"
    add_origin("https://app.example", path)
    remove_origin("https://app.example", path)

    assert list_origins(path) == ()
    with pytest.raises(ConfigError, match="ib-tws-agent origin add"):
        load_config(path)


def test_list_without_a_file_is_empty(tmp_path):
    assert list_origins(tmp_path / "config.toml") == ()


def test_missing_file_names_the_add_command(tmp_path):
    with pytest.raises(ConfigError, match="ib-tws-agent origin add"):
        load_config(tmp_path / "config.toml")


def test_several_origins_are_all_kept(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('origins = ["https://app.example", "http://localhost:5173"]\nlisten = 8123\n', encoding="utf-8")
    assert load_config(path) == Config(origins=("https://app.example", "http://localhost:5173"), listen=8123)


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
