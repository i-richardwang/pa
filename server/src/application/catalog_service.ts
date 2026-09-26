import {
  browseCatalogDocument,
  searchCatalogDocument,
  toSemanticCatalog,
  type CatalogQueryResult,
} from "../engine/catalog_document.js";
import {
  authorizeCanonicalSemanticModel,
  type AuthorizedSemanticModel,
  type CanonicalSemanticModel,
} from "../engine/canonical_semantic_model.js";
import { catalogMember } from "../semantic_core/query_intent.js";
import { normalizeCatalogQuery, type CatalogQueryInput } from "../contracts/catalog_query.js";
import type { CubeGateway } from "../ports/cube_gateway.js";
import { cubeSecurityContext } from "../engine/cube_security.js";
import type { Principal } from "../contracts/principal.js";
import type { AccessScopeDefinition } from "../contracts/access_scope.js";
import {
  DIMENSION_VALUES_CAP,
  DIMENSION_VALUES_SCAN_LIMIT,
  dimensionValuesQuery,
  findSearchableDimension,
} from "../engine/dimension_values.js";
import type {
  CatalogDimensionValues,
  PublicCatalogDocument,
} from "../contracts/catalog_contract.js";
import type {
  BusinessTermResolution,
  PublicBusinessTerm,
} from "../contracts/business_term_contract.js";
import { publicTimeContext } from "./time_context.js";
import type { BusinessTermRegistry } from "./business_term_registry.js";
import type { CubeSecurityContext, TimeContext } from "../ports/cube_gateway.js";
import { InvalidRequestError, UnavailableError } from "./errors.js";

/** 用户只看到可重试提示；模型装配的完整诊断保留在 cause 和服务端日志中。 */
export class SemanticModelUnavailableError extends UnavailableError {
  constructor(cause: unknown) {
    super("数据模型暂时不可用，请稍后重试", cause);
    this.name = "SemanticModelUnavailableError";
  }
}

export type CatalogQueryPayload = {
  access_scope: AccessScopeDefinition;
  observation_scopes: string[];
  data_as_of: string;
  time_context: ReturnType<typeof publicTimeContext>;
  term_knowledge_status: "available" | "unavailable";
  term_resolutions: BusinessTermResolution[];
  ambiguous_terms: string[];
} & CatalogQueryResult;

export type AuthorizedSemanticContext = Pick<
  AuthorizedSemanticModel,
  "views" | "compiler" | "time_sources"
> & {
  principal: Principal;
  cubeContext: CubeSecurityContext;
  timeContext: TimeContext;
};

export type CatalogService = {
  query(principal: Principal, input: CatalogQueryInput): Promise<CatalogQueryPayload>;
  context(principal: Principal): Promise<AuthorizedSemanticContext>;
  publicDocument(principal: Principal): Promise<PublicCatalogDocument>;
  dimensionValues(
    principal: Principal,
    member: string,
    contains?: string,
  ): Promise<CatalogDimensionValues>;
};

/** 业务术语的相关成员只扩大本次检索结果，不写入目录文档和编译器目录，也不影响查询编译与执行。 */
export function createCatalogService(deps: {
  cube: Pick<CubeGateway, "meta" | "load" | "timeContext">;
  canonical: CanonicalSemanticModel;
  businessTerms: Pick<BusinessTermRegistry, "resolve">;
}): CatalogService {
  const model = async (principal: Principal) => {
    // cubeSecurityContext 的授权错误要原样返回给用户，所以放在 try 之外。
    const context = cubeSecurityContext(principal);
    try {
      const views = await deps.cube.meta(context);
      const authorized = authorizeCanonicalSemanticModel(deps.canonical, views);
      return { context, ...authorized };
    } catch (error) {
      console.error("[pa] 语义模型装配失败:", error);
      throw new SemanticModelUnavailableError(error);
    }
  };

  const document = async (principal: Principal) => (await model(principal)).document;
  const context = async (principal: Principal): Promise<AuthorizedSemanticContext> => {
    const [authorized, timeContext] = await Promise.all([
      model(principal),
      deps.cube.timeContext().catch((error) => {
        console.error("[pa] 时间上下文读取失败:", error);
        throw new SemanticModelUnavailableError(error);
      }),
    ]);
    return {
      principal,
      cubeContext: authorized.context,
      views: authorized.views,
      compiler: authorized.compiler,
      time_sources: authorized.time_sources,
      timeContext,
    };
  };

  return {
    async query(principal, rawInput) {
      const input = normalizeCatalogQuery(rawInput);
      const catalog = await document(principal);
      const context = await deps.cube.timeContext().catch(() => null);
      const shared = {
        access_scope: catalog.access_scope,
        observation_scopes: catalog.observation_scopes,
        data_as_of: context?.dataAsOf ?? "未知",
        time_context: publicTimeContext(catalog.views, context, deps.canonical.time_sources),
      };
      if (input.mode === "overview") {
        return {
          ...shared,
          ...browseCatalogDocument(catalog),
          term_knowledge_status: "available" as const,
          term_resolutions: [],
          ambiguous_terms: [],
        };
      }
      const visible = toSemanticCatalog(catalog);
      const members = [...visible.measures, ...visible.dimensions];
      let termKnowledgeStatus: "available" | "unavailable" = "available";
      let resolutions: BusinessTermResolution[] = [];
      try {
        resolutions = await deps.businessTerms.resolve(input.terms, members);
      } catch (error) {
        termKnowledgeStatus = "unavailable";
        console.error("[pa] 业务术语读取失败，本次目录不带术语解释:", error);
      }
      const relatedIds = new Set(
        resolutions.flatMap(({ matches }) =>
          matches.flatMap((match: PublicBusinessTerm) =>
            match.related_members
              .filter(({ status }) => status === "available")
              .map(({ id }) => id),
          ),
        ),
      );
      const search = searchCatalogDocument(catalog, input.terms, relatedIds);
      const resolvedInputs = new Set(resolutions.map(({ input_term }) => input_term));
      const matched = input.terms.filter(
        (term) => search.matched_terms.includes(term) || resolvedInputs.has(term),
      );
      return {
        ...shared,
        ...search,
        matched_terms: matched,
        unmatched_terms: input.terms.filter((term) => !matched.includes(term)),
        term_knowledge_status: termKnowledgeStatus,
        term_resolutions: resolutions,
        ambiguous_terms: resolutions
          .filter(({ status }) => status === "ambiguous")
          .map(({ input_term }) => input_term),
      };
    },

    context,

    async publicDocument(principal) {
      const catalog = await document(principal);
      const context = await deps.cube.timeContext().catch(() => null);
      return toSemanticCatalog(catalog, {
        data_as_of: context?.dataAsOf ?? "未知",
        time_context: publicTimeContext(catalog.views, context, deps.canonical.time_sources),
      });
    },

    async dimensionValues(principal, memberId, contains) {
      const { context, views, compiler } = await model(principal);
      // 入参是语义 member id，在服务端解析成物理成员后查询候选值；响应不包含物理成员名。
      const semantic = catalogMember(compiler, memberId, "dimension");
      if (!semantic) {
        throw new InvalidRequestError(`维度 ${memberId} 不在当前目录中`);
      }
      const physical = semantic.available_in[0]?.member;
      if (!physical) {
        throw new InvalidRequestError(`维度「${semantic.title}」当前没有可以查询取值的数据来源`);
      }
      let dimension: ReturnType<typeof findSearchableDimension>;
      try {
        dimension = findSearchableDimension(views, physical);
      } catch (error) {
        throw new InvalidRequestError(error instanceof Error ? error.message : String(error));
      }
      const response = await deps.cube.load(dimensionValuesQuery(physical, contains), context);
      const raw = response.data
        .map((row) => row[physical])
        .filter((value): value is string | number => value !== null && value !== "")
        .map(String);
      const truncated =
        raw.length > DIMENSION_VALUES_CAP || response.data.length >= DIMENSION_VALUES_SCAN_LIMIT;
      return {
        dimension: memberId,
        title: dimension.displayTitle,
        values: raw.slice(0, DIMENSION_VALUES_CAP),
        ...(truncated
          ? {
              truncated: `值超过 ${DIMENSION_VALUES_CAP} 个，仅返回前 ${DIMENSION_VALUES_CAP}；用 contains 缩小范围`,
            }
          : {}),
      };
    },
  };
}
