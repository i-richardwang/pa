import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Principal } from "../contracts/principal.js";

export type McpRegistrationContext = {
  server: McpServer;
  principal: Principal;
};
