import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server.js";

export interface MCPToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MCPClient {
  tools(): MCPToolDef[];
  call(name: string, input: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function createMcpClient(): Promise<MCPClient> {
  const server = createMcpServer();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Start the server on its end
  await server.connect(serverTransport);

  // Connect the client
  const client = new Client({ name: "openpanda-client", version: "0.1.0" });
  await client.connect(clientTransport);

  // Fetch available tools
  const { tools } = await client.listTools();
  const toolDefs: MCPToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Record<string, unknown>,
  }));

  return {
    tools() {
      return toolDefs;
    },

    async call(name, input) {
      const result = await client.callTool({ name, arguments: input });
      const content = result.content as Array<{ type: string; text?: string }>;
      return content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    },

    async close() {
      await client.close();
    },
  };
}

// Singleton — shared across all agents in a process
let _mcpClient: MCPClient | null = null;

export async function getMcpClient(): Promise<MCPClient> {
  if (!_mcpClient) _mcpClient = await createMcpClient();
  return _mcpClient;
}
