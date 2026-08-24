/** adminClient / apiKeyClient 必须与服务端同名插件成对启用；baseURL 缺省即同源当前站点。 */
import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient(), apiKeyClient()],
});
