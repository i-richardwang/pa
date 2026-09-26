# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Exit non-zero if any tracked or unignored file is a data artifact, local configuration, or contains a secret."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_DATA_SUFFIXES = {
    ".csv",
    ".db",
    ".duckdb",
    ".parquet",
    ".sqlite",
    ".sqlite3",
    ".tsv",
    ".xls",
    ".xlsx",
}

LOCAL_CONFIG_NAMES = {".env", ".netrc", ".npmrc", ".pypirc"}

TEXT_SUFFIXES = {
    "",
    ".css",
    ".example",
    ".html",
    ".key",
    ".json",
    ".lock",
    ".md",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".pem",
    ".crt",
    ".cer",
    ".yaml",
    ".yml",
}


FORBIDDEN_REGEXES = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "Slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    "absolute home path": re.compile(r"(?<![A-Za-z0-9])/(?:Users|home)/[^/\s]+/"),
}


def repository_files() -> list[str]:
    output = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=REPO_ROOT,
    )
    return sorted(path for path in output.decode().split("\0") if path)


def visible_text(text: str) -> str:
    """Scan JSON-style escaped Unicode with the same meaning a reader or parser sees."""

    return re.sub(
        r"\\u([0-9a-fA-F]{4})",
        lambda match: chr(int(match.group(1), 16)),
        text,
    )


def scan() -> list[str]:
    violations: list[str] = []
    for relative_path in repository_files():
        path = REPO_ROOT / relative_path
        if not path.exists():
            continue
        if path.is_dir():
            continue
        if path.suffix.lower() in FORBIDDEN_DATA_SUFFIXES:
            violations.append(f"{relative_path}: data-like artifact must not be Git-tracked")
            continue
        if (
            relative_path == ".mcp.json"
            or path.name in LOCAL_CONFIG_NAMES
            or (path.name.startswith(".env.") and path.name != ".env.example")
        ):
            violations.append(f"{relative_path}: local configuration must not be Git-tracked")
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = visible_text(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as error:
            violations.append(f"{relative_path}: text scan failed: {error}")
            continue
        for label, pattern in FORBIDDEN_REGEXES.items():
            if pattern.search(text):
                violations.append(f"{relative_path}: contains {label}")
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    violations = scan()
    if violations:
        print("open-source boundary check failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1
    print("open-source boundary check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
