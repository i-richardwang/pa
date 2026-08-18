import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Principal } from "../engine/cube_security.js";

export type McpRegistrationContext = {
  server: McpServer;
  principal: Principal;
};
