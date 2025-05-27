# nginx-proxy-watch Testing Makefile

# Configuration
COMPOSE_FILE := example/docker-compose-sample.yml
NGINX_CONTAINER := nginx-proxy-test
TEST_SCRIPTS_DIR := example

# Colors for output
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
BLUE := \033[34m
RESET := \033[0m

.PHONY: help setup start stop restart clean test monitor logs debug

# Default target
help: ## Show this help message
	@echo "$(BLUE)nginx-proxy-watch Testing Commands$(RESET)"
	@echo "=================================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(YELLOW)%-20s$(RESET) %s\n", $$1, $$2}'

# Environment Setup
setup: ## Setup test environment and dependencies
	@echo "$(GREEN)Setting up test environment...$(RESET)"
	@mkdir -p example/nginx-proxy/local_certs
	@mkdir -p example/nginx-proxy/local_logs/{nginx,watcher}
	@mkdir -p example/otel/signal-data/logs
	@cp $(TEST_SCRIPTS_DIR)/.env.test example/nginx-proxy/.env 2>/dev/null || true
	@chmod +x $(TEST_SCRIPTS_DIR)/*.sh 2>/dev/null || true
	@echo "$(GREEN)✓ Environment setup complete$(RESET)"

setup-hosts: ## Add test domains to hosts file (requires sudo)
	@echo "$(YELLOW)Adding test domains to hosts file...$(RESET)"
	@echo "127.0.0.1 alpha-main.test.local group.test.local cookie.test.local secure.test.local balance.test.local multipath.test.local failure.test.local" | sudo tee -a /etc/hosts
	@echo "$(GREEN)✓ Hosts file updated$(RESET)"

# Environment Management
start: ## Start the test environment
	@echo "$(GREEN)Starting test environment...$(RESET)"
	@./$(TEST_SCRIPTS_DIR)/ignite-example.sh --skip-hosts

start-full: ## Start test environment with monitoring
	@echo "$(GREEN)Starting test environment with monitoring...$(RESET)"
	@./$(TEST_SCRIPTS_DIR)/ignite-example.sh --with-monitoring

start-quick: ## Quick start with basic tests
	@echo "$(GREEN)Quick starting test environment...$(RESET)"
	@./$(TEST_SCRIPTS_DIR)/ignite-example.sh --run-tests --skip-hosts

stop: ## Stop the test environment
	@echo "$(YELLOW)Stopping test environment...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) down
	@echo "$(GREEN)✓ Environment stopped$(RESET)"

restart: ## Restart the test environment
	@echo "$(YELLOW)Restarting test environment...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) restart
	@echo "$(GREEN)✓ Environment restarted$(RESET)"

clean: ## Clean up environment and remove all containers/volumes
	@echo "$(RED)Cleaning up test environment...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
	@docker system prune -f
	@echo "$(GREEN)✓ Cleanup complete$(RESET)"

# Testing Operations
test: ## Run all test scenarios
	@echo "$(BLUE)Running all test scenarios...$(RESET)"
	@./$(TEST_SCRIPTS_DIR)/test-scenarios.sh all

test-restart: ## Test container restart scenarios
	@./$(TEST_SCRIPTS_DIR)/test-scenarios.sh restart

test-scale: ## Test container scaling scenarios
	@./$(TEST_SCRIPTS_DIR)/test-scenarios.sh scale

test-health: ## Test health check scenarios
	@./$(TEST_SCRIPTS_DIR)/test-scenarios.sh health

test-network: ## Test network partition scenarios
	@./$(TEST_SCRIPTS_DIR)/test-scenarios.sh network

test-chaos: ## Run chaos engineering tests
	@./$(TEST_SCRIPTS_DIR)/test-scenarios.sh chaos

# Monitoring and Debugging
monitor: ## Start live monitoring dashboard
	@./$(TEST_SCRIPTS_DIR)/monitor-test.sh live

monitor-logs: ## Follow logs in real-time
	@./$(TEST_SCRIPTS_DIR)/monitor-test.sh logs

status: ## Show current status
	@echo "$(BLUE)Current Environment Status$(RESET)"
	@echo "=========================="
	@docker compose -f $(COMPOSE_FILE) ps
	@echo ""
	@echo "$(BLUE)nginx-proxy-watch Health:$(RESET)"
	@docker exec $(NGINX_CONTAINER) curl -s http://localhost:8080/health 2>/dev/null | jq '.' || echo "API not responding"

logs: ## Show recent logs
	@echo "$(BLUE)Recent nginx-proxy-watch logs:$(RESET)"
	@docker logs --tail 20 $(NGINX_CONTAINER)

debug: ## Collect debug information
	@./$(TEST_SCRIPTS_DIR)/monitor-test.sh debug

# Development Operations
build: ## Build nginx-proxy-watch image
	@echo "$(GREEN)Building nginx-proxy-watch...$(RESET)"
	@docker build -t nginx-proxy-watch .

build-examples: ## Build example applications
	@echo "$(GREEN)Building example applications...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) build

shell: ## Get shell access to nginx-proxy container
	@docker exec -it $(NGINX_CONTAINER) /bin/bash

shell-app: ## Get shell access to a test app (specify APP=app-name)
	@docker exec -it $(or $(APP),app-main) /bin/sh

# Configuration Management
config-test: ## Test nginx configuration
	@echo "$(BLUE)Testing nginx configuration...$(RESET)"
	@docker exec $(NGINX_CONTAINER) nginx -t

config-show: ## Show current nginx upstreams
	@echo "$(BLUE)Current upstream configurations:$(RESET)"
	@docker exec $(NGINX_CONTAINER) find /app/conf.d/upstream.conf/ -name "*.conf" -exec echo "=== {} ===" \; -exec cat {} \;

config-reload: ## Reload nginx configuration
	@echo "$(YELLOW)Reloading nginx configuration...$(RESET)"
	@docker exec $(NGINX_CONTAINER) nginx -s reload
	@echo "$(GREEN)✓ Configuration reloaded$(RESET)"

# Load Testing
stress: ## Run stress test (default: 30 seconds, 5 concurrent)
	@./$(TEST_SCRIPTS_DIR)/monitor-test.sh stress 30 5

stress-heavy: ## Run heavy stress test (60 seconds, 10 concurrent)
	@./$(TEST_SCRIPTS_DIR)/monitor-test.sh stress 60 10

# Utility Operations
endpoints: ## Test all endpoints
	@echo "$(BLUE)Testing all endpoints...$(RESET)"
	@echo "Main App:        $$(curl -s -w '%{http_code}' http://alpha-main.test.local/main -o /dev/null)"
	@echo "API Service:     $$(curl -s -w '%{http_code}' http://alpha-main.test.local/api -o /dev/null)"
	@echo "Admin Service:   $$(curl -s -w '%{http_code}' http://alpha-main.test.local/admin -o /dev/null)"
	@echo "Group Service A: $$(curl -s -w '%{http_code}' http://group.test.local/serviceA -o /dev/null)"
	@echo "Load Balancer:   $$(curl -s -w '%{http_code}' http://balance.test.local -o /dev/null)"
	@echo "Cookie Router:   $$(curl -s -w '%{http_code}' http://cookie.test.local -o /dev/null)"

scale-up: ## Scale up load balancer instances
	@echo "$(GREEN)Scaling up load balancer...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) up -d --scale app-balance-2=4

scale-down: ## Scale down load balancer instances
	@echo "$(YELLOW)Scaling down load balancer...$(RESET)"
	@docker compose -f $(COMPOSE_FILE) up -d --scale app-balance-2=1

# Health Management
health-fail: ## Make main app unhealthy
	@echo "$(RED)Making main app unhealthy...$(RESET)"
	@curl -s http://alpha-main.test.local/main/fail-health

health-restore: ## Restore main app health
	@echo "$(GREEN)Restoring main app health...$(RESET)"
	@curl -s http://alpha-main.test.local/main/restore-health

# Information
info: ## Show environment information
	@echo "$(BLUE)nginx-proxy-watch Test Environment Information$(RESET)"
	@echo "=============================================="
	@echo "Compose File: $(COMPOSE_FILE)"
	@echo "Nginx Container: $(NGINX_CONTAINER)"
	@echo "Test Scripts: $(TEST_SCRIPTS_DIR)/"
	@echo ""
	@echo "$(BLUE)Available Services:$(RESET)"
	@docker compose -f $(COMPOSE_FILE) config --services | sort
	@echo ""
	@echo "$(BLUE)Port Mappings:$(RESET)"
	@echo "HTTP:           80  -> nginx-proxy"
	@echo "HTTPS:          443 -> nginx-proxy"
	@echo "API:            18080 -> nginx-proxy-watch API"
	@echo "OpenTelemetry:  13133 -> health check"
	@echo ""
	@echo "$(BLUE)Test URLs:$(RESET)"
	@echo "http://alpha-main.test.local/main"
	@echo "http://group.test.local/serviceA"
	@echo "http://balance.test.local"
	@echo "http://cookie.test.local"

# Quick commands
up: start ## Alias for start
down: stop ## Alias for stop
ps: status ## Alias for status