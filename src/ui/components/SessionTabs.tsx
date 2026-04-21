import React from "react";
import { Box, Text } from "ink";

interface SessionTabsProps {
  sessionNames: string[];
  currentName: string;
}

export function SessionTabs({ sessionNames, currentName }: SessionTabsProps) {
  return (
    <Box
      paddingX={1}
      paddingY={0}
      borderStyle="single"
      borderBottom
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
    >
      {sessionNames.map((name) => (
        <Box key={name} marginRight={1}>
          <Text
            color={name === currentName ? "cyan" : "gray"}
            bold={name === currentName}
          >
            {name === currentName ? "● " : "◯ "}
            {name}
          </Text>
        </Box>
      ))}
      <Box marginLeft={2}>
        <Text dimColor>  /new · /switch · /skill · /agent · /help</Text>
      </Box>
    </Box>
  );
}
