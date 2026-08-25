# PA 数据查询接入

面向 PA 用户的轻量消费目录：Pi 等支持 Agent Skills 的 coding agent 从本目录加载查询方法，
并通过消费方自己的 MCP 配置连接 PA 服务。本目录不包含数据、模型、服务代码或 Codex Plugin。

## Pi

- `.agents/skills/pa-analytics/` 是查询流程、时间口径和业务护栏。
- `.mcp.json` 是本机维护的 PA MCP 连接；同步 Skill 时不会覆盖它。
- MCP 工具的 input/output schema 是参数和返回字段的权威契约；Skill 不复制基础 API 文档。

更新后新建会话，让 agent 重新扫描 Skill。确认服务可达后即可直接用自然语言提问。

```sh
curl http://127.0.0.1:8789/healthz
```

## 布局

```text
.agents/skills/pa-analytics/    PA 查询方法与业务护栏
.mcp.json                      Pi 使用的 PA MCP 连接（消费方维护）
```

Skill 由 PA 服务仓库的 `plugins/pa/skills/pa-analytics/` 统一发布，不在本目录单独修改。
