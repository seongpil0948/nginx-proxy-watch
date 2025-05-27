# Nginx Proxy Watch - Enhanced Testing Environment

This enhanced testing environment provides comprehensive tools for testing `nginx-proxy-watch` functionality including container lifecycle management, load balancing, health checks, and failure scenarios.

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- curl and jq (for testing)
- openssl (for SSL certificate generation)

### Start Test Environment

```bash
# Basic startup
./example/ignite-example.sh

# With monitoring dashboard
./example/ignite-example.sh --with-monitoring

# Quick test run (skip hosts file check)
./example/ignite-example.sh --run-tests --skip-hosts

# See all options
./example/ignite-example.sh --help
```

## 🧪 Testing Features

### Test Scenarios

Run comprehensive test scenarios to validate nginx-proxy-watch behavior:

```bash
# Run all test scenarios
./example/test-scenarios.sh all

# Individual scenarios
./example/test-scenarios.sh restart        # Container restart testing
./example/test-scenarios.sh scale          # Container scaling testing
./example/test-scenarios.sh health         # Health check failure/recovery
./example/test-scenarios.sh stop-start     # Container stop/start testing
./example/test-scenarios.sh network        # Network partition simulation
./example/test-scenarios.sh chaos          # Chaos engineering tests
```

### Real-time Monitoring

Monitor nginx-proxy-watch performance and behavior:

```bash
# Live monitoring dashboard
./example/monitor-test.sh live

# Follow logs in real-time
./example/monitor-test.sh logs

# Stress testing (30 seconds, 5 concurrent requests)
./example/monitor-test.sh stress 30 5

# Collect debug information
./example/monitor-test.sh debug

# Single status check
./example/monitor-test.sh once
```

## 🏗️ Test Architecture

### Service Categories

1. **Main Services** - Primary application endpoints
   - `app-main`: Load-balanced main application
   - `nginx-proxy`: The nginx-proxy-watch service itself

2. **Group Host Services** - Multiple services under one domain
   - `app-api`: API service under alpha-main.test.local/api
   - `app-admin`: Admin service under alpha-main.test.local/admin
   - `app-group-service-a/b`: Services under group.test.local

3. **Load Balancing** - Multiple instances of same service
   - `app-balance-1/2`: Load-balanced instances

4. **Cookie Routing** - Dynamic routing based on cookies
   - `app-cookie-hospital`: Target for mall_type=1
   - `app-cookie-pharmacy`: Target for mall_type=2 (default)

5. **Multi-path Services** - Complex routing scenarios
   - `app-multipath-root`: Root service
   - `app-path1-5`: Path-specific services

6. **Test Utilities**
   - `app-failure-sim`: Failure simulation service
   - `otel-collector`: OpenTelemetry metrics collection

### Health Check Integration

All services include:
- Kubernetes-style health checks
- Failure simulation endpoints (`/fail-health`, `/restore-health`)
- Resource usage monitoring
- Automatic restart policies

## 🔧 Environment Variables

### nginx-proxy-watch Configuration

```bash
# Core settings
REQUIRED_SERVERS=alpha-main.test.local,balance.test.local
LOG_LEVEL=debug
API_PORT=8080

# Test environment
TEST_MODE=true
HEALTH_CHECK_INTERVAL=5
```

### Service Configuration Examples

#### Basic Service
```yaml
environment:
  - VIRTUAL_HOST=example.com
  - VIRTUAL_PORT=8080
  - PORT=8080
```

#### Group Host Service
```yaml
environment:
  - VIRTUAL_GROUP_HOST=main.example.com
  - VIRTUAL_HOST=api.internal
  - VIRTUAL_LOCATION_PATH=api
  - VIRTUAL_PORT=8081
```

#### Cookie Routing
```yaml
environment:
  - VIRTUAL_HOST=cookie.example.com
  - VIRTUAL_COOKIE_NAME=service_type
  - VIRTUAL_ROUTING_MAP=1:service-a,2:service-b
  - VIRTUAL_DEFAULT_UPSTREAM=service-b
```

## 🧭 Test Scenarios Guide

### 1. Container Lifecycle Testing

**Restart Testing**
```bash
./example/test-scenarios.sh restart
```
- Restarts containers and verifies configuration reload
- Tests nginx upstream reconfiguration
- Validates service continuity

**Scaling Testing**
```bash
./example/test-scenarios.sh scale
```
- Scales services up and down
- Tests load balancer reconfiguration
- Verifies traffic distribution

### 2. Health Check Testing

**Health Failure Simulation**
```bash
./example/test-scenarios.sh health
```
- Simulates service health failures
- Tests automatic failover behavior
- Verifies health restoration

**Manual Health Control**
```bash
# Make service unhealthy
curl http://alpha-main.test.local/main/fail-health

# Restore health
curl http://alpha-main.test.local/main/restore-health
```

### 3. Network Partition Testing

**Network Simulation**
```bash
./example/test-scenarios.sh network
```
- Simulates network partitions using container pause/unpause
- Tests service isolation and recovery
- Validates error handling

### 4. Chaos Engineering

**Chaos Testing**
```bash
./example/test-scenarios.sh chaos
```
- Randomly restarts multiple services
- Tests system resilience under stress
- Validates configuration consistency

## 📊 API Endpoints

### nginx-proxy-watch API (Port 18080)

```bash
# Overall health status
curl http://localhost:18080/health

# Detailed status
curl http://localhost:18080/status

# Container list
curl http://localhost:18080/containers

# Service health checks
curl http://localhost:18080/services/health

# Required servers status
curl http://localhost:18080/required-servers

# Nginx configuration validation
curl http://localhost:18080/nginx-config
```

### Service Health Endpoints

Each service provides:
```bash
# Health check
curl http://[service-url]/health

# Force unhealthy state
curl http://[service-url]/fail-health

# Restore healthy state
curl http://[service-url]/restore-health
```

## 🔍 Debugging and Troubleshooting

### Common Issues

**1. Services not responding**
```bash
# Check container status
docker compose -f example/docker-compose-sample.yml ps

# Check nginx configuration
docker exec nginx-proxy-test nginx -t

# Check upstream configurations
docker exec nginx-proxy-test ls -la /app/conf.d/upstream.conf/
```

**2. Configuration errors**
```bash
# View nginx-proxy logs
docker logs nginx-proxy-test

# Check watcher logs
docker exec nginx-proxy-test tail -f /var/log/docker-event-watcher/error.log

# Debug information
./example/monitor-test.sh debug
```

**3. Network connectivity issues**
```bash
# Test from inside nginx container
docker exec nginx-proxy-test curl http://app-main:8080/main/health

# Check container networking
docker network inspect example_test-network
```

### Log Locations

```bash
# nginx-proxy-watch logs
/var/log/docker-event-watcher/daemon.log    # Main application logs
/var/log/docker-event-watcher/error.log     # Error logs
/var/log/docker-event-watcher/debug.log     # Debug logs

# Nginx logs
/var/log/nginx/access.log                   # Access logs
/var/log/nginx/error.log                    # Nginx error logs
/var/log/nginx/[service]/access-was.log     # Service-specific logs
```

## 🎯 Performance Testing

### Load Testing

```bash
# Basic load test
./example/monitor-test.sh stress 60 10

# Custom load test
for i in {1..100}; do
  curl -s http://balance.test.local > /dev/null &
done
wait
```

### Monitoring During Tests

```bash
# Live monitoring
./example/monitor-test.sh live

# Resource usage
docker stats

# Configuration changes
watch -n 2 'docker exec nginx-proxy-test find /app/conf.d/ -name "*.conf" -mmin -1'
```

## 🧹 Cleanup

### Graceful Shutdown
```bash
# Stop services
docker compose -f example/docker-compose-sample.yml down

# Full cleanup with volumes
docker compose -f example/docker-compose-sample.yml down -v --remove-orphans

# Remove test images
docker image prune -f
```

### Reset Environment
```bash
# Remove all containers and start fresh
docker compose -f example/docker-compose-sample.yml down -v --remove-orphans
./example/ignite-example.sh --skip-hosts
```

## 🤝 Contributing Test Cases

### Adding New Test Scenarios

1. **Create test service** in docker-compose-sample.yml
2. **Add scenario function** to test-scenarios.sh
3. **Include monitoring** in monitor-test.sh
4. **Document** in this README

### Test Case Template

```bash
scenario_new_test() {
    log "INFO" "=== New Test Scenario ==="
    
    # Setup phase
    log "INFO" "Setting up test conditions..."
    
    # Action phase
    log "INFO" "Executing test actions..."
    
    # Verification phase
    log "INFO" "Verifying results..."
    test_endpoint "http://test.local" "Test description"
    
    # Cleanup phase
    log "INFO" "Cleaning up..."
}
```

This enhanced testing environment provides comprehensive validation of nginx-proxy-watch functionality across various real-world scenarios.