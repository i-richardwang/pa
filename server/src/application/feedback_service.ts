/** 数据能力缺口的校验与入队用例。 */
import type { Principal } from "../engine/cube_security.js";
import type { FeedbackRepository } from "../ports/feedback_repository.js";
import type { UsageLog } from "../ports/usage_log.js";
import type { FeedbackStatus } from "../contracts/feedback_contract.js";
import { normalizeFeedbackInput, type FeedbackInput } from "../contracts/feedback_input.js";

export type { FeedbackInput } from "../contracts/feedback_input.js";

export type FeedbackSubmission = {
  id: number;
  topic_key: string;
  status: "open";
  message: string;
};

export type FeedbackService = ReturnType<typeof createFeedbackService>;

export function createFeedbackService(deps: {
  repository: FeedbackRepository;
  usage: Pick<UsageLog, "log">;
}) {
  async function submit(principal: Principal, input: FeedbackInput): Promise<FeedbackSubmission> {
    normalizeFeedbackInput(input);
    const record = await deps.repository.create(input, principal.email);
    return {
      id: record.id,
      topic_key: record.topic_key,
      status: "open",
      message: "反馈已进入管理员审核队列；请告知用户需求已反馈，但不会即时改变指标、口径或数据范围",
    };
  }

  async function list(limit?: number, offset?: number) {
    return deps.repository.list(limit, offset);
  }

  async function resolve(
    topicKey: string,
    status: Exclude<FeedbackStatus, "open">,
    note: string,
    resolvedBy: string,
  ) {
    const result = await deps.repository.resolve(topicKey, status, note, resolvedBy);
    if (!result) return null;
    await deps.usage.log({
      caller: resolvedBy,
      tool: "feedback",
      title: `${status === "accepted" ? "接受" : "拒绝"}反馈：${result.ask}`,
      args: { action: "resolve", topic_key: result.topic_key, status },
      outcome: "ok",
      duration_ms: 0,
    });
    return result;
  }

  return { submit, list, resolve };
}
