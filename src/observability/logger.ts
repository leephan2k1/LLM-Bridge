export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class HubLogger {
  private currentLevel: LogLevel;

  constructor(level: LogLevel = "info") {
    this.currentLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.currentLevel];
  }

  private format(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
    });
  }

  debug(message: string, context?: Record<string, unknown>) {
    if (this.shouldLog("debug")) {
      process.stderr.write(this.format("debug", message, context) + "\n");
    }
  }

  info(message: string, context?: Record<string, unknown>) {
    if (this.shouldLog("info")) {
      process.stderr.write(this.format("info", message, context) + "\n");
    }
  }

  warn(message: string, context?: Record<string, unknown>) {
    if (this.shouldLog("warn")) {
      process.stderr.write(this.format("warn", message, context) + "\n");
    }
  }

  error(message: string, context?: Record<string, unknown>) {
    if (this.shouldLog("error")) {
      process.stderr.write(this.format("error", message, context) + "\n");
    }
  }
}

export const logger = new HubLogger(
  (process.env.HUB_LOG_LEVEL as LogLevel) || "info"
);
