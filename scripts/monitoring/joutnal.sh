#!/bin/bash
# Docker 컨테이너 및 systemd 서비스 모니터링 스크립트
# 사용법: ./journalctl-docker-monitor.sh [service_name]

SERVICE=${1:-docker-event-watcher}  # 기본값은 docker-event-watcher

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# systemd 서비스 상태 확인
check_service_status() {
  local service=$1
  echo -e "${GREEN}===== $service 서비스 상태 =====${NC}"
  systemctl status $service || echo -e "${RED}$service 서비스가 없거나 실행 중이 아닙니다${NC}"
  echo ""
}

# systemd 서비스 로그 확인
check_service_logs() {
  local service=$1
  local lines=${2:-100}
  
  echo -e "${GREEN}===== $service journalctl 로그 (최근 $lines 줄) =====${NC}"
  journalctl -u $service -n $lines || echo -e "${RED}$service 로그를 가져올 수 없습니다${NC}"
  echo ""
}

# Docker 컨테이너 상태 확인
check_docker_status() {
  local container=${1:-nginx-proxy-watch}
  
  echo -e "${GREEN}===== $container 컨테이너 상태 =====${NC}"
  docker ps -f name=$container || echo -e "${RED}Docker 서비스가 실행 중이 아닙니다${NC}"
  echo ""
  
  if docker ps -f name=$container | grep -q $container; then
    echo -e "${GREEN}===== $container 컨테이너 상세 정보 =====${NC}"
    docker inspect $container --format='{{.State.Status}}: {{.State.Health.Status}}' || echo -e "${RED}컨테이너 정보를 가져올 수 없습니다${NC}"
    echo ""
  fi
}

# Docker 컨테이너 로그 확인
check_docker_logs() {
  local container=${1:-nginx-proxy-watch}
  local lines=${2:-100}
  
  if docker ps -f name=$container | grep -q $container; then
    echo -e "${GREEN}===== $container 컨테이너 로그 (최근 $lines 줄) =====${NC}"
    docker logs --tail $lines $container || echo -e "${RED}컨테이너 로그를 가져올 수 없습니다${NC}"
    echo ""
  else
    echo -e "${RED}$container 컨테이너가 실행 중이 아닙니다${NC}"
  fi
}

# 실시간 로그 모니터링
live_monitor() {
  local service=$1
  local type=$2
  
  echo -e "${GREEN}$service $type 실시간 모니터링을 시작합니다. 중단하려면 Ctrl+C를 누르세요.${NC}"
  
  case $type in
    systemd)
      journalctl -u $service -f
      ;;
    docker)
      docker logs -f $service
      ;;
    *)
      echo -e "${RED}알 수 없는 모니터링 유형: $type${NC}"
      exit 1
      ;;
  esac
}

# 메인 실행부
case $SERVICE in
  docker-event-watcher)
    check_service_status $SERVICE
    check_service_logs $SERVICE
    ;;
  nginx-proxy-watch)
    check_docker_status $SERVICE
    check_docker_logs $SERVICE
    ;;
  otel-collector)
    check_docker_status $SERVICE
    check_docker_logs $SERVICE
    ;;
  docker-live)
    live_monitor "nginx-proxy-watch" "docker"
    ;;
  watcher-live)
    live_monitor "docker-event-watcher" "systemd"
    ;;
  otel-live)
    live_monitor "otel-collector" "docker"
    ;;
  all)
    check_service_status "docker-event-watcher"
    check_service_logs "docker-event-watcher"
    check_docker_status "nginx-proxy-watch"
    check_docker_logs "nginx-proxy-watch"
    check_docker_status "otel-collector"
    check_docker_logs "otel-collector"
    ;;
  *)
    echo "사용법: $0 [service_name]"
    echo "  docker-event-watcher : docker-event-watcher 서비스 상태 및 로그 확인 (기본값)"
    echo "  nginx-proxy-watch    : nginx-proxy-watch 컨테이너 상태 및 로그 확인"
    echo "  otel-collector       : otel-collector 컨테이너 상태 및 로그 확인"
    echo "  docker-live          : nginx-proxy-watch 컨테이너 실시간 로그 모니터링"
    echo "  watcher-live         : docker-event-watcher 서비스 실시간 로그 모니터링"
    echo "  otel-live            : otel-collector 컨테이너 실시간 로그 모니터링"
    echo "  all                  : 모든 서비스 상태 및 로그 확인"
    exit 1
    ;;
esac