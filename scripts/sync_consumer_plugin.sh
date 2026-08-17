#!/usr/bin/env sh
# 把 PA Codex Plugin、marketplace 与接入文件同步到 Codex 消费目录。
# 独立 skill 分发由 sync_consumer_skill.sh 处理，二者不能落在同一目录。
set -eu

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_ROOT_INPUT="${1:?用法: sync_consumer_plugin.sh <消费方目录>}"

[ -d "$DEST_ROOT_INPUT" ] || {
  echo "消费方目录不存在: $DEST_ROOT_INPUT" >&2
  exit 1
}

DEST_ROOT="$(cd "$DEST_ROOT_INPUT" && pwd)"
[ "$DEST_ROOT" != "$SOURCE_ROOT" ] || {
  echo "消费方目录不能是服务仓库本身" >&2
  exit 1
}

SOURCE_PLUGIN="$SOURCE_ROOT/plugins/pa"
SOURCE_MARKETPLACE="$SOURCE_ROOT/.agents/plugins/marketplace.json"
SOURCE_TEMPLATES="$SOURCE_ROOT/templates/consumer"
DEST_PLUGIN="$DEST_ROOT/plugins/pa"
DEST_MARKETPLACE="$DEST_ROOT/.agents/plugins/marketplace.json"

[ -f "$SOURCE_PLUGIN/.codex-plugin/plugin.json" ] || {
  echo "插件事实源不存在: $SOURCE_PLUGIN" >&2
  exit 1
}
[ -f "$SOURCE_MARKETPLACE" ] || {
  echo "marketplace 事实源不存在: $SOURCE_MARKETPLACE" >&2
  exit 1
}
for template in readme.md cursor_mcp.json; do
  [ -f "$SOURCE_TEMPLATES/$template" ] || {
    echo "消费目录模板不存在: $SOURCE_TEMPLATES/$template" >&2
    exit 1
  }
done

mkdir -p "$DEST_PLUGIN" "$(dirname "$DEST_MARKETPLACE")" "$DEST_ROOT/.cursor"
rsync -a --delete "$SOURCE_PLUGIN/" "$DEST_PLUGIN/"
cp "$SOURCE_MARKETPLACE" "$DEST_MARKETPLACE"
cp "$SOURCE_TEMPLATES/readme.md" "$DEST_ROOT/README.md"
cp "$SOURCE_TEMPLATES/cursor_mcp.json" "$DEST_ROOT/.cursor/mcp.json"
rm -f "$DEST_ROOT/AGENTS.md" "$DEST_ROOT/CLAUDE.md"

# 插件与同名独立 Skill 互斥，确保目标目录不并存两种分发形态。
rm -rf "$DEST_ROOT/.agents/skills/pa-analytics"
rmdir "$DEST_ROOT/.agents/skills" 2>/dev/null || true

echo "synced pa plugin -> $DEST_PLUGIN"
echo "synced pa marketplace -> $DEST_MARKETPLACE"
echo "synced pa consumer files -> $DEST_ROOT"
