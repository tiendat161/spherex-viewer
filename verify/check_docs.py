"""Offline check that docs/structure.md matches the files on disk, run by `make verify-docs`.

1. Every source file (tracked or new, not ignored) under SOURCE_DIRS is named in
   docs/structure.md inside backticks, by its path or by the end of its path
   (`model.js`, `src/model.js` and `web/src/model.js` all name web/src/model.js).
2. Every backticked name in docs/structure.md that looks like a source file
   (no wildcard or placeholder, extension in FILE_EXTS) names a file that exists.

It checks names only: it cannot tell whether a description is still right.
Exits non-zero on any failure. Never touches the network.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUIDE = ROOT / "docs" / "structure.md"
SOURCE_DIRS = ("contracts/", "pipeline/", "api/", "web/", "verify/", "tests/", "fixtures/", "docs/")
SKIP_NAMES = {"__init__.py", "package-lock.json", ".gitignore"}
FILE_EXTS = (".py", ".js", ".json", ".md", ".css", ".html")


def repo_files():
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, check=True,
                         capture_output=True, text=True).stdout
    return [f for f in out.splitlines() if (ROOT / f).is_file()]


def names(path, token):
    """True if the backticked `token` names the file at `path`."""
    token = token.lstrip("./")
    return path == token or path.endswith("/" + token)


def main():
    files = repo_files()
    tokens = set(re.findall(r"`([^`\n]+)`", GUIDE.read_text()))
    failures = []

    sources = [f for f in files if f.startswith(SOURCE_DIRS) and Path(f).name not in SKIP_NAMES]
    for f in sources:
        if not any(names(f, t) for t in tokens):
            failures.append(f"{f}: not mentioned in docs/structure.md")

    named = 0
    for t in sorted(tokens):
        if not t.endswith(FILE_EXTS) or re.search(r"[*<>\s]", t) or t.startswith(("--", "?")):
            continue
        named += 1
        if not any(names(f, t) for f in files):
            failures.append(f"docs/structure.md names `{t}`, which does not exist")

    for line in failures:
        print(f"FAIL  {line}")
    print(f"{'FAIL' if failures else 'ok'}    docs/structure.md: {len(sources)} source files, {named} file names checked")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
