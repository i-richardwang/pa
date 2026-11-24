import { ResultLimitExceededError } from "../engine/result_limit.js";
import type { CubeGateway, CubeSecurityContext, CubeView } from "../ports/cube_gateway.js";
import {
  OBSERVATION_OCCURRENCE_SCHEMA,
  type ObservationPeriod,
} from "../semantic_core/query_payload.js";
import type { ObservationSource, TimeSourceRegistry } from "../semantic_core/time_source.js";
import { ForbiddenError, InvalidRequestError } from "./errors.js";

export type Occurrence = NonNullable<ObservationPeriod["occurrence"]>;
const MAX_OCCURRENCES = 1000;

function hasObservationMembers(view: CubeView, source: ObservationSource): boolean {
  return [
    source.id_member,
    source.date_member,
    ...(source.title_member ? [source.title_member] : []),
  ].every((name) => view.dimensions.some((member) => member.name === `${view.name}.${name}`));
}

async function discoverOccurrences(
  cube: Pick<CubeGateway, "load">,
  security: CubeSecurityContext,
  view: CubeView,
  source: ObservationSource,
): Promise<Occurrence[]> {
  const { id_member, date_member, title_member } = source;
  const idMember = `${view.name}.${id_member}`;
  const dateMember = `${view.name}.${date_member}`;
  const titleMember = title_member ? `${view.name}.${title_member}` : undefined;
  const dimensions = [...new Set([idMember, dateMember, ...(titleMember ? [titleMember] : [])])];
  const loaded = await cube.load({ dimensions, limit: MAX_OCCURRENCES + 1 }, security);
  if (loaded.data.length > MAX_OCCURRENCES) {
    throw new ResultLimitExceededError("可见期次数量超过上限", { limit: MAX_OCCURRENCES });
  }
  const byId = new Map<string, Occurrence>();
  for (const row of loaded.data) {
    const parsed = OBSERVATION_OCCURRENCE_SCHEMA.safeParse({
      id: row[idMember],
      date: row[dateMember],
      title: titleMember ? (row[titleMember] ?? undefined) : undefined,
    });
    if (!parsed.success) throw new Error("观测来源返回的期次信息无效");
    const occurrence = parsed.data;
    if (byId.has(occurrence.id)) throw new Error("观测来源为同一期次返回了不一致的日期或标题");
    byId.set(occurrence.id, occurrence);
  }
  return [...byId.values()].sort(
    (left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
  );
}

export function createObservationDirectory(input: {
  cube: Pick<CubeGateway, "load">;
  security: CubeSecurityContext;
  views: CubeView[];
  sources: TimeSourceRegistry;
}) {
  const { cube, security, views, sources } = input;
  const sequences = new Map<string, Promise<Occurrence[]>>();
  function binding(sourceId: string) {
    const source = sources.by_id.get(sourceId)?.observation;
    if (!source) return undefined;
    const anchors = views.filter(
      (view) =>
        view.meta?.time_source === sourceId && typeof view.meta?.time_anchor_measure === "string",
    );
    if (anchors.length > 1) throw new Error("观测时间来源的时钟锚点重复");
    const anchor = anchors[0];
    return anchor && hasObservationMembers(anchor, source) ? { anchor, source } : undefined;
  }
  function sequence(sourceId: string): Promise<Occurrence[]> {
    const prior = sequences.get(sourceId);
    if (prior) return prior;
    const resolved = binding(sourceId);
    if (!resolved) throw new ForbiddenError("当前权限不能查询观测期次");
    const loaded = discoverOccurrences(cube, security, resolved.anchor, resolved.source);
    sequences.set(sourceId, loaded);
    return loaded;
  }
  function forMember(memberId: string) {
    const member = memberId.slice("dimension:".length);
    const registered = sources.definitions.filter(
      (source) => source.observation && memberId === `dimension:${source.observation.id_member}`,
    );
    if (!registered.length) return undefined;
    const visible = registered.filter(({ id }) =>
      views.some(
        (view) =>
          view.meta?.time_source === id &&
          view.dimensions.some((dimension) => dimension.name === `${view.name}.${member}`),
      ),
    );
    if (visible.length > 1) {
      throw new InvalidRequestError("多个可见调研时间来源共用期次维度，需由语义包分别声明期次维度");
    }
    const id = visible[0]?.id;
    const resolved = id && binding(id);
    if (!id || !resolved) throw new ForbiddenError("当前权限不能查询观测期次");
    const { anchor, source } = resolved;
    return { member: `${anchor.name}.${source.id_member}`, sequence: () => sequence(id) };
  }
  return { sequence, forMember };
}

export type ObservationDirectory = ReturnType<typeof createObservationDirectory>;
