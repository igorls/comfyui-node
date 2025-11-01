#!/usr/bin/env bun
/**
 * Mock ComfyUI WebSocket Server
 *
 * This is a standalone server that can be spawned in a separate process
 * to test reconnection behavior. It simulates a basic ComfyUI server
 * with WebSocket support and HTTP endpoints.
 *
 * Usage:
 *   bun test/integration/mock-server.ts [port]
 *
 * The server will:
 * - Accept WebSocket connections
 * - Respond to HTTP GET /queue requests
 * - Send periodic status messages
 * - Can be killed to simulate server downtime
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage, ServerResponse } from "http";

const PORT = parseInt(process.argv[2] || "8188", 10);
const WS_PATH = "/ws";

// Track connected clients
const clients = new Set<WebSocket>();

// Create HTTP server
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Handle /queue endpoint
  if (req.url === "/queue" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        queue_running: [],
        queue_pending: []
      })
    );
    return;
  }

  // Handle /system_stats endpoint
  if (req.url === "/system_stats" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        system: {
          os: "mock",
          ram_total: 16000000000,
          ram_free: 8000000000
        },
        devices: []
      })
    );
    return;
  }

  // Handle /prompt (GET) - used by pollStatus/ping
  if (req.url === "/prompt" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        exec_info: {
          queue_remaining: 0
        }
      })
    );
    return;
  }

  // Handle /prompt (POST)
  if (req.url === "/prompt" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const promptId = `mock-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          prompt_id: promptId,
          number: 1,
          node_errors: {}
        })
      );

      // Simulate workflow execution after a short delay
      setTimeout(() => {
        broadcastMessage({
          type: "executing",
          data: {
            node: null,
            prompt_id: promptId
          }
        });

        setTimeout(() => {
          broadcastMessage({
            type: "executed",
            data: {
              node: "3",
              prompt_id: promptId,
              output: {
                images: [
                  {
                    filename: "mock_image.png",
                    subfolder: "",
                    type: "output"
                  }
                ]
              }
            }
          });

          setTimeout(() => {
            broadcastMessage({
              type: "execution_success",
              data: {
                prompt_id: promptId
              }
            });
          }, 100);
        }, 500);
      }, 200);
    });
    return;
  }

  // Handle /history endpoint
  if (req.url?.startsWith("/history") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({}));
    return;
  }

  // Default 404
  res.writeHead(404);
  res.end("Not Found");
});

// Create WebSocket server
const wss = new WebSocketServer({
  server: httpServer,
  path: WS_PATH
});

wss.on("connection", (ws: WebSocket) => {
  console.log(`[Mock Server] Client connected (total: ${clients.size + 1})`);
  clients.add(ws);

  // Send initial status message
  ws.send(
    JSON.stringify({
      type: "status",
      data: {
        status: {
          exec_info: {
            queue_remaining: 0
          }
        },
        sid: `mock-sid-${Date.now()}`
      }
    })
  );

  ws.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`[Mock Server] Received message:`, message);

      // Echo certain messages back
      if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (err) {
      console.error(`[Mock Server] Error parsing message:`, err);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[Mock Server] Client disconnected (remaining: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error(`[Mock Server] WebSocket error:`, err);
    clients.delete(ws);
  });
});

// Broadcast message to all connected clients
function broadcastMessage(message: any) {
  const payload = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Send periodic status updates
const statusInterval = setInterval(() => {
  if (clients.size > 0) {
    broadcastMessage({
      type: "status",
      data: {
        status: {
          exec_info: {
            queue_remaining: 0
          }
        }
      }
    });
  }
}, 5000);

// Handle graceful shutdown
const shutdown = () => {
  console.log("\n[Mock Server] Shutting down...");
  clearInterval(statusInterval);

  clients.forEach((client) => {
    client.close(1000, "Server shutting down");
  });

  wss.close(() => {
    httpServer.close(() => {
      console.log("[Mock Server] Server closed");
      process.exit(0);
    });
  });

  // Force exit after 2 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log("[Mock Server] Force exit");
    process.exit(0);
  }, 2000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start server
httpServer.listen(PORT, () => {
  console.log(`[Mock Server] HTTP server listening on http://localhost:${PORT}`);
  console.log(`[Mock Server] WebSocket server listening on ws://localhost:${PORT}${WS_PATH}`);
  console.log(`[Mock Server] Process ID: ${process.pid}`);

  // Signal to parent process that server is ready
  if (process.send) {
    process.send("ready");
  }
});

// Handle unexpected errors
process.on("uncaughtException", (err) => {
  console.error("[Mock Server] Uncaught exception:", err);
  shutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Mock Server] Unhandled rejection at:", promise, "reason:", reason);
});
