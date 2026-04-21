import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenClaw } from "./manager.js";
import type { AppConfig } from "../config/store.js";

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn() },
  })),
}));

const testConfig: AppConfig = {
  providers: { anthropic: { apiKey: "test-key", enabled: true } },
  defaultProvider: "anthropic",
  defaultModel: "claude-sonnet-4-6",
};

describe("OpenClaw", () => {
  let manager: OpenClaw;

  beforeEach(() => {
    manager = new OpenClaw(testConfig);
  });

  it("spawns an agent with defaults", async () => {
    const agent = await manager.spawn({ name: "test-agent" });
    expect(agent.name).toBe("test-agent");
    expect(agent.status).toBe("idle");
  });

  it("lists spawned agents", async () => {
    await manager.spawn({ name: "a1" });
    await manager.spawn({ name: "a2" });
    expect(manager.list()).toHaveLength(2);
  });

  it("removes an agent by id", async () => {
    const agent = await manager.spawn({ name: "removable" });
    expect(manager.remove(agent.id)).toBe(true);
    expect(manager.list()).toHaveLength(0);
  });

  it("returns false when removing unknown id", () => {
    expect(manager.remove("no-such-id")).toBe(false);
  });
});
