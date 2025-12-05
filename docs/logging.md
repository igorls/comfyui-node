# Event-Based Logging System

As of version 1.6.7, `comfyui-node` uses a structured event-based logging system instead of direct console output. This allows for better integration with your application's existing logging infrastructure and provides more control over log verbosity and handling.

## Overview

The `MultiWorkflowPool`, `JobQueueProcessor`, and `ClientRegistry` classes now emit log events through the `PoolEventManager`. You can consume these events to implement custom logging logic, stream logs to a service, or simply print them to the console with your preferred formatting.

## Log Event Types

The system uses the following log levels as event types:

- `debug`: Detailed information for debugging purposes.
- `info`: General operational events (e.g., client connections, job updates).
- `warn`: Warning conditions that don't stop execution but require attention.
- `error`: Error conditions that may affect operation.

## Listening to Logs

You can attach event listeners to the `MultiWorkflowPool` to capture log events.

### Basic Example: Console Logging

To replicate the previous behavior (logging to console), you can attach a simple listener for each level:

```typescript
import { MultiWorkflowPool } from 'comfyui-node';

const pool = new MultiWorkflowPool();

// Attach listeners for log events
pool.attachEventHook('debug', (event) => console.debug(`[DEBUG] ${event.payload}`));
pool.attachEventHook('info', (event) => console.log(`[INFO] ${event.payload}`));
pool.attachEventHook('warn', (event) => console.warn(`[WARN] ${event.payload}`));
pool.attachEventHook('error', (event) => console.error(`[ERROR]`, event.payload));

await pool.init();
```

### Advanced Example: Custom Logger Integration

If you use a logging library like `winston` or `pino`, you can forward events to it:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console()],
});

pool.attachEventHook('debug', (event) => logger.debug(event.payload));
pool.attachEventHook('info', (event) => logger.info(event.payload));
pool.attachEventHook('warn', (event) => logger.warn(event.payload));
pool.attachEventHook('error', (event) => logger.error(event.payload));
```

## Client Events

In addition to system logs, the pool also forwards events from ComfyUI clients with the `client:` prefix. These can also be useful for logging execution progress:

- `client:status`
- `client:progress`
- `client:execution_success`
- `client:error`

Example:

```typescript
pool.attachEventHook('client:execution_success', (event) => {
  console.log(`Job finished on client ${event.payload.clientName}`);
});
```

## Payload Structure

- **String Payloads**: Most `debug` and `info` events have a simple string payload.
- **Object Payloads**: `error` events typically contain an object with `message` and `error` properties.

```typescript
// Error event payload structure
interface ErrorPayload {
  message: string;
  error: any;
}
```
