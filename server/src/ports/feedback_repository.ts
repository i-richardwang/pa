import type {
  FeedbackGroup,
  FeedbackListPayload,
  FeedbackStatus,
} from "../contracts/dashboard_contract.js";
import type { FeedbackInput, NormalizedFeedbackInput } from "../contracts/feedback_input.js";

export type FeedbackRecord = NormalizedFeedbackInput & {
  id: number;
  at: string;
  caller: string;
  status: FeedbackStatus;
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  topic_key: string;
};

export type FeedbackRepository = {
  create(input: FeedbackInput, caller: string): Promise<FeedbackRecord>;
  list(limit?: number, offset?: number): Promise<FeedbackListPayload>;
  resolve(
    topicKey: string,
    status: Exclude<FeedbackStatus, "open">,
    note: string,
    resolvedBy: string,
  ): Promise<FeedbackGroup | null>;
};
