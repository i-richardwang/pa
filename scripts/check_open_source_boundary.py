# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Fail closed when a Git tree contains data artifacts, local configuration, or secrets."""

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

PUBLIC_SURFACE_PREFIXES = ("demo/", "docs/", "plugins/", "server/", "templates/")
PUBLIC_SURFACE_FILES = {
    ".env.example",
    ".gitignore",
    "AGENTS.md",
    "CLAUDE.md",
    "LICENSE",
    "README.md",
    "docker-compose.yml",
}
YAML_NAME = re.compile(r"^\s*-\s+name:\s*([a-z][a-z0-9_]*)\s*(?:#.*)?$", re.MULTILINE)

# 公共核心测试长期使用的行业通用指标标识；它们与任一企业语义包无专属关系。
PUBLIC_GENERIC_SEMANTIC_NAMES = {
    "active_employee_count",
    "current_month_fulfillment_rate",
    "current_month_turnover_rate",
    "new_hire_count",
    "turnover_count",
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


def yaml_names(paths: list[Path]) -> set[str]:
    names: set[str] = set()
    for path in paths:
        if path.is_file():
            names.update(YAML_NAME.findall(path.read_text(encoding="utf-8")))
    return names


def private_only_semantic_names() -> set[str]:
    """Derive organization-specific names from an optional private semantic package."""

    private_model = REPO_ROOT / "cube" / "model"
    if not private_model.is_dir():
        return set()
    private_paths = sorted(private_model.rglob("*.yml"))
    private_paths.extend(sorted(private_model.rglob("*.yaml")))
    private_paths.extend(
        path for path in [REPO_ROOT / "cube" / "semantic_package.yml"] if path.is_file()
    )

    demo_root = REPO_ROOT / "demo"
    demo_paths = sorted((demo_root / "model").rglob("*.yml"))
    demo_paths.extend(sorted((demo_root / "model").rglob("*.yaml")))
    demo_paths.extend(path for path in [demo_root / "semantic_package.yml"] if path.is_file())
    return yaml_names(private_paths) - yaml_names(demo_paths) - PUBLIC_GENERIC_SEMANTIC_NAMES


def is_public_surface(relative_path: str) -> bool:
    return relative_path in PUBLIC_SURFACE_FILES or relative_path.startswith(
        PUBLIC_SURFACE_PREFIXES
    )


def scan() -> list[str]:
    violations: list[str] = []
    private_names = private_only_semantic_names()
    private_name_pattern = (
        re.compile(
            rf"(?<![A-Za-z0-9_])(?:{'|'.join(map(re.escape, sorted(private_names, key=len, reverse=True)))})"
            r"(?![A-Za-z0-9_])"
        )
        if private_names
        else None
    )
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
        if private_name_pattern is not None and is_public_surface(relative_path):
            matches = sorted(set(private_name_pattern.findall(text)))
            if matches:
                violations.append(
                    f"{relative_path}: references private-only semantic names: "
                    + ", ".join(matches)
                )
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
