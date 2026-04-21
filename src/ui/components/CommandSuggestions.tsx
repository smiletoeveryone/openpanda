import React from "react";
import { Box, Text } from "ink";
import type { SlashCommand } from "../commands.js";

const CAT_COLOR: Record<SlashCommand["category"], string> = {
  session: "cyan",
  agent: "yellow",
  skill: "magenta",
  util: "gray",
};

interface CommandSuggestionsProps {
  suggestions: SlashCommand[];
  suggestionIdx: number;
}

export function CommandSuggestions({
  suggestions,
  suggestionIdx,
}: CommandSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor="gray"
      marginX={1}
      marginY={0}
    >
      <Text bold dimColor>
        Available commands:
      </Text>
      {suggestions.slice(0, 6).map((s, i) => (
        <Box key={s.name} marginY={0}>
          <Text
            color={i === suggestionIdx ? CAT_COLOR[s.category] : "gray"}
            bold={i === suggestionIdx}
          >
            {i === suggestionIdx ? "▶ " : "  "}
            <Text color={CAT_COLOR[s.category]}>
              {"/" + s.name.padEnd(12)}
            </Text>
          </Text>
          <Text dimColor>{s.description}</Text>
        </Box>
      ))}
      <Box marginTop={0}>
        <Text dimColor>  ↑↓ navigate · Tab complete · Esc dismiss</Text>
      </Box>
    </Box>
  );
}
