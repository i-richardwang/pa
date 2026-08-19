/** 权限裁剪后的指标目录、检索和名录值查询服务。 */
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
import { normalizeCatalogInput, type CatalogToolInput } from "../engine/catalog_spec.js";
import type { CubeGateway } from "../ports/cube_gateway.js";
import { cubeSecurityContext } from "../engine/cube_security.js";
import type { Principal } from "../contracts/principal.js";
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
import type { BusinessTermService } from "./business_term_service.js";
import type { CubeSecurityContext, TimeContext } from "../ports/cube_gateway.js";
import { InvalidRequestError, UnavailableError } from "./errors.js";

export class CatalogInputError extends InvalidRequestError {}

/**
 * 用户入口只暴露稳定的可恢复状态；完整模型装配诊断保留在 cause 与服务端日志中。
 * 这道边界覆盖 MCP、控制台与所有复用 CatalogService 的应用服务。
 */
export class SemanticModelUnavailableError extends UnavailableError {
  constructor(cause: unknown) {
    super("数据模型暂时不可用，请稍后重试", cause);
    this.name = "SemanticModelUnavailableError";
  }
}

export type CatalogQueryPayload = {
  default_population_scope: string;
  data_as_of: string;
  time_context: ReturnType<typeof publicTimeContext>;
  term_knowledge_status: "available" | "unavailable";
  term_resolutions: BusinessTermResolution[];
  ambiguous_terms: string[];
} & CatalogQueryResult;

export type AuthorizedSemanticContext = Pick<AuthorizedSemanticModel, "views" | "compiler"> & {
  principal: Principal;
  cubeContext: CubeSecurityContext;
  timeContext: TimeContext;
};

export type CatalogService = {
  query(principal: Principal, input: CatalogToolInput): Promise<CatalogQueryPayload>;
  context(principal: Principal): Promise<AuthorizedSemanticContext>;
  publicDocument(principal: Principal): Promise<PublicCatalogDocument>;
  dimensionValues(
    principal: Principal,
    member: string,
    contains?: string,
  ): Promise<CatalogDimensionValues>;
};

/**
 * 业务术语在应用层与模型目录汇合：目录文档和编译器目录始终不承载运行时术语，
 * 可选相关成员只扩大本次发现结果，不改变查询编译与执行。
 */
export function createCatalogService(deps: {
  cube: Pick<CubeGateway, "meta" | "load" | "timeContext">;
  canonical: CanonicalSemanticModel;
  businessTerms?: Pick<BusinessTermService, "resolve">;
}): CatalogService {
  const model = async (principal: Principal) => {
    // 授权错误本身是可行动的用户信息，不属于模型故障，须在诊断遮罩之外抛出。
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
      timeContext,
    };
  };

  return {
    async query(principal, rawInput) {
      const input = normalizeCatalogInput(rawInput);
      const catalog = await document(principal);
      const context = await deps.cube.timeContext().catch(() => null);
      const shared = {
        default_population_scope: catalog.default_population_scope,
        data_as_of: context?.dataAsOf ?? "未知",
        time_context: publicTimeContext(catalog.views, context),
      };
      if (input.mode === "overview") {
        return {
          ...shared,
          ...browseCatalogDocument(catalog),
          term_knowledge_status: deps.businessTerms
            ? ("available" as const)
            : ("unavailable" as const),
          term_resolutions: [],
          ambiguous_terms: [],
        };
      }
      const visible = toSemanticCatalog(catalog);
      const members = [...visible.measures, ...visible.dimensions];
      let termKnowledgeStatus: "available" | "unavailable" = deps.businessTerms
        ? "available"
        : "unavailable";
      let resolutions: BusinessTermResolution[] = [];
      if (deps.businessTerms) {
        try {
          resolutions = await deps.businessTerms.resolve(input.terms, members);
        } catch (error) {
          termKnowledgeStatus = "unavailable";
          console.error("[pa] 业务术语读取失败，本次目录不带术语解释:", error);
        }
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
        time_context: publicTimeContext(catalog.views, context),
      });
    },

    async dimensionValues(principal, memberId, contains) {
      const { context, views, compiler } = await model(principal);
      // 入参只接受语义 member id；服务端解析成物理绑定后翻值，物理成员名从不上线。
      const semantic = catalogMember(compiler, memberId, "dimension");
      if (!semantic) {
        throw new CatalogInputError(`维度 ${memberId} 不在当前目录中`);
      }
      const physical = semantic.available_in[0]?.member;
      if (!physical) {
        throw new CatalogInputError(`维度「${semantic.title}」当前没有可翻值的数据来源`);
      }
      let dimension: ReturnType<typeof findSearchableDimension>;
      try {
        dimension = findSearchableDimension(views, physical);
      } catch (error) {
        throw new CatalogInputError(error instanceof Error ? error.message : String(error));
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
