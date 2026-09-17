from __future__ import annotations

from ib_tws_agent import cli, config


def test_init_writes_the_configuration_at_the_platform_path(tmp_path, monkeypatch, capsys):
    target = tmp_path / "config.toml"
    monkeypatch.setattr(config, "config_path", lambda: target)

    code = cli.main(["init", "--origin", "https://app.example"])

    assert code == 0
    assert target.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'
    assert str(target) in capsys.readouterr().out


def test_init_refuses_a_bad_origin_without_writing(tmp_path, monkeypatch, capsys):
    target = tmp_path / "config.toml"
    monkeypatch.setattr(config, "config_path", lambda: target)

    code = cli.main(["init", "--origin", "app.example/"])

    assert code == 2
    assert not target.exists()
    assert "not an origin" in capsys.readouterr().err


def test_run_without_configuration_explains_and_exits(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(config, "config_path", lambda: tmp_path / "config.toml")
    started = []
    monkeypatch.setattr(cli, "serve", lambda cfg: started.append(cfg))

    code = cli.main([])

    assert code == 2
    assert started == []
    assert "ib-tws-agent init --origin" in capsys.readouterr().err


def test_run_serves_the_loaded_configuration(tmp_path, monkeypatch):
    target = tmp_path / "config.toml"
    config.write_config("https://app.example", target)
    monkeypatch.setattr(config, "config_path", lambda: target)
    started = []
    monkeypatch.setattr(cli, "serve", lambda cfg: started.append(cfg))

    assert cli.main([]) == 0
    assert started == [config.Config(origins=("https://app.example",), listen=8100)]
