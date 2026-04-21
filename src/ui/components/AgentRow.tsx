import React from "react";
import { Box, Text } from "ink";
import type { AgentState, AgentStatus } from "../../core/types.js";

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "gray",
  running: "yellow",
  completed: "green",
  failed: "red",
  stopped: "magenta",
};

interface Props {
  agent: AgentState;
  selected: boolean;
}

export function AgentRow({ agent, selected }: Props) {
  const color = STATUS_COLOR[agent.status];
  return (
    <Box>
      <Text color={selected ? "cyan" : undefined} bold={selected}>
        {selected ? "▶ " : "  "}
      </Text>
      <Text bold>{agent.config.name.padEnd(20)}</Text>
      <Text color={color}>{agent.status.padEnd(12)}</Text>
      <Text dimColor>{agent.config.id.slice(0, 8)}</Text>
      <Text dimColor>  {agent.messages.length} msgs</Text>
    </Box>
  );
}
