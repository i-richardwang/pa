# PA 仓库约定

PA 是人员分析语义服务。公开仓库以产品核心为主线，默认使用 `demo/` 中完全虚构的语义包；企业字段映射、口径、术语、评测和部署配置只能存在于外部私有适配仓库或制品中。

## 架构硬约束

- Cube Core 单容器、DuckDB 直读 parquet；不使用 Cube Store、预聚合或原始事实 join。
- 一张物理宽事实只承载自己的数据。跨事实指标由正式指标图拆成单事实查询腿，聚合后对齐和重算。
- MCP adapter 只做协议映射；不开放 SQL，不接受临时指标定义，不承担业务编排。
- `server/src/engine/metric_model.ts` 只实现正式指标合同与装配算法；具体指标图来自版本化语义包。
- 语义包是纯声明目录，入口为 `semantic_package.yml`，不能执行代码，路径不能逃逸包根目录。
- 应用核心不得导入私有包。部署通过 `PA_SEMANTIC_PACKAGE_DIR` 选择一个包，Cube 与服务必须读取同一目录。
- `$PA_SEMANTIC_DATA_DIR/current` 中的 parquet 只读挂载；生成器按版本写入并原子切换 `current`。
- 权限由 Cube access policy 裁剪；正式指标仅在所有组件可见时暴露。

## 技术栈

- 服务与前端：TypeScript；Bun 管理依赖和开发工具，生产运行时以 Node 为基线。
- 数据脚本：Python + PEP 723 inline 依赖，通过 `uv run` 执行，不创建仓库内 venv。
- 文件、目录、模型成员和代码标识符使用 ASCII snake_case。界面标题、说明和文档正文可以使用中文。

## 内容边界

- `README.md`：产品说明、快速开始、接入和目录。
- `AGENTS.md`：仓库约束、命令和开发纪律。
- `description`：用户可见、自含的业务含义与统计口径；不出现源字段、文件路径或实现机制。
- `meta.ai_context`：只写成员选择、查询方式和避坑动作。
- `docs/`：当前设计规格。
- `demo/`：可公开的虚构模型与数据生成器，不得复刻内部字段全集或真实值域。

## 语义模型规则

- 所有公开 view、measure、dimension 必须有标准 `title` 和自含 `description`。
- 所有公开 measure 必须声明 `time_contract`；percent 指标公开可查组件。
- 每个公开叶子指标声明已登记的 `metric_domain_id`；执行 View 和明细 View 不声明域身份。
- 每个公开维度声明已登记的 `dimension_group`；跨事实同名成员必须同义且合同一致。
- 每个时间来源由恰好一个指标执行 View 通过 `time_anchor_measure` 声明时钟锚点。
- 可下钻指标通过 `meta.underlying_records` 指向记录集；明细 View 通过 `meta.record_sets` 声明字段、实体键和稳定排序。
- 目录装配遇到重复来源、未知分类、循环依赖、缺失锚点或不一致合同必须 fail-closed。

## 前端

- 色值单源为 `server/src/presentation_core/tokens.css` 与 `design_tokens.ts`，契约测试锁定一致性。
- 形态判据单源为 `docs/ui_spec.md`。改色只改令牌源；改形先更新规格再改代码。
- 组件不得自定义色值。同一语义只保留一种实现和一层容器。
- effect 的依赖只放原始值或稳定引用；随渲染现造的值走 ref，进依赖数组即成渲染死循环。
- 前端用例只跑到静态渲染与纯函数，effect 与事件不在其中：改动交互层须在真实浏览器里验收。

## 常用命令

```sh
uv run demo/generate_demo_data.py
docker compose up -d --build
cd server && bun run check
```

较快定位：

```sh
cd server
bun run typecheck
bun test
bun run build
bun run generate:data-capability-map
```

对着运行中的栈做实链验证与运维（均在 `server/` 下）：

| 命令 | 作用 |
| --- | --- |
| `bun run smoke` | 以 MCP 客户端走通公开 Demo 的目录、候选值、分析与 App 资源 |
| `bun run smoke:oauth` | OAuth 动态注册、PKCE 授权、持 token 查数与报告生命周期全流程 |
| `bun run eval:formal` | 对语义包登记的全部正式指标执行 Planner 与真实 Cube 冒烟 |
| `bun run eval:time` | 公开 Demo 正式指标的时间语义真实 Cube 回归 |
| `bun run eval:access` | Cube access_policy 实链：组映射、组织范围与正式指标可见性 |
| `bun run eval:records` | 正式指标规划与受控记录投影实链 |
| `bun run user:create -- <email> <password>` | 本机开通用户，可附 `--admin`、`--data-scope=…`、`--with-key` |
| `bun run key:issue -- <email>` | 无头签发 API Key，明文只打印一次 |
| `bun run clean` | 清空三个构建产物目录 |

修改 Demo 或语义包合同时，必须运行包加载、模型暴露和能力地图测试。提交前运行开源边界扫描。

## 纪律

- 不修改或复制用户的本地数据。
- 不提交 `.env`、密钥、数据库、parquet、真实查询结果或未经审核的截图。
- 不把企业源表名、字段映射、排除口径、真实组织、内部职级映射、术语和评测题写进公共核心、测试或 Demo。
- 私有适配发现核心缺能力时，先把通用扩展点上游到公共核心，再在私有包中消费；不得在内部长期复制核心实现。
- 文档、注释及变更后清理按 [代码与仓库内容质量标准](docs/code_quality_standard.md) 执行；每次复核完整 diff 及其受影响引用。
