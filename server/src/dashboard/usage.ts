import type { Hono, MiddlewareHandler } from "hono";
import type { DashboardDependencies, DashboardEnv } from "./types.js";
import { RESOLVE_FEEDBACK_BODY } from "../contracts/feedback_contract.js";
import { InvalidRequestError, NotFoundError } from "../application/errors.js";

const days = (request: { query(name: string): string | undefined }) =>
  Number(request.query("days") ?? 30);

/** 分页默认值和上限由各应用服务决定，HTTP 层只解析可选的数字参数。 */
function page(request: { query(name: string): string | undefined }) {
  const number = (name: string) => (request.query(name) ? Number(request.query(name)) : undefined);
  return { limit: number("limit"), offset: number("offset") };
}

export function registerUsageRoutes(
  dashboard: Hono<DashboardEnv>,
  deps: Pick<DashboardDependencies, "usage" | "feedback">,
  requireAdmin: MiddlewareHandler<DashboardEnv>,
): void {
  const { usage, feedback } = deps;

  dashboard.get("/api/usage/mine", async (c) => {
    const { limit, offset } = page(c.req);
    return c.json(await usage.mine(c.get("principal"), days(c.req), limit, offset));
  });

  dashboard.get("/api/usage/overview", requireAdmin, async (c) =>
    c.json(await usage.overview(c.get("principal"), days(c.req))),
  );

  dashboard.get("/api/usage/titles", requireAdmin, async (c) => {
    const { limit, offset } = page(c.req);
    return c.json(await usage.titles(c.get("principal"), days(c.req), limit, offset));
  });

  dashboard.get("/api/usage/unanswered", requireAdmin, async (c) =>
    c.json(await usage.unanswered(c.get("principal"), days(c.req))),
  );

  dashboard.get("/api/feedback", requireAdmin, async (c) => {
    const { limit, offset } = page(c.req);
    return c.json(await feedback.list(c.get("principal"), limit, offset));
  });

  dashboard.patch("/api/feedback/:topic_key", requireAdmin, async (c) => {
    const parsed = RESOLVE_FEEDBACK_BODY.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new InvalidRequestError("status 须为 accepted 或 rejected");
    const body = parsed.data;
    const result = await feedback.resolve(
      c.get("principal"),
      c.req.param("topic_key"),
      body.status,
      body.note,
    );
    if (!result) throw new NotFoundError("反馈主题不存在");
    return c.json(result);
  });
}
