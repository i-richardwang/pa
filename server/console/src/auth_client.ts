/** adminClient / apiKeyClient 必须与服务端的同名插件同时启用；未设置 baseURL，使用当前站点。 */
import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient(), apiKeyClient()],
});
