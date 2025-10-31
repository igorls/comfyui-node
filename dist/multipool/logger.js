/**
 * Logging utility for MultiWorkflowPool
 * Provides structured logging with configurable log levels
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4
};
export class Logger {
    level;
    context;
    constructor(context, level = "info") {
        this.context = context;
        this.level = level;
    }
    setLevel(level) {
        this.level = level;
    }
    shouldLog(level) {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
    }
    formatMessage(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]`;
        return args.length > 0 ? `${prefix} ${message}` : `${prefix} ${message}`;
    }
    debug(message, ...args) {
        if (this.shouldLog("debug")) {
            console.debug(this.formatMessage("debug", message), ...args);
        }
    }
    info(message, ...args) {
        if (this.shouldLog("info")) {
            console.info(this.formatMessage("info", message), ...args);
        }
    }
    warn(message, ...args) {
        if (this.shouldLog("warn")) {
            console.warn(this.formatMessage("warn", message), ...args);
        }
    }
    error(message, ...args) {
        if (this.shouldLog("error")) {
            console.error(this.formatMessage("error", message), ...args);
        }
    }
    /**
     * Special log for queue operations (always uses timestamp format)
     */
    queue(workflowHash, message, ...args) {
        if (this.shouldLog("debug")) {
            const timestamp = new Date().toISOString();
            const hashPrefix = workflowHash.substring(0, 16);
            console.log(`[${timestamp}] [queue::${hashPrefix}] ${message}`, ...args);
        }
    }
    /**
     * Special log for client events
     */
    client(clientName, event, message, ...args) {
        if (this.shouldLog("debug")) {
            console.log(`[${event}@${clientName}] ${message}`, ...args);
        }
    }
}
/**
 * Create a logger instance for a specific context
 */
export function createLogger(context, level = "info") {
    return new Logger(context, level);
}
//# sourceMappingURL=logger.js.map