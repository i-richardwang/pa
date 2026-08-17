#!/usr/bin/env sh
# 消费方持有实体 skill 副本；本脚本从 plugins/pa/skills/pa-analytics/ 刷新。
# --replace-plugin 只转换可确认属于本仓库的 PA Plugin，并保留消费方 MCP 配置。
set -eu

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPLACE_PLUGIN=0
if [ "${1:-}" = "--replace-plugin" ]; then
  REPLACE_PLUGIN=1
  shift
fi
[ "$#" -eq 1 ] || {
  echo "用法: sync_consumer_skill.sh [--replace-plugin] <消费方目录>" >&2
  exit 1
}

DEST_ROOT_INPUT="$1"
[ -d "$DEST_ROOT_INPUT" ] || {
  echo "消费方目录不存在: $DEST_ROOT_INPUT" >&2
  exit 1
}
DEST_ROOT="$(cd "$DEST_ROOT_INPUT" && pwd)"
[ "$DEST_ROOT" != "$SOURCE_ROOT" ] || {
  echo "消费方目录不能是服务仓库本身" >&2
  exit 1
}

SRC="$SOURCE_ROOT/plugins/pa/skills/pa-analytics"
SOURCE_MARKETPLACE="$SOURCE_ROOT/.agents/plugins/marketplace.json"
SOURCE_README="$SOURCE_ROOT/templates/consumer/skill_readme.md"
DEST="$DEST_ROOT/.agents/skills/pa-analytics"
DEST_PLUGIN="$DEST_ROOT/plugins/pa"
DEST_MARKETPLACE="$DEST_ROOT/.agents/plugins/marketplace.json"

[ -f "$SRC/SKILL.md" ] || { echo "事实源不存在: $SRC" >&2; exit 1; }
[ -f "$SOURCE_README" ] || { echo "消费目录模板不存在: $SOURCE_README" >&2; exit 1; }

if [ -f "$DEST_PLUGIN/.codex-plugin/plugin.json" ]; then
  [ "$REPLACE_PLUGIN" -eq 1 ] || {
    echo "目标目录已包含 PA Codex Plugin；如要转换为 Pi/独立 Skill，增加 --replace-plugin: $DEST_ROOT" >&2
    exit 1
  }
  grep -Eq '"name"[[:space:]]*:[[:space:]]*"pa"' "$DEST_PLUGIN/.codex-plugin/plugin.json" || {
    echo "目标插件不是可确认的 PA 插件，拒绝删除: $DEST_PLUGIN" >&2
    exit 1
  }
  if [ -f "$DEST_MARKETPLACE" ] && ! cmp -s "$SOURCE_MARKETPLACE" "$DEST_MARKETPLACE"; then
    echo "目标 marketplace 含有本仓库之外的改动，拒绝自动删除: $DEST_MARKETPLACE" >&2
    exit 1
  fi
  rm -rf "$DEST_PLUGIN"
  if [ -f "$DEST_MARKETPLACE" ]; then
    rm -f "$DEST_MARKETPLACE"
    rmdir "$DEST_ROOT/.agents/plugins" 2>/dev/null || true
  fi
  rmdir "$DEST_ROOT/plugins" 2>/dev/null || true
  echo "removed PA Codex Plugin from $DEST_ROOT"
  echo "if Codex registered this marketplace, also run: codex plugin remove pa@pa-local"
  echo "then run: codex plugin marketplace remove pa-local"
fi

mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/"
cp "$SOURCE_README" "$DEST_ROOT/README.md"
rm -f "$DEST_ROOT/AGENTS.md" "$DEST_ROOT/CLAUDE.md"
echo "synced pa-analytics -> $DEST"
echo "preserved consumer MCP configuration -> $DEST_ROOT"
