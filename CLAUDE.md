# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

nginx-proxy-watch is a Docker container monitoring service that automatically generates Nginx reverse proxy configurations based on running containers. It watches Docker events and dynamically updates Nginx configurations when containers start/stop.

## Essential Commands

### Development
```bash
# Build and run the TypeScript service
npm run dev

# Build Docker image
make build

# Get shell access to the running container
make shell
```

### Testing Environment
```bash
# Initial setup (run once)
make setup
make setup-hosts  # Requires sudo to add test domains to /etc/hosts

# Start/stop test environment
make start        # Basic start
make start-full   # With OpenTelemetry monitoring
make start-quick  # Quick start with basic tests
make stop
make restart

# Run tests
make test         # All test scenarios
make test-restart # Container restart tests
make test-scale   # Scaling tests
make test-health  # Health check tests
make test-network # Network partition tests
make test-chaos   # Chaos engineering tests

# Monitoring
make monitor      # Live dashboard
make monitor-logs # Follow logs in real-time
make logs         # Show logs
make status       # Current status
```

### Debugging
```bash
# Check Nginx configuration
make config-test
make config-show
make config-reload

# Debug information
make debug

# Access specific test app
make shell-app APP=main
```

## Architecture

### Core Flow
1. **Docker Event Listener** (`src/index.ts`) subscribes to container events
2. **Event Handler** (`src/event-handler.ts`) processes start/stop/die events
3. **Container Config Parser** (`src/util/container-config.ts`) extracts `VIRTUAL_*` environment variables
4. **Template Engine** generates Nginx configs using EJS templates in `/templates/`
5. **API Server** (`src/api-server.ts`) provides health checks on port 8080 (HTTP) and 8443 (HTTPS)

### Key Environment Variables for nginx-proxy-watch Service
- `API_PORT`: HTTP API server port (default: 8080)
- `API_HTTPS_ENABLED`: Enable HTTPS API server (default: true)
- `API_HTTPS_PORT`: HTTPS API server port (default: 8443)
- `API_HTTPS_CERT_PATH`: Path to SSL certificate file (default: /dist/certs/shop.co.kr_crt.pem)
- `API_HTTPS_KEY_PATH`: Path to SSL private key file (default: /dist/certs/shop.co.kr_key.pem)
- `REQUIRED_SERVERS`: Comma-separated list of critical server names that must be available

### Key Environment Variables for Containers
- `VIRTUAL_HOST`: Domain name for the service
- `VIRTUAL_PORT`: Internal container port (default: 80)
- `VIRTUAL_SSL`/`VIRTUAL_CERT`: SSL certificate configuration
- `VIRTUAL_LOCATION_PATH`: Path-based routing
- `VIRTUAL_GROUP_HOST`: Group multiple services under one host
- `VIRTUAL_COOKIE_*`: Cookie-based routing configuration

### State Management
- In-memory state maintained in `src/state.ts`
- Tracks all managed containers and their configurations
- Automatically removes unhealthy containers from upstream

### Health Monitoring
- Enhanced container health checks with Docker health status integration
- Periodic health checks for all containers
- Automatic removal of unhealthy containers from Nginx upstream
- Required servers monitoring ensures critical services are always available
- API endpoints for monitoring at `/health` and `/containers`

### Advanced Features

#### Network Validation (`src/util/make.ts`)
- Validates IP addresses and ports before generating configurations
- Filters out invalid network entries automatically
- Prevents broken upstream configurations

#### Cookie-Based Routing
- Template selection based on routing requirements
- Supports complex routing maps with cookie values
- Automatic template fallback for missing configurations

#### Container Health Status
- Checks Docker's native health check results
- Monitors container restart counts
- Tracks health check failing streaks
- Detailed health logging with timestamps

## Testing Approach

The project includes comprehensive test infrastructure in the `example/` directory:
- Multiple test applications demonstrating different routing scenarios
- Test scripts (`test-scenarios.sh`) for various failure modes
- Monitoring tools (`monitor-test.sh`) for real-time observation
- OpenTelemetry integration for distributed tracing
- Chaos engineering tests for resilience validation

## Project Structure

```
nginx-proxy-watch/
├── project/               # TypeScript source code
│   ├── src/
│   │   ├── api-server.ts  # HTTP/HTTPS API server
│   │   ├── health-checker.ts # Enhanced health monitoring
│   │   ├── util/
│   │   │   ├── make.ts    # Nginx config generation with validation
│   │   │   └── ...
│   │   └── ...
│   ├── dist/             # Compiled JavaScript
│   └── package.json
├── templates/            # EJS templates for Nginx configs
├── example/              # Test environment and sample apps
├── conf/                 # Base Nginx configuration
└── Makefile             # Development commands
```

## Important Notes

- All logs are in Korean - the project was developed for a Korean team
- The Makefile is the primary development interface - check `make help` for all commands
- Docker socket must be mounted for the service to work (`/var/run/docker.sock`)
- Nginx configurations are generated in `/etc/nginx/conf.d/`
- The service automatically reconnects if Docker daemon becomes unavailable
- Network validation ensures only valid IP:PORT combinations are used in upstream configs
- Cookie routing templates are automatically selected when cookie-based routing is configured