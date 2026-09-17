# Truxify Backend API Documentation

Welcome to the Truxify Backend API documentation. This directory contains detailed documentation for all backend services, endpoints, and utilities.

## Services
- [Weigh Station Service](./weigh-station-service.md) - Documentation for WIM bypass and weight sync mocking.
- [Audio Validation](./audio-validation.md) - Magic-byte inspection for Voice AI uploads.
- [Escrow Webhooks](./escrow-webhooks.md) - Payment release and refund webhook processing.

## Examples
Executable examples for service integrations can be found in the [`examples/`](./examples/) directory.

## Contributing
When adding a new service, please create a corresponding `.md` file in this directory following the structure of `weigh-station-service.md`, including:
1. A clear warning if the service is a mock.
2. Parameter tables.
3. Response shape examples.
4. At least one usage example in the `examples/` folder.
