# PA 数据查询接入

面向 PA 用户的本地接入目录：在 Codex 或 Cursor 中用自然语言查询组织与人才数据。指标口径、
权限裁剪和查询执行均由 PA 服务负责；本目录不包含数据、模型或服务代码。

## Codex

本目录自带本地插件目录和 `pa` 插件。插件提供 MCP 接入、`pa-analytics` Skill
与交互式结果卡，不需要在 `.codex/config.toml` 中保存 API key。

首次使用时在本目录执行：

```sh
codex plugin marketplace add "$PWD"
codex plugin add pa@pa-local
codex mcp login pa
```

安装或更新后新建 Codex 任务；已经打开的任务不会热加载新版插件。

## Cursor

Cursor 使用项目内 `.cursor/mcp.json`，其中只引用环境变量，不保存凭据。向 PA 管理员申请个人
API key，在启动 Cursor 前设置：

```sh
export PA_MCP_API_KEY="<个人 API key>"
```

## 使用

确认服务已启动：

```sh
curl http://127.0.0.1:8789/healthz
```

返回 `{"ok":true}` 后直接提问即可。查询方法与字段协议由当前 `pa-analytics` Skill 和 MCP
工具 Schema 提供，本目录不复制查询教程。

## 布局

```text
.agents/plugins/marketplace.json       本地插件目录清单
plugins/pa/                            Codex Plugin 分发物
plugins/pa/.mcp.json                   无密钥 MCP 接入，认证走 OAuth
plugins/pa/skills/pa-analytics/        唯一的插件内查数方法
.cursor/mcp.json                       Cursor MCP 接入，凭据来自环境变量
```

插件、目录清单、README 与 Cursor MCP 配置均由 PA 服务仓库统一发布，不在本目录分别维护。
