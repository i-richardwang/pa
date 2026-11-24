export const MCP_ACCESS_SCOPE = "mcp";
export const MCP_RESOURCE_PATH = "/mcp";

export function mcpResourceUrl(baseUrl: string) {
  return new URL(MCP_RESOURCE_PATH, baseUrl).href;
}
