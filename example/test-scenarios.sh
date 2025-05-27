#!/bin/bash
# Container test scenarios for nginx-proxy-watch
# Usage: ./test-scenarios.sh [scenario]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
NC='\033[0m'

COMPOSE_FILE="example/docker-compose-sample.yml"
NGINX_CONTAINER="nginx-proxy-test"

# Utility functions
log() {
    local level=$1
    local message=$2
    echo -e "${GREEN}[$level]${NC} $message"
}

wait_for_nginx_reload() {
    echo -e "${YELLOW}Waiting for nginx configuration to reload...${NC}"
    sleep 3
}

check_nginx_config() {
    echo -e "${BLUE}Checking nginx configuration...${NC}"
    docker exec $NGINX_CONTAINER nginx -t
}

show_nginx_upstreams() {
    echo -e "${BLUE}Current upstream configurations:${NC}"
    docker exec $NGINX_CONTAINER find /app/conf.d/upstream.conf/ -name "*.conf" -exec basename {} \; | sort
}

show_container_status() {
    echo -e "${BLUE}Container status:${NC}"
    docker compose -f $COMPOSE_FILE ps
}

test_endpoint() {
    local url=$1
    local description=$2
    echo -e "${YELLOW}Testing: $description${NC}"
    echo -e "${BLUE}URL: $url${NC}"
    curl -s -w "Status: %{http_code}\n" "$url" | head -5
    echo ""
}

# Test scenarios
scenario_restart_containers() {
    log "INFO" "=== Container Restart Test ==="
    
    log "INFO" "Current container status:"
    show_container_status
    
    log "INFO" "Restarting app-main containers..."
    docker compose -f $COMPOSE_FILE restart app-main
    
    wait_for_nginx_reload
    check_nginx_config
    show_nginx_upstreams
    
    log "INFO" "Testing endpoints after restart..."
    test_endpoint "http://alpha-main.test.local/main" "Main app after restart"
}

scenario_scale_containers() {
    log "INFO" "=== Container Scaling Test ==="
    
    log "INFO" "Scaling app-balance to 4 instances..."
    docker compose -f $COMPOSE_FILE up -d --scale app-balance-2=4
    
    wait_for_nginx_reload
    check_nginx_config
    show_nginx_upstreams
    
    log "INFO" "Testing load balancing with 4 instances..."
    for i in {1..8}; do
        echo -e "${YELLOW}Request $i:${NC}"
        curl -s http://balance.test.local | grep -E "(Instance|Server Information)" | head -2
        sleep 0.5
    done
    
    log "INFO" "Scaling back to 2 instances..."
    docker compose -f $COMPOSE_FILE up -d --scale app-balance-2=2
    
    wait_for_nginx_reload
}

scenario_health_check_failure() {
    log "INFO" "=== Health Check Failure Test ==="
    
    log "INFO" "Making app-main unhealthy..."
    curl -s http://alpha-main.test.local/main/fail-health
    
    log "INFO" "Waiting for health check to detect failure..."
    sleep 10
    
    log "INFO" "Testing endpoint during health failure..."
    test_endpoint "http://alpha-main.test.local/main" "Main app during health failure"
    
    log "INFO" "Restoring app-main health..."
    curl -s http://alpha-main.test.local/main/restore-health
    
    wait_for_nginx_reload
    log "INFO" "Testing endpoint after health restoration..."
    test_endpoint "http://alpha-main.test.local/main" "Main app after health restoration"
}

scenario_container_stop_start() {
    log "INFO" "=== Container Stop/Start Test ==="
    
    log "INFO" "Stopping app-cookie-hospital..."
    docker compose -f $COMPOSE_FILE stop app-cookie-hospital
    
    wait_for_nginx_reload
    check_nginx_config
    show_nginx_upstreams
    
    log "INFO" "Testing cookie routing with hospital stopped..."
    test_endpoint "http://cookie.test.local" "Cookie routing with hospital stopped (should use pharmacy)"
    
    log "INFO" "Starting app-cookie-hospital..."
    docker compose -f $COMPOSE_FILE start app-cookie-hospital
    
    wait_for_nginx_reload
    check_nginx_config
    
    log "INFO" "Testing cookie routing with hospital restored..."
    test_endpoint "http://cookie.test.local" "Cookie routing with hospital restored"
}

scenario_network_partition() {
    log "INFO" "=== Network Partition Simulation ==="
    
    log "INFO" "Creating network partition by pausing app-api..."
    docker compose -f $COMPOSE_FILE pause app-api
    
    wait_for_nginx_reload
    
    log "INFO" "Testing API endpoint during partition..."
    test_endpoint "http://alpha-main.test.local/api" "API during network partition"
    
    log "INFO" "Restoring network by unpausing app-api..."
    docker compose -f $COMPOSE_FILE unpause app-api
    
    wait_for_nginx_reload
    
    log "INFO" "Testing API endpoint after restoration..."
    test_endpoint "http://alpha-main.test.local/api" "API after network restoration"
}

scenario_full_service_restart() {
    log "INFO" "=== Full Service Restart Test ==="
    
    log "INFO" "Restarting nginx-proxy container..."
    docker compose -f $COMPOSE_FILE restart nginx-proxy
    
    log "INFO" "Waiting for nginx-proxy to fully start..."
    sleep 10
    
    check_nginx_config
    show_nginx_upstreams
    
    log "INFO" "Testing all endpoints after nginx restart..."
    test_endpoint "http://alpha-main.test.local/main" "Main app"
    test_endpoint "http://alpha-main.test.local/api" "API service"
    test_endpoint "http://group.test.local/serviceA" "Group service A"
    test_endpoint "http://balance.test.local" "Load balanced service"
}

scenario_chaos_test() {
    log "INFO" "=== Chaos Engineering Test ==="
    
    # Randomly restart some containers
    local containers=("app-main" "app-api" "app-admin" "app-balance-1")
    
    for container in "${containers[@]}"; do
        log "INFO" "Chaos: Restarting $container..."
        docker compose -f $COMPOSE_FILE restart $container &
        sleep 2
    done
    
    wait
    wait_for_nginx_reload
    
    log "INFO" "Testing system stability after chaos..."
    for i in {1..5}; do
        echo -e "${YELLOW}Stability test $i/5:${NC}"
        test_endpoint "http://alpha-main.test.local/main" "Main app"
        test_endpoint "http://alpha-main.test.local/api" "API service"
        sleep 1
    done
    
    check_nginx_config
}

scenario_monitor_logs() {
    log "INFO" "=== Log Monitoring Test ==="
    
    log "INFO" "Starting log monitoring (30 seconds)..."
    log "INFO" "Watch nginx-proxy logs in another terminal: docker logs -f nginx-proxy-test"
    
    # Generate some traffic
    for i in {1..10}; do
        curl -s http://alpha-main.test.local/main > /dev/null &
        curl -s http://balance.test.local > /dev/null &
        curl -s http://group.test.local/serviceA > /dev/null &
        sleep 3
    done
    
    wait
    
    log "INFO" "Checking error logs..."
    docker exec $NGINX_CONTAINER tail -20 /var/log/docker-event-watcher/error.log
    
    log "INFO" "Recent nginx configuration changes..."
    docker exec $NGINX_CONTAINER ls -lt /app/conf.d/upstream.conf/ | head -5
}

scenario_all() {
    log "INFO" "=== Running All Test Scenarios ==="
    
    scenario_restart_containers
    echo ""
    scenario_scale_containers
    echo ""
    scenario_health_check_failure
    echo ""
    scenario_container_stop_start
    echo ""
    scenario_network_partition
    echo ""
    scenario_monitor_logs
    
    log "INFO" "=== All scenarios completed ==="
}

# Main execution
case "${1:-help}" in
    restart)
        scenario_restart_containers
        ;;
    scale)
        scenario_scale_containers
        ;;
    health)
        scenario_health_check_failure
        ;;
    stop-start)
        scenario_container_stop_start
        ;;
    network)
        scenario_network_partition
        ;;
    nginx-restart)
        scenario_full_service_restart
        ;;
    chaos)
        scenario_chaos_test
        ;;
    monitor)
        scenario_monitor_logs
        ;;
    all)
        scenario_all
        ;;
    *)
        echo -e "${GREEN}nginx-proxy-watch Test Scenarios${NC}"
        echo ""
        echo -e "${YELLOW}Usage: $0 [scenario]${NC}"
        echo ""
        echo -e "${BLUE}Available scenarios:${NC}"
        echo "  restart      - Test container restart"
        echo "  scale        - Test container scaling"
        echo "  health       - Test health check failure/recovery"
        echo "  stop-start   - Test container stop/start"
        echo "  network      - Test network partition simulation"
        echo "  nginx-restart- Test nginx-proxy restart"
        echo "  chaos        - Chaos engineering test"
        echo "  monitor      - Monitor logs and traffic"
        echo "  all          - Run all scenarios"
        echo ""
        echo -e "${YELLOW}Examples:${NC}"
        echo "  $0 restart   # Test container restart scenarios"
        echo "  $0 scale     # Test load balancer scaling"
        echo "  $0 all       # Run comprehensive test suite"
        ;;
esac