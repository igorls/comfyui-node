/**
 * Logging utility for MultiWorkflowPool
 * Provides structured logging with configurable log levels
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
export declare class Logger {
    private level;
    private context;
    constructor(context: string, level?: LogLevel);
    setLevel(level: LogLevel): void;
    private shouldLog;
    private formatMessage;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    /**
     * Special log for queue operations (always uses timestamp format)
     */
    queue(workflowHash: string, message: string, ...args: any[]): void;
    /**
     * Special log for client events
     */
    client(clientName: string, event: string, message: string, ...args: any[]): void;
}
/**
 * Create a logger instance for a specific context
 */
export declare function createLogger(context: string, level?: LogLevel): Logger;
//# sourceMappingURL=logger.d.ts.map