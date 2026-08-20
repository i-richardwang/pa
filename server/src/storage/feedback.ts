/**
 * 数据能力反馈：Agent 在当前目录无法满足用户问题时把缺口落 app.db（提报后告知用户即可，
 * 无需事前征求同意）。反馈只进入审核队列，不改变查询与目录；补齐能力仍由管理员改模型完成。
 * topic_key 只用于把同一缺口聚合为优先级信号，每次原话仍逐行保留。
 * 业务术语不走本通道：术语由管理员在指标字典页直接维护，未登记的叫法经零命中检索进入其视野。
 */
import { createHash } from "node:crypto";
import type {
  FeedbackGroup,
  FeedbackListPayload,
  FeedbackStatus,
} from "../contracts/feedback_contract.js";
import type { FeedbackRecord, FeedbackRepository } from "../ports/feedback_repository.js";
import type { NormalizedFeedbackInput } from "../contracts/feedback_input.js";
import type { SqliteDatabase } from "../sqlite.js";

/** 同一缺口的聚合身份：按缺口解释归一，问题原话每次仍逐行保留。 */
export function feedbackTopicKey(input: NormalizedFeedbackInput): string {
  const identity = input.detail.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(JSON.stringify([identity]))
    .digest("hex")
    .slice(0, 20);
}

export function createFeedbackStore(db: SqliteDatabase): FeedbackRepository {
  async function create(input: NormalizedFeedbackInput, caller: string): Promise<FeedbackRecord> {
    const topicKey = feedbackTopicKey(input);
    const at = new Date().toISOString();
    db.prepare(
      `INSERT INTO feedback (at, caller, ask, detail, status, topic_key)
         VALUES (?, ?, ?, ?, 'open', ?)`,
    ).run(at, caller, input.ask, input.detail, topicKey);
    const row = db
      .prepare("SELECT * FROM feedback WHERE id = last_insert_rowid()")
      .get() as FeedbackRecord;
    return row;
  }

  function toGroup(
    row: FeedbackRecord & {
      occurrences: number;
      first_at: string;
      last_at: string;
      callers: string;
    },
  ): FeedbackGroup {
    return {
      topic_key: row.topic_key,
      ask: row.ask,
      detail: row.detail,
      status: row.status,
      ...(row.note ? { note: row.note } : {}),
      ...(row.resolved_by ? { resolved_by: row.resolved_by } : {}),
      ...(row.resolved_at ? { resolved_at: row.resolved_at } : {}),
      occurrences: row.occurrences,
      first_at: row.first_at,
      last_at: row.last_at,
      callers: row.callers ? row.callers.split(",") : [],
    };
  }

  async function list(limit: number, offset: number): Promise<FeedbackListPayload> {
    const total = (
      db.prepare("SELECT COUNT(DISTINCT topic_key) AS n FROM feedback").get() as { n: number }
    ).n;
    const rows = db
      .prepare(
        `WITH ranked AS (
           SELECT f.*,
                  ROW_NUMBER() OVER (PARTITION BY topic_key ORDER BY id DESC) AS recency,
                  COUNT(*) OVER (PARTITION BY topic_key) AS occurrences,
                  MIN(at) OVER (PARTITION BY topic_key) AS first_at,
                  MAX(at) OVER (PARTITION BY topic_key) AS last_at
           FROM feedback AS f
         )
         SELECT r.*,
                (SELECT GROUP_CONCAT(caller) FROM (
                   SELECT caller, MIN(id) AS first_id FROM feedback f2
                   WHERE f2.topic_key = r.topic_key GROUP BY caller ORDER BY first_id
                 )) AS callers
         FROM ranked AS r
         WHERE recency = 1
         ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
                  last_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<
      FeedbackRecord & {
        occurrences: number;
        first_at: string;
        last_at: string;
        callers: string;
      }
    >;
    return {
      rows: rows.map(toGroup),
      total,
    };
  }

  async function group(topicKey: string): Promise<FeedbackGroup | null> {
    const row = db
      .prepare(
        `WITH ranked AS (
           SELECT f.*,
                  ROW_NUMBER() OVER (ORDER BY id DESC) AS recency,
                  COUNT(*) OVER () AS occurrences,
                  MIN(at) OVER () AS first_at,
                  MAX(at) OVER () AS last_at
           FROM feedback AS f WHERE topic_key = ?
         )
         SELECT r.*,
                (SELECT GROUP_CONCAT(caller) FROM (
                   SELECT caller, MIN(id) AS first_id FROM feedback f2
                   WHERE f2.topic_key = ? GROUP BY caller ORDER BY first_id
                 )) AS callers
         FROM ranked AS r WHERE recency = 1`,
      )
      .get(topicKey, topicKey) as
      | (FeedbackRecord & {
          occurrences: number;
          first_at: string;
          last_at: string;
          callers: string;
        })
      | undefined;
    return row ? toGroup(row) : null;
  }

  async function resolve(
    topicKey: string,
    status: Exclude<FeedbackStatus, "open">,
    note: string,
    resolvedBy: string,
  ): Promise<FeedbackGroup | null> {
    const exists = db.prepare("SELECT 1 FROM feedback WHERE topic_key = ? LIMIT 1").get(topicKey);
    if (!exists) return null;
    const at = new Date().toISOString();
    db.prepare(
      `UPDATE feedback
         SET status = ?, note = ?, resolved_by = ?, resolved_at = ?
         WHERE topic_key = ?`,
    ).run(status, note, resolvedBy, at, topicKey);
    return group(topicKey);
  }

  return { create, list, resolve };
}
