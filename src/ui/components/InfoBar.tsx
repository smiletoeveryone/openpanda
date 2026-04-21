import React from "react";
import { Box, Text } from "ink";
import type { Session } from "./types.js";

const CTX_WINDOW: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
};

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "gpt-4o": { input: 5, output: 15 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function fmtCost(cost: number): string {
  if (cost < 0.001) return `<$0.001`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface InfoBarProps {
  session: Session;
}

export function InfoBar({ session }: InfoBarProps) {
  const ctxMax = CTX_WINDOW[session.model ?? ""] ?? 128_000;
  const ctxUsed = session.tokenUsage.inputTokens ?? 0;
  const ctxPct = Math.min(100, Math.round((ctxUsed / ctxMax) * 100));
  const ctxColor = ctxPct > 80 ? "red" : ctxPct > 60 ? "yellow" : "gray";

  return (
    <Box
      paddingX={1}
      paddingY={0}
      borderStyle="single"
      borderTop
      borderBottom
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
      justifyContent="space-between"
    >
      <Box>
        <Text dimColor bold>
          {session.provider}
        </Text>
        <Text dimColor> / </Text>
        <Text dimColor>
          {session.model
            .replace("claude-", "")
            .replace("gpt-4o", "gpt")
            .replace(/-.*/g, "")}
        </Text>
        {session.systemPrompt && (
          <Box marginLeft={2}>
            <Text dimColor italic>
              📋 {session.systemPrompt.slice(0, 25)}…
            </Text>
          </Box>
        )}
      </Box>
      <Box>
        {session.tokenUsage.inputTokens > 0 && (
          <Box marginRight={2}>
            <Text dimColor>
              📊{" "}
              {fmtTokens(
                session.tokenUsage.inputTokens +
                  session.tokenUsage.outputTokens
              )}{" "}
              tok
            </Text>
            <Text dimColor> · </Text>
            <Text dimColor>{fmtCost(session.tokenUsage.totalCost)}</Text>
          </Box>
        )}
        <Text color={ctxColor} bold>
          {ctxPct > 80 ? "🔴" : ctxPct > 60 ? "🟡" : "🟢"} ctx {ctxPct}%
        </Text>
      </Box>
    </Box>
  );
}
