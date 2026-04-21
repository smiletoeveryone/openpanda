import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { AgentRow } from "./AgentRow.js";
import { AgentDetail } from "./AgentDetail.js";
import type { OpenClaw } from "../../core/manager.js";
import type { AgentState } from "../../core/types.js";

type View = "list" | "detail";

interface Props {
  manager: OpenClaw;
}

export function App({ manager }: Props) {
  const { exit } = useApp();
  const [agents, setAgents] = useState<AgentState[]>(() => manager.list());
  const [cursor, setCursor] = useState(0);
  const [view, setView] = useState<View>("list");

  const refresh = useCallback(() => setAgents(manager.list()), [manager]);

  useEffect(() => {
    const interval = setInterval(refresh, 500);
    manager.on("event", refresh);
    manager.on("agent:spawned", refresh);
    manager.on("agent:removed", refresh);
    return () => {
      clearInterval(interval);
      manager.off("event", refresh);
      manager.off("agent:spawned", refresh);
      manager.off("agent:removed", refresh);
    };
  }, [manager, refresh]);

  useInput((input, key) => {
    if (input === "q") {
      manager.stopAll();
      exit();
      return;
    }

    if (view === "list") {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(agents.length - 1, c + 1));
      if (key.return && agents[cursor]) setView("detail");
      if (input === "s" && agents[cursor]) {
        manager.stop(agents[cursor].config.id);
        refresh();
      }
      if (input === "d" && agents[cursor]) {
        manager.remove(agents[cursor].config.id);
        setCursor((c) => Math.max(0, c - 1));
        refresh();
      }
    } else {
      if (key.escape || input === "b") setView("list");
    }
  });

  const selected = agents[cursor];

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        ◆ OpenPanda — Agent Manager (OpenClaw)
      </Text>
      <Text dimColor>
        {view === "list"
          ? "↑/↓ navigate  enter=detail  s=stop  d=remove  q=quit"
          : "esc/b=back  q=quit"}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {view === "list" ? (
          agents.length === 0 ? (
            <Text dimColor>No agents running. Use CLI: openpanda spawn -n myagent "prompt"</Text>
          ) : (
            agents.map((a, i) => (
              <AgentRow key={a.config.id} agent={a} selected={i === cursor} />
            ))
          )
        ) : selected ? (
          <AgentDetail agent={selected} />
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Running: {manager.runningCount()} / {manager.config.maxConcurrentAgents}
        </Text>
      </Box>
    </Box>
  );
}
