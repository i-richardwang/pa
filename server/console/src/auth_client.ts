/**
 * Better Auth 浏览器客户端（同源，baseURL 缺省即当前站点）。
 * 内置 redirect 插件：登录响应带 {url, redirect} 时（OAuth 授权流挂起）自动跳回授权端点续流。
 * adminClient 与服务端 admin 插件配对：session.user 带 role 类型（控制台按角色渲染），
 * 并为用户管理页提供 authClient.admin.* 客户端方法。
 * apiKeyClient 与服务端 apiKey 插件配对：为 API Key 页提供 authClient.apiKey.* 自助方法。
 * 两者均同源请求自带 Origin，满足 Better Auth 的 CSRF 守卫。
 */
import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient(), apiKeyClient()],
});
