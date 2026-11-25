import type { McpServer } from "@modelcontextprotocol/server";
import type { Principal } from "../contracts/principal.js";
import type { Logger } from "../ports/logger.js";

export type McpRegistrationContext = {
  server: McpServer;
  principal: Principal;
  logger: Logger;
};
