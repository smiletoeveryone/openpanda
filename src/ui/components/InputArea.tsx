import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputAreaProps {
  input: string;
  inputLines: string[];
  isStreaming: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
}

export function InputArea({
  input,
  inputLines,
  isStreaming,
  onInputChange,
  onSubmit,
  placeholder,
}: InputAreaProps) {
  return (
    <>
      {/* Multiline buffer display */}
      {inputLines.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginY={0} paddingY={0}>
          {inputLines.map((line, i) => (
            <Box key={i} paddingX={1} marginY={0} paddingY={0}>
              <Text color="cyan" bold>
                {i === 0 ? "✎ " : "  "}
              </Text>
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Input */}
      <Box paddingX={1} paddingY={0}>
        {isStreaming ? (
          <Box flexDirection="row">
            <Text color="yellow" bold>
              ⏳{" "}
            </Text>
            <Text dimColor>streaming… (Esc to abort)</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan" bold>
              {inputLines.length > 0 ? "  " : "❯ "}
            </Text>
            <TextInput
              value={input}
              onChange={onInputChange}
              onSubmit={onSubmit}
              placeholder={placeholder}
            />
          </Box>
        )}
      </Box>
    </>
  );
}
