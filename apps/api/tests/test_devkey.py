from pathlib import Path

from config.devkey import checkout_git_dir, read_or_create_dev_secret


def test_creates_the_key_once_and_reuses_it(tmp_path):
    (tmp_path / ".git").mkdir()
    first = read_or_create_dev_secret(tmp_path)
    assert len(first) >= 50
    assert read_or_create_dev_secret(tmp_path) == first
    assert (tmp_path / ".git" / "dev-secret-key").read_text().strip() == first


def test_follows_a_worktree_to_its_own_git_directory(tmp_path):
    main = tmp_path / "main"
    (main / ".git" / "worktrees" / "feature").mkdir(parents=True)
    tree = tmp_path / "tree"
    tree.mkdir()
    (tree / ".git").write_text(f"gitdir: {main / '.git' / 'worktrees' / 'feature'}\n")

    assert checkout_git_dir(tree) == main / ".git" / "worktrees" / "feature"
    key = read_or_create_dev_secret(tree)
    assert (main / ".git" / "worktrees" / "feature" / "dev-secret-key").read_text().strip() == key
    assert key != read_or_create_dev_secret(main)


def test_falls_back_to_a_writable_path_when_there_is_no_git_directory(tmp_path):
    key = read_or_create_dev_secret(tmp_path)
    assert (tmp_path / "dev-secret-key").read_text().strip() == key
    assert read_or_create_dev_secret(tmp_path) == key
