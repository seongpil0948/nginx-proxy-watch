#!/bin/bash
# Container test scenarios for nginx-proxy-watch
# Usage: ./test-scenarios.sh [scenario]
#
# 이 스크립트는 nginx-proxy-watch의 다양한 시나리오를 테스트합니다:
# - 컨테이너 재시작, 스케일링, 헬스체크, 네트워크 파티션 등
# - Docker 이벤트 기반 nginx 설정 자동 업데이트 검증
# - 로드밸런싱, 쿠키 라우팅, HTTPS API 등 기능 테스트

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
    # 테스트 목적: 컨테이너 재시작 시 nginx-proxy-watch가 이벤트를 감지하고
    # nginx 설정을 자동으로 업데이트하여 서비스 중단 없이 동작하는지 검증
    
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
    # 테스트 목적: 동일 서비스의 인스턴스를 스케일링할 때
    # nginx upstream 설정이 자동으로 업데이트되고 로드밸런싱이 동작하는지 검증
    # 주의: app-balance-1과 app-balance-2는 별개 서비스이므로 scale 명령은 app-balance-2만 영향
    
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
    # 테스트 목적: 컨테이너의 헬스체크가 실패할 때
    # nginx-proxy-watch가 이를 감지하고 트래픽 라우팅을 조정하는지 검증
    # 현재는 헬스체크 실패 시에도 계속 라우팅됨 (향후 개선 필요)
    
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
    # 테스트 목적: 컨테이너 중지/시작 시 nginx 설정이 자동으로 업데이트되는지 검증
    # 쿠키 기반 라우팅에서 특정 서비스가 중지되면 기본 upstream으로 폴백되는지 확인
    # VIRTUAL_DEFAULT_UPSTREAM=pharmacy.internal 설정으로 pharmacy가 기본값
    
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
    # 테스트 목적: 네트워크 파티션 상황을 시뮬레이션하여
    # 컨테이너가 일시적으로 접근 불가능할 때의 동작을 검증
    # pause 명령으로 컨테이너를 일시 정지시켜 네트워크 단절 효과를 만듦
    # 예상 결과: 504 Gateway Timeout 발생
    
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
    # 로그 파일은 날짜별로 로테이션됨 (error-YYYY-MM-DD.log)
    docker exec $NGINX_CONTAINER tail -20 /var/log/docker-event-watcher/error-$(date +%Y-%m-%d).log || \
        echo "No error logs found for today"
    
    log "INFO" "Recent nginx configuration changes..."
    docker exec $NGINX_CONTAINER ls -lt /app/conf.d/upstream.conf/ | head -5
}

scenario_api_https_test() {
    log "INFO" "=== API HTTPS Test ==="
    # 테스트 목적: nginx-proxy-watch API 서버의 HTTP/HTTPS 엔드포인트 동작 검증
    # API는 시스템 상태, 컨테이너 정보, 헬스체크 등을 제공
    # HTTPS는 *.shop.co.kr 인증서를 사용하며, Status 000은 인증서 미설치 문제
    
    log "INFO" "Testing API endpoints (HTTP and HTTPS)..."
    
    # Test HTTP API
    log "INFO" "Testing HTTP API health endpoint..."
    test_endpoint "http://localhost:18080/health" "API HTTP health check"
    
    # Test HTTPS API
    log "INFO" "Testing HTTPS API health endpoint..."
    test_endpoint "https://localhost:18443/health" "API HTTPS health check (with -k for self-signed cert)"
    curl -k -s -w "Status: %{http_code}\n" "https://localhost:18443/health" | head -5
    echo ""
    
    # Test API endpoints
    log "INFO" "Testing API containers endpoint..."
    echo -e "${BLUE}HTTP containers list:${NC}"
    curl -s http://localhost:18080/containers | jq '.count'
    
    echo -e "${BLUE}HTTPS containers list:${NC}"
    curl -k -s https://localhost:18443/containers | jq '.count'
    
    # Test API status endpoint
    log "INFO" "Testing API status endpoint..."
    curl -s http://localhost:18080/status | jq '.status'
    
    # Test nginx config validation
    log "INFO" "Testing nginx config validation..."
    curl -s http://localhost:18080/nginx-config | jq '.valid'
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
    scenario_api_https_test
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
    api-https)
        scenario_api_https_test
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
        echo "  api-https    - Test API HTTP/HTTPS endpoints"
        echo "  all          - Run all scenarios"
        echo ""
        echo -e "${YELLOW}Examples:${NC}"
        echo "  $0 restart   # Test container restart scenarios"
        echo "  $0 scale     # Test load balancer scaling"
        echo "  $0 api-https # Test API HTTPS functionality"
        echo "  $0 all       # Run comprehensive test suite"
        ;;
esac