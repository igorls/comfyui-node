/**
 * Logging utility for MultiWorkflowPool
 * Provides structured logging with configurable log levels
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};

export class Logger {
  private level: LogLevel;
  private context: string;

  constructor(context: string, level: LogLevel = "info") {
    this.context = context;
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]`;
    return args.length > 0 ? `${prefix} ${message}` : `${prefix} ${message}`;
  }

  debug(message: string, ...args: any[]) {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message), ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message), ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message), ...args);
    }
  }

  error(message: string, ...args: any[]) {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message), ...args);
    }
  }

  /**
   * Special log for queue operations (always uses timestamp format)
   */
  queue(workflowHash: string, message: string, ...args: any[]) {
    if (this.shouldLog("debug")) {
      const timestamp = new Date().toISOString();
      const hashPrefix = workflowHash.substring(0, 16);
      console.log(`[${timestamp}] [queue::${hashPrefix}] ${message}`, ...args);
    }
  }

  /**
   * Special log for client events
   */
  client(clientName: string, event: string, message: string, ...args: any[]) {
    if (this.shouldLog("debug")) {
      console.log(`[${event}@${clientName}] ${message}`, ...args);
    }
  }
}

/**
 * Create a logger instance for a specific context
 */
export function createLogger(context: string, level: LogLevel = "info"): Logger {
  return new Logger(context, level);
}
