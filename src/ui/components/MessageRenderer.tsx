import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "./types.js";
import { MessageContent } from "./MessageContent.js";

interface MessageRendererProps {
  msg: ChatMessage;
  msgIdx: number;
  startIdx: number;
  totalMsgs: number;
  currentAgentName?: string;
  isLastMessage: boolean;
}

export function MessageRenderer({
  msg,
  msgIdx,
  startIdx,
  totalMsgs,
  currentAgentName = "Assistant",
  isLastMessage,
}: MessageRendererProps) {
  if (msg.role === "system") {
    return (
      <Box flexDirection="column" marginY={0} paddingX={0}>
        <Box
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor="cyan"
          paddingX={1}
          paddingY={0}
        >
          <Text color="cyan" dimColor bold>
            ℹ {msg.content}
          </Text>
        </Box>
      </Box>
    );
  }

  if (msg.role === "user") {
    return (
      <Box flexDirection="column" marginY={1} paddingX={0} width="100%">
        {/* User message header */}
        <Box marginBottom={0} paddingX={1}>
          <Text color="blue" bold>
            💬 You
          </Text>
          <Text dimColor>{` [${startIdx + msgIdx + 1}/${totalMsgs}]`}</Text>
        </Box>
        {/* User message content */}
        <Box paddingX={2} paddingY={0} width="100%">
          <Text wrap="wrap" dimColor>
            {msg.content}
          </Text>
        </Box>
        {/* Divider */}
        {!isLastMessage && (
          <Box marginTop={0} paddingX={1}>
            <Text color="gray" dimColor>
              ─
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // Assistant message
  const displayContent = msg.streaming ? msg.content.slice(-2000) : msg.content;
  return (
    <Box flexDirection="column" marginY={1} paddingX={0} width="100%">
      {/* Assistant message header */}
      <Box marginBottom={0} paddingX={1}>
        <Text color="green" bold>
          🤖 {currentAgentName.padEnd(12)}
        </Text>
        <Text dimColor>{` [${startIdx + msgIdx + 1}/${totalMsgs}]`}</Text>
        {msg.streaming && (
          <Text color="yellow" bold>
            {" ✨ streaming"}
          </Text>
        )}
      </Box>
      {/* Assistant message content */}
      <Box paddingX={2} paddingY={0} width="100%">
        <Box flexGrow={1} flexDirection="column">
          <MessageContent content={displayContent} streaming={msg.streaming} />
        </Box>
      </Box>
      {/* Divider */}
      {!isLastMessage && (
        <Box marginTop={0} paddingX={1}>
          <Text color="gray" dimColor>
            ─
          </Text>
        </Box>
      )}
    </Box>
  );
}
