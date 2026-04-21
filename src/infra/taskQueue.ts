/**
 * File-based durable task queue for Telegram messages.
 * Persists to ~/.openpanda/queue.json using atomic writes (write-then-rename).
 * Survives process crashes — drain on restart to process leftover tasks.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface QueuedTask {
  id: string;
  chatId: number;
  username?: string;
  text: string;
  traceId: string;
  enqueuedAt: string;
}

export class FileTaskQueue {
  private readonly queuePath: string;
  private readonly tmpPath: string;

  constructor(queuePath: string) {
    this.queuePath = queuePath;
    this.tmpPath = queuePath + ".tmp";
    mkdirSync(dirname(queuePath), { recursive: true });
  }

  enqueue(task: Omit<QueuedTask, "id" | "enqueuedAt">): QueuedTask {
    const full: QueuedTask = {
      ...task,
      id: randomUUID(),
      enqueuedAt: new Date().toISOString(),
    };
    const tasks = this.read();
    tasks.push(full);
    this.write(tasks);
    return full;
  }

  dequeue(): QueuedTask | null {
    const tasks = this.read();
    if (tasks.length === 0) return null;
    const [first, ...rest] = tasks;
    this.write(rest);
    return first;
  }

  remove(taskId: string): void {
    const tasks = this.read().filter((t) => t.id !== taskId);
    this.write(tasks);
  }

  list(): QueuedTask[] {
    return this.read();
  }

  size(): number {
    return this.read().length;
  }

  private read(): QueuedTask[] {
    try {
      const raw = readFileSync(this.queuePath, "utf8");
      return JSON.parse(raw) as QueuedTask[];
    } catch {
      return [];
    }
  }

  private write(tasks: QueuedTask[]): void {
    writeFileSync(this.tmpPath, JSON.stringify(tasks, null, 2), "utf8");
    renameSync(this.tmpPath, this.queuePath);
  }
}
