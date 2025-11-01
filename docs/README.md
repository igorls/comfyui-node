# ComfyUI Node Documentation

Welcome to the ComfyUI Node client library documentation.

## Quick Start

- [Getting Started](./getting-started.md) - Installation and basic usage
- [Workflow Guide](./workflow-guide.md) - Creating and running workflows

## Core Features

### Workflow Pool
- [Workflow Pool](./workflow-pool.md) - Managing multiple ComfyUI clients
- [Queue Optimization](./queue-optimization.md) - Job queuing and scheduling
- [Hash-Based Routing](./hash-routing-guide.md) - Route workflows based on structure hash
- [Hash Routing Architecture](./hash-routing-architecture.md) - Technical details
- [Hash Routing Quick Start](./hash-routing-quickstart.sh) - Shell script for testing

### Timeouts & Performance
- [Execution Timeout](./execution-timeout.md) - Configuring execution timeouts
- [Profiling](./profiling.md) - Performance profiling and optimization
- [Multipool Profiling](./multipool-profiling.md) - Profiling multiple pools

## Testing

- [Testing Guide](./testing.md) - How to run and write tests
- [Reconnection Tests](./reconnection-tests.md) - Integration test infrastructure

## Guides

- [Migration Guide](./migration-guide.md) - Upgrading between versions
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
- [WebSocket Idle Issue](./websocket-idle-issue.md) - Handling WebSocket connection issues

## Additional Resources

- [Demo Package](./demo-package.md) - Example package for testing
- [Main README](../README.md) - Project overview
- [Changelog](../CHANGELOG.md) - Version history

## Project Structure

```
comfyui-node/
├── src/              # Source code
├── test/             # Unit tests
├── test/integration/ # Integration tests
├── docs/             # Documentation (you are here)
├── demos/            # Example code
└── scripts/          # Build and utility scripts
```

## Need Help?

- [GitHub Issues](https://github.com/igorls/comfyui-node/issues)
- [Troubleshooting Guide](./troubleshooting.md)