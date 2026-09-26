# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""汇总 app.db 中的使用日志，生成最近 N 天的 MCP 使用报告。

报告分八节：
1. 调用量：按工具和结果统计，附结果被截断的次数
2. Agent 查询行为：多概念检索的零命中比例、维度取值查询次数、返回 0 行的分析次数；
   发布新指标或修改 Skill 后，这些数字变差说明 Agent 的查询方式出了问题
3. 分析问题：Agent 传入的 title 原文，即用户实际提出的数据问题
4. 人员明细查看：按结果统计查看次数和返回行数
5. catalog 未命中术语：逐个术语统计未命中次数
6. 待处理反馈：Agent 提报的数据缺口
7. 派生查询排行：按查询指纹统计派生公式，高频的可考虑建成正式指标
8. 报错调用：按报错文本统计

用法：uv run scripts/usage_report.py [--days 30] [--db server/data/app.db]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
USAGE_ERROR_GROUP_TEXT_LIMIT = 200
USAGE_LOG_RETENTION_DAYS = 90


def section(title: str) -> None:
    print(f"\n## {title}\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--days", type=int, default=30, help="统计最近 N 天（默认 30）")
    parser.add_argument(
        "--db",
        type=Path,
        default=REPO / "server" / "data" / "app.db",
        help="app.db 路径（默认 server/data/app.db）",
    )
    args = parser.parse_args()
    days = min(max(args.days, 1), USAGE_LOG_RETENTION_DAYS)

    if not args.db.exists():
        print(f"未找到数据库文件：{args.db}", file=sys.stderr)
        return 1
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='usage_log'"
    ).fetchone()
    if not exists:
        print("未找到 usage_log 表：服务还没有记录过任何调用", file=sys.stderr)
        return 1

    print(f"# MCP 使用报告（最近 {days} 天，截至 {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC）")

    section("调用量（工具 × 结果）")
    for r in conn.execute(
        """SELECT tool, outcome, COUNT(*) AS n,
                  SUM(COALESCE(has_more, 0)) AS truncated
           FROM usage_log WHERE at >= ? GROUP BY tool, outcome ORDER BY tool, outcome""",
        (since,),
    ):
        extras = []
        if r["truncated"]:
            extras.append(f"结果被截断 {r['truncated']} 次")
        suffix = f"（{'，'.join(extras)}）" if extras else ""
        print(f"- {r['tool']} / {r['outcome']}: {r['n']}{suffix}")

    section("Agent 查询行为")
    multi = conn.execute(
        """SELECT COUNT(*) AS n, SUM(CASE WHEN row_count = 0 THEN 1 ELSE 0 END) AS zero
           FROM usage_log
           WHERE at >= ? AND tool = 'catalog' AND term_count > 1""",
        (since,),
    ).fetchone()
    if multi["n"]:
        rate = multi["zero"] / multi["n"] * 100
        print(
            f"- 多概念检索：{multi['n']} 次，零命中 {multi['zero']} 次（{rate:.0f}%，比例上升说明目录检索效果变差）"
        )
    else:
        print("- 多概念检索：无")
    values = conn.execute(
        """SELECT COUNT(*) AS n FROM usage_log
           WHERE at >= ? AND tool = 'values_of'""",
        (since,),
    ).fetchone()
    print(
        f"- 维度取值查询（values_of）：{values['n']} 次"
        "（按具体值筛选前应先查询候选值；长期为 0 说明 Skill 指引没有生效）"
    )
    empty = conn.execute(
        """SELECT COUNT(*) AS n FROM usage_log
           WHERE at >= ? AND tool IN ('run_analysis', 'rerun_analysis') AND outcome = 'ok'
             AND COALESCE(row_count, 0) = 0""",
        (since,),
    ).fetchone()
    print(
        f"- 返回 0 行的分析：{empty['n']} 次"
        "（可能用错了筛选值或口径；可对照「catalog 未命中术语」一节查找缺失的术语）"
    )

    section("分析问题（title 原文，最近 50 条）")
    rows = conn.execute(
        """SELECT at, caller, title, row_count
           FROM usage_log
           WHERE at >= ? AND tool IN ('run_analysis', 'rerun_analysis') AND outcome = 'ok' AND title IS NOT NULL
           ORDER BY at DESC LIMIT 50""",
        (since,),
    ).fetchall()
    if not rows:
        print("（无。检查 Agent 是否按 Skill 指引传入 title）")
    for r in rows:
        print(f"- {r['at'][:16]} [{r['caller']}] {r['title']}（{r['row_count']} 行）")

    section("人员明细查看")
    projection_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='record_projection_audit'"
    ).fetchone()
    rows = []
    if projection_exists:
        rows = conn.execute(
            """SELECT outcome, COUNT(*) AS n, SUM(COALESCE(row_count, 0)) AS rows
               FROM record_projection_audit
               WHERE at >= ? GROUP BY outcome ORDER BY outcome""",
            (since,),
        ).fetchall()
    if not rows:
        print("（无）")
    for r in rows:
        print(f"- {r['outcome']}: {r['n']} 次，共返回 {r['rows']} 行")

    section("catalog 未命中术语（目录或术语库可能缺少的概念）")
    rows = conn.execute(
        """SELECT CAST(j.value AS TEXT) AS term, COUNT(*) AS n, MAX(u.at) AS last_at
           FROM usage_log AS u, json_each(u.unmatched_terms) AS j
           WHERE u.at >= ? AND u.tool = 'catalog' AND u.unmatched_terms IS NOT NULL
           GROUP BY term ORDER BY n DESC, last_at DESC""",
        (since,),
    ).fetchall()
    if not rows:
        print("（无）")
    for r in rows:
        print(f"- 「{r['term']}」×{r['n']}（最近 {r['last_at'][:16]}）")

    section("待处理反馈（Agent 提报的数据缺口）")
    feedback_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='feedback'"
    ).fetchone()
    rows = []
    if feedback_exists:
        rows = conn.execute(
            """WITH ranked AS (
                 SELECT f.*,
                        ROW_NUMBER() OVER (PARTITION BY topic_key ORDER BY id DESC) AS recency,
                        COUNT(*) OVER (PARTITION BY topic_key) AS occurrences,
                        MAX(at) OVER (PARTITION BY topic_key) AS last_at
                 FROM feedback AS f WHERE at >= ?
               )
               SELECT * FROM ranked
               WHERE recency = 1 AND status = 'open'
               ORDER BY occurrences DESC, last_at DESC""",
            (since,),
        ).fetchall()
    if not rows:
        print("（无）")
    for r in rows:
        print(f"- ×{r['occurrences']} {r['detail']}（最近 {r['last_at'][:16]}；原话：{r['ask']}）")

    section("派生查询排行（高频的可考虑建成正式指标）")
    rows = conn.execute(
        """WITH derived AS (
             SELECT query_fingerprint, derived_formulas, at
             FROM usage_log AS u
             WHERE at >= ? AND tool = 'run_analysis' AND outcome = 'ok'
               AND query_fingerprint IS NOT NULL
               AND json_array_length(derived_formulas) > 0
           ), ranked AS (
             SELECT query_fingerprint, derived_formulas, at,
                    COUNT(*) OVER (PARTITION BY query_fingerprint) AS n,
                    ROW_NUMBER() OVER (PARTITION BY query_fingerprint ORDER BY at DESC) AS recency
             FROM derived
           )
           SELECT query_fingerprint, derived_formulas, n, at AS last_at
           FROM ranked WHERE recency = 1
           ORDER BY n DESC, last_at DESC LIMIT 30""",
        (since,),
    ).fetchall()
    if not rows:
        print("（无）")
    for r in rows:
        print(
            f"- `{r['query_fingerprint']}` ×{r['n']}："
            f"{'；'.join(json.loads(r['derived_formulas']))}"
            f"（最近 {r['last_at'][:16]}）"
        )

    section("报错调用")
    rows = conn.execute(
        f"""SELECT tool, substr(error, 1, {USAGE_ERROR_GROUP_TEXT_LIMIT}) AS err,
                  COUNT(*) AS n, MAX(at) AS last_at
           FROM usage_log
           WHERE at >= ? AND outcome = 'error'
           GROUP BY tool, err ORDER BY n DESC, last_at DESC LIMIT 30""",
        (since,),
    ).fetchall()
    if not rows:
        print("（无）")
    for r in rows:
        print(f"- [{r['tool']}] ×{r['n']} {r['err']}（最近 {r['last_at'][:16]}）")

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
