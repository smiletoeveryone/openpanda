import React from "react";
import { Box, Text } from "ink";
import type { AgentState } from "../../core/types.js";

interface Props {
  agent: AgentState;
}

export function AgentDetail({ agent }: Props) {
  const lastMessages = agent.messages.slice(-6);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold color="cyan">
        {agent.config.name} — {agent.config.id}
      </Text>
      <Text dimColor>Model: {agent.config.model}</Text>
      {agent.config.systemPrompt && (
        <Text dimColor>System: {agent.config.systemPrompt.slice(0, 60)}…</Text>
      )}
      <Box marginTop={1} flexDirection="column">
        {lastMessages.length === 0 ? (
          <Text dimColor>No messages yet.</Text>
        ) : (
          lastMessages.map((m, i) => (
            <Box key={i} marginBottom={1}>
              <Text color={m.role === "user" ? "blue" : "green"} bold>
                {m.role === "user" ? "You: " : "AI:  "}
              </Text>
              <Text wrap="wrap">{m.content.slice(0, 200)}</Text>
            </Box>
          ))
        )}
      </Box>
      {agent.error && <Text color="red">Error: {agent.error}</Text>}
    </Box>
  );
}
