import React from "react";
import { Box, Text } from "ink";
import { MessageRenderer } from "./MessageRenderer.js";
import type { ChatMessage } from "./types.js";

interface ScrollAreaProps {
  messages: ChatMessage[];
  visibleMessages: ChatMessage[];
  startIdx: number;
  endIdx: number;
  totalMsgs: number;
  safeOffset: number;
  scrollbarStr: string;
  showScrollbar: boolean;
  scrollIndicator: string;
  msgAreaRows: number;
  currentAgentName?: string;
}

export function ScrollArea({
  messages,
  visibleMessages,
  startIdx,
  endIdx,
  totalMsgs,
  safeOffset,
  scrollbarStr,
  showScrollbar,
  scrollIndicator,
  msgAreaRows,
  currentAgentName = "Assistant",
}: ScrollAreaProps) {
  return (
    <Box flexDirection="row" flexGrow={1} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {/* Scroll position indicator at top */}
        {totalMsgs > 10 && (
          <Box marginY={0} paddingX={1}>
            <Text dimColor>
              {scrollIndicator}  Use ↑↓ · PgUp/Dn to scroll
            </Text>
          </Box>
        )}

        {/* Messages above indicator */}
        {safeOffset > 0 && startIdx > 0 && (
          <Box marginY={0} paddingX={1}>
            <Text color="yellow" dimColor>
              ↑ {startIdx} message{startIdx !== 1 ? "s" : ""} above — scroll
              up to see
            </Text>
          </Box>
        )}

        {/* Messages */}
        {visibleMessages.map((msg, msgIdx) => (
          <MessageRenderer
            key={`${startIdx + msgIdx}`}
            msg={msg}
            msgIdx={msgIdx}
            startIdx={startIdx}
            totalMsgs={totalMsgs}
            currentAgentName={currentAgentName}
            isLastMessage={msgIdx === visibleMessages.length - 1}
          />
        ))}

        {/* Messages below indicator */}
        {endIdx < totalMsgs && (
          <Box marginY={0} paddingX={1}>
            <Text color="yellow" dimColor>
              ↓ {totalMsgs - endIdx} message{totalMsgs - endIdx !== 1 ? "s" : ""}{" "}
              below — scroll down to see
            </Text>
          </Box>
        )}
      </Box>

      {/* Scrollbar */}
      {showScrollbar && (
        <Box width={1} flexDirection="column">
          <Text dimColor={true}>{scrollbarStr}</Text>
        </Box>
      )}
    </Box>
  );
}
