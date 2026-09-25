from __future__ import annotations

from ib_tws_agent import cli, config


def use(tmp_path, monkeypatch):
    target = tmp_path / "config.toml"
    monkeypatch.setattr(config, "config_path", lambda: target)
    return target


def test_origin_add_writes_the_configuration_at_the_platform_path(tmp_path, monkeypatch, capsys):
    target = use(tmp_path, monkeypatch)

    code = cli.main(["origin", "add", "https://app.example"])

    assert code == 0
    assert target.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'
    out = capsys.readouterr().out
    assert str(target) in out
    assert "Restart" in out


def test_origin_add_refuses_a_bad_origin_without_writing(tmp_path, monkeypatch, capsys):
    target = use(tmp_path, monkeypatch)

    code = cli.main(["origin", "add", "app.example/"])

    assert code == 2
    assert not target.exists()
    assert "not an origin" in capsys.readouterr().err


def test_origin_add_an_existing_origin_says_so(tmp_path, monkeypatch, capsys):
    use(tmp_path, monkeypatch)
    cli.main(["origin", "add", "https://app.example"])
    capsys.readouterr()

    assert cli.main(["origin", "add", "https://app.example"]) == 0
    assert "already" in capsys.readouterr().out


def test_origin_list_prints_one_origin_per_line(tmp_path, monkeypatch, capsys):
    use(tmp_path, monkeypatch)
    cli.main(["origin", "add", "https://app.example"])
    cli.main(["origin", "add", "https://dev.app.example"])
    capsys.readouterr()

    assert cli.main(["origin", "list"]) == 0
    assert capsys.readouterr().out == "https://app.example\nhttps://dev.app.example\n"


def test_origin_list_without_origins_explains_on_stderr(tmp_path, monkeypatch, capsys):
    use(tmp_path, monkeypatch)

    assert cli.main(["origin", "list"]) == 0
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "ib-tws-agent origin add" in captured.err


def test_origin_remove_drops_the_origin(tmp_path, monkeypatch, capsys):
    use(tmp_path, monkeypatch)
    cli.main(["origin", "add", "https://app.example"])
    cli.main(["origin", "add", "https://dev.app.example"])

    assert cli.main(["origin", "remove", "https://app.example"]) == 0
    assert config.list_origins() == ("https://dev.app.example",)


def test_origin_remove_an_unknown_origin_fails(tmp_path, monkeypatch, capsys):
    use(tmp_path, monkeypatch)
    cli.main(["origin", "add", "https://app.example"])
    capsys.readouterr()

    assert cli.main(["origin", "remove", "https://other.example"]) == 1
    assert "not configured" in capsys.readouterr().err


def test_origin_without_an_action_prints_usage(tmp_path, monkeypatch, capsys):
    use(tmp_path, monkeypatch)

    assert cli.main(["origin"]) == 2
    assert "add" in capsys.readouterr().err


def test_run_without_configuration_explains_and_exits(tmp_path, monkeypatch, capsys):
    use(tmp_path, monkeypatch)
    started = []
    monkeypatch.setattr(cli, "serve", lambda cfg: started.append(cfg))

    code = cli.main([])

    assert code == 2
    assert started == []
    assert "ib-tws-agent origin add" in capsys.readouterr().err


def test_run_serves_the_loaded_configuration(tmp_path, monkeypatch):
    use(tmp_path, monkeypatch)
    config.add_origin("https://app.example")
    started = []
    monkeypatch.setattr(cli, "serve", lambda cfg: started.append(cfg))

    assert cli.main([]) == 0
    assert started == [config.Config(origins=("https://app.example",), listen=8100)]
