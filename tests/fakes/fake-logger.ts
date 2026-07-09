import type { Logger } from "../../src/ports/index.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
}

/** A `Logger` that records every call for assertions instead of printing. */
export class FakeLogger implements Logger {
  readonly entries: LogEntry[] = [];

  debug(message: string, meta?: Record<string, unknown>): void {
    this.record("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.record("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.record("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.record("error", message, meta);
  }

  /** Messages recorded at `level` (or all levels when omitted). */
  messages(level?: LogLevel): string[] {
    return this.entries
      .filter((entry) => level === undefined || entry.level === level)
      .map((entry) => entry.message);
  }

  private record(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    this.entries.push(meta === undefined ? { level, message } : { level, message, meta });
  }
}
