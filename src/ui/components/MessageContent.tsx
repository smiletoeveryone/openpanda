import React from "react";
import { Box, Text } from "ink";
import { parseSegments, lineColor } from "../highlight.js";

export function MessageContent({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const segments = parseSegments(content);
  return (
    <Box flexDirection="column" width="100%">
      {segments.map((seg, si) => {
        if (seg.type === "text") {
          return (
            <Box key={si} paddingY={0} width="100%">
              <Text wrap="wrap">
                {seg.content}
                {streaming && si === segments.length - 1 ? (
                  <Text color="yellow">▋</Text>
                ) : null}
              </Text>
            </Box>
          );
        }
        // Code block — with better styling
        const lines = seg.content.split("\n");
        const langLabel =
          seg.lang && seg.lang !== "text" ? seg.lang : "code";
        return (
          <Box
            key={si}
            flexDirection="column"
            marginY={1}
            width="100%"
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            paddingY={0}
          >
            {/* Language badge */}
            <Box paddingTop={0} paddingBottom={0} marginBottom={0}>
              <Text color="gray" bold>{`╭─ ${langLabel} `}</Text>
            </Box>
            {/* Code lines */}
            <Box flexDirection="column" paddingLeft={1} paddingRight={0}>
              {lines.map((line, li) => {
                const color = lineColor(line);
                return (
                  <Box key={li} width="100%">
                    <Text color={color} wrap="wrap">
                      {line || " "}
                    </Text>
                  </Box>
                );
              })}
            </Box>
            {/* Bottom border */}
            <Box paddingTop={0} marginTop={0}>
              <Text color="gray" bold>
                ╰
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
