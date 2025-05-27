#!/bin/bash
# Real-time monitoring for nginx-proxy-watch testing
# Usage: ./monitor-test.sh [mode]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

NGINX_CONTAINER="nginx-proxy-test"
COMPOSE_FILE="docker-compose-sample.yml"

# Utility functions
print_header() {
    local title=$1
    echo -e "${PURPLE}======================================${NC}"
    echo -e "${PURPLE} $title${NC}"
    echo -e "${PURPLE}======================================${NC}"
}

print_section() {
    local title=$1
    echo -e "\n${BLUE}--- $title ---${NC}"
}

get_timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

monitor_containers() {
    print_section "Container Status"
    docker compose -f $COMPOSE_FILE ps --format table
    
    print_section "nginx-proxy-watch Health"
    if docker exec $NGINX_CONTAINER curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ nginx-proxy-watch API is responding${NC}"
        docker exec $NGINX_CONTAINER curl -s http://localhost:8080/health | jq '.' 2>/dev/null || echo "API response received"
    else
        echo -e "${RED}✗ nginx-proxy-watch API not responding${NC}"
    fi
}

monitor_nginx_config() {
    print_section "Nginx Configuration Status"
    
    if docker exec $NGINX_CONTAINER nginx -t > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Nginx configuration is valid${NC}"
    else
        echo -e "${RED}✗ Nginx configuration has errors:${NC}"
        docker exec $NGINX_CONTAINER nginx -t 2>&1 | head -3
    fi
    
    print_section "Current Upstreams"
    docker exec $NGINX_CONTAINER find /app/conf.d/upstream.conf/ -name "*.conf" -exec sh -c 'echo "=== $(basename "$1") ==="; head -10 "$1"' _ {} \; 2>/dev/null | head -30
}

monitor_logs() {
    print_section "Recent Error Logs"
    docker exec $NGINX_CONTAINER tail -10 /var/log/docker-event-watcher/error.log 2>/dev/null | while read line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ $line == *"WARN"* ]]; then
            echo -e "${YELLOW}$line${NC}"
        else
            echo "$line"
        fi
    done
    
    print_section "Recent Events"
    docker exec $NGINX_CONTAINER tail -5 /var/log/docker-event-watcher/daemon.log 2>/dev/null | while read line; do
        if [[ $line == *"start"* ]] || [[ $line == *"stop"* ]]; then
            echo -e "${GREEN}$line${NC}"
        else
            echo "$line"
        fi
    done
}

monitor_traffic() {
    print_section "Testing Service Endpoints"
    
    local endpoints=(
        "http://alpha-main.test.local/main|Main App"
        "http://alpha-main.test.local/api|API Service"
        "http://group.test.local/serviceA|Group Service A"
        "http://balance.test.local|Load Balancer"
        "http://cookie.test.local|Cookie Router"
    )
    
    for endpoint_info in "${endpoints[@]}"; do
        IFS='|' read -r url description <<< "$endpoint_info"
        echo -n "Testing $description... "
        
        if response=$(curl -s -w "%{http_code}" -m 5 "$url" 2>/dev/null); then
            status_code="${response: -3}"
            if [[ $status_code =~ ^[23] ]]; then
                echo -e "${GREEN}✓ ($status_code)${NC}"
            else
                echo -e "${RED}✗ ($status_code)${NC}"
            fi
        else
            echo -e "${RED}✗ (timeout/error)${NC}"
        fi
    done
}

monitor_resources() {
    print_section "Resource Usage"
    
    echo "Container Resource Usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" | grep -E "(nginx-proxy|app-|CONTAINER)"
}

live_monitor() {
    while true; do
        clear
        print_header "nginx-proxy-watch Live Monitor - $(get_timestamp)"
        
        monitor_containers
        monitor_nginx_config
        monitor_traffic
        monitor_resources
        
        echo -e "\n${YELLOW}Press Ctrl+C to stop monitoring${NC}"
        echo -e "${YELLOW}Refreshing in 10 seconds...${NC}"
        
        sleep 10
    done
}

log_tail() {
    print_header "Live Log Monitoring"
    echo -e "${YELLOW}Following nginx-proxy-watch logs... (Press Ctrl+C to stop)${NC}\n"
    
    # Follow multiple log files
    docker exec $NGINX_CONTAINER tail -f \
        /var/log/docker-event-watcher/daemon.log \
        /var/log/docker-event-watcher/error.log \
        /var/log/nginx/error.log 2>/dev/null | while read line; do
        
        if [[ $line =~ ^==\>.*daemon\.log.*\<== ]]; then
            echo -e "${BLUE}$line${NC}"
        elif [[ $line =~ ^==\>.*error\.log.*\<== ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ $line == *"ERROR"* ]]; then
            echo -e "${RED}$line${NC}"
        elif [[ $line == *"WARN"* ]]; then
            echo -e "${YELLOW}$line${NC}"
        elif [[ $line == *"start"* ]] || [[ $line == *"stop"* ]]; then
            echo -e "${GREEN}$line${NC}"
        else
            echo "$line"
        fi
    done
}

stress_test() {
    print_header "Stress Testing"
    
    local duration=${1:-30}
    local concurrent=${2:-5}
    
    echo -e "${YELLOW}Running stress test for $duration seconds with $concurrent concurrent requests...${NC}"
    
    # Generate background traffic
    for i in $(seq 1 $concurrent); do
        (
            local count=0
            local start_time=$(date +%s)
            while [ $(($(date +%s) - start_time)) -lt $duration ]; do
                curl -s http://alpha-main.test.local/main > /dev/null
                curl -s http://balance.test.local > /dev/null
                curl -s http://group.test.local/serviceA > /dev/null
                ((count++))
                sleep 0.1
            done
            echo "Worker $i completed $count requests"
        ) &
    done
    
    # Monitor during stress test
    local start_time=$(date +%s)
    while [ $(($(date +%s) - start_time)) -lt $duration ]; do
        clear
        print_header "Stress Test in Progress - $(get_timestamp)"
        
        monitor_containers
        monitor_resources
        
        echo -e "\n${YELLOW}Test progress: $(($(date +%s) - start_time))/$duration seconds${NC}"
        sleep 5
    done
    
    wait
    echo -e "${GREEN}Stress test completed!${NC}"
}

debug_mode() {
    print_header "Debug Information Collection"
    
    print_section "Docker Compose Services"
    docker compose -f $COMPOSE_FILE config --services
    
    print_section "nginx-proxy-watch API Status"
    docker exec $NGINX_CONTAINER curl -s http://localhost:8080/status | jq '.' 2>/dev/null || echo "API not responding"
    
    print_section "Container List"
    docker exec $NGINX_CONTAINER curl -s http://localhost:8080/containers | jq '.' 2>/dev/null || echo "API not responding"
    
    print_section "Nginx Configuration Files"
    echo "Upstream configs:"
    docker exec $NGINX_CONTAINER ls -la /app/conf.d/upstream.conf/
    echo -e "\nVhost configs:"
    docker exec $NGINX_CONTAINER ls -la /app/conf.d/vhost.conf/
    
    print_section "Log File Sizes"
    docker exec $NGINX_CONTAINER du -sh /var/log/docker-event-watcher/* /var/log/nginx/* 2>/dev/null | sort -hr
    
    print_section "Recent Configuration Changes"
    docker exec $NGINX_CONTAINER find /app/conf.d/ -name "*.conf" -mmin -10 -exec ls -la {} \;
}

# Main execution
case "${1:-help}" in
    live)
        live_monitor
        ;;
    logs)
        log_tail
        ;;
    stress)
        stress_test "${2:-30}" "${3:-5}"
        ;;
    debug)
        debug_mode
        ;;
    once)
        print_header "nginx-proxy-watch Status - $(get_timestamp)"
        monitor_containers
        monitor_nginx_config
        monitor_traffic
        monitor_logs
        ;;
    *)
        echo -e "${GREEN}nginx-proxy-watch Monitoring Tools${NC}"
        echo ""
        echo -e "${YELLOW}Usage: $0 [mode]${NC}"
        echo ""
        echo -e "${BLUE}Available modes:${NC}"
        echo "  live         - Live monitoring dashboard (refreshes every 10s)"
        echo "  logs         - Follow log files in real-time"
        echo "  stress [dur] [conc] - Stress test (duration in seconds, concurrent requests)"
        echo "  debug        - Collect debug information"
        echo "  once         - Single status check"
        echo ""
        echo -e "${YELLOW}Examples:${NC}"
        echo "  $0 live          # Start live monitoring dashboard"
        echo "  $0 logs          # Follow logs in real-time"
        echo "  $0 stress 60 10  # Stress test for 60s with 10 concurrent requests"
        echo "  $0 debug         # Collect debug information"
        ;;
esac