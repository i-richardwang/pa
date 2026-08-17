import { FEEDBACK_LIMITS } from "./dashboard_contract.js";

export type FeedbackInput = {
  ask: string;
  detail: string;
};

export type NormalizedFeedbackInput = {
  ask: string;
  detail: string;
};

function text(name: keyof typeof FEEDBACK_LIMITS, value: unknown, required: true): string;
function text(name: keyof typeof FEEDBACK_LIMITS, value: unknown, required: false): string | null;
function text(
  name: keyof typeof FEEDBACK_LIMITS,
  value: unknown,
  required: boolean,
): string | null {
  if (value === undefined || value === null) {
    if (required) throw new Error(`缺少 ${name}`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${name} 应为文本`);
  const clean = value.trim();
  if (!clean) {
    if (required) throw new Error(`缺少 ${name}`);
    return null;
  }
  if (clean.length > FEEDBACK_LIMITS[name]) {
    throw new Error(`${name} 最长 ${FEEDBACK_LIMITS[name]} 字`);
  }
  return clean;
}

/** 只收问题原话与缺口解释：缺什么、已尝试什么、为何现有目录无法满足。 */
export function normalizeFeedbackInput(input: FeedbackInput): NormalizedFeedbackInput {
  return {
    ask: text("ask", input.ask, true),
    detail: text("detail", input.detail, true),
  };
}

export function normalizeFeedbackNote(note: unknown): string {
  return text("note", note, true);
}
