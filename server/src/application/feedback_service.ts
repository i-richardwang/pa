/** 数据能力缺口的校验与入队用例。 */
import type { Principal } from "../contracts/principal.js";
import type { FeedbackRepository } from "../ports/feedback_repository.js";
import type { UsageService } from "./usage_service.js";
import { FEEDBACK_TOPIC_KEY_SCHEMA, type FeedbackStatus } from "../contracts/feedback_contract.js";
import {
  normalizeFeedbackInput,
  normalizeFeedbackNote,
  type FeedbackInput,
} from "../contracts/feedback_input.js";
import { normalizePagination } from "../contracts/pagination_contract.js";
import { ForbiddenError, InvalidRequestError } from "./errors.js";

export type FeedbackSubmission = {
  id: number;
  topic_key: string;
  status: "open";
  message: string;
};

export type FeedbackService = ReturnType<typeof createFeedbackService>;

export function createFeedbackService(deps: {
  repository: FeedbackRepository;
  usage: Pick<UsageService, "log">;
}) {
  const assertAdmin = (principal: Principal) => {
    if (!principal.roles.includes("admin")) throw new ForbiddenError("需要管理员权限");
  };

  async function submit(principal: Principal, input: FeedbackInput): Promise<FeedbackSubmission> {
    const record = await deps.repository.create(normalizeFeedbackInput(input), principal.email);
    return {
      id: record.id,
      topic_key: record.topic_key,
      status: "open",
      message: "反馈已进入管理员审核队列；请告知用户需求已反馈，但不会即时改变指标、口径或数据范围",
    };
  }

  async function list(principal: Principal, limit?: number, offset?: number) {
    assertAdmin(principal);
    const page = normalizePagination(limit, offset);
    return deps.repository.list(page.limit, page.offset);
  }

  async function resolve(
    principal: Principal,
    topicKey: string,
    status: Exclude<FeedbackStatus, "open">,
    note: string,
  ) {
    assertAdmin(principal);
    const parsedKey = FEEDBACK_TOPIC_KEY_SCHEMA.safeParse(topicKey);
    if (!parsedKey.success) throw new InvalidRequestError("无效的反馈主题编号");
    const result = await deps.repository.resolve(
      parsedKey.data,
      status,
      normalizeFeedbackNote(note),
      principal.email,
    );
    if (!result) return null;
    await deps.usage.log({
      caller: principal.email,
      tool: "feedback",
      title: `${status === "accepted" ? "接受" : "拒绝"}反馈：${result.ask}`,
      outcome: "ok",
      duration_ms: 0,
    });
    return result;
  }

  return { submit, list, resolve };
}
