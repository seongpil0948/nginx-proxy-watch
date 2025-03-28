#!/bin/bash
# 로그 모니터링 유틸리티 스크립트
# 사용법: ./monitor-logs.sh [watcher|nginx|otel|all] [lines]

SERVICE=${1:-all}   # 기본값은 "all"
LINES=${2:-100}     # 기본값은 100줄

WATCHER_DIR="/data/nginx-proxy-watch/logs"
NGINX_DIR="/data/nginx/logs"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 로그 파일 존재 확인
check_log_dirs() {
  if [ ! -d "$WATCHER_DIR" ]; then
    echo -e "${RED}경고: $WATCHER_DIR 디렉토리가 존재하지 않습니다${NC}"
  fi
  
  if [ ! -d "$NGINX_DIR" ]; then
    echo -e "${RED}경고: $NGINX_DIR 디렉토리가 존재하지 않습니다${NC}"
  fi
}

# Watcher 로그 모니터링
monitor_watcher() {
  echo -e "${GREEN}===== Docker Event Watcher 로그 모니터링 =====${NC}"
  if [ -f "$WATCHER_DIR/access.log" ]; then
    echo -e "${YELLOW}[접근 로그]${NC} 최근 $LINES 줄:"
    tail -n $LINES "$WATCHER_DIR/access.log"
    echo ""
  fi
  
  if [ -f "$WATCHER_DIR/error.log" ]; then
    echo -e "${RED}[에러 로그]${NC} 최근 $LINES 줄:"
    tail -n $LINES "$WATCHER_DIR/error.log"
    echo ""
  fi
  
  if [ -f "$WATCHER_DIR/daemon.log" ]; then
    echo -e "${BLUE}[데몬 로그]${NC} 최근 $LINES 줄:"
    tail -n $LINES "$WATCHER_DIR/daemon.log"
    echo ""
  fi
}

# Nginx 로그 모니터링
monitor_nginx() {
  echo -e "${GREEN}===== Nginx 로그 모니터링 =====${NC}"
  if [ -f "$NGINX_DIR/access.log" ]; then
    echo -e "${YELLOW}[접근 로그]${NC} 최근 $LINES 줄:"
    tail -n $LINES "$NGINX_DIR/access.log"
    echo ""
  fi
  
  if [ -f "$NGINX_DIR/error.log" ]; then
    echo -e "${RED}[에러 로그]${NC} 최근 $LINES 줄:"
    tail -n $LINES "$NGINX_DIR/error.log"
    echo ""
  fi
}

# OpenTelemetry Collector 로그 모니터링
monitor_otel() {
  echo -e "${GREEN}===== OpenTelemetry Collector 로그 모니터링 =====${NC}"
  if docker ps | grep -q otel-collector; then
    echo -e "${BLUE}[OpenTelemetry Collector 로그]${NC} 최근 $LINES 줄:"
    docker logs --tail $LINES otel-collector
    echo ""
  else
    echo -e "${RED}OpenTelemetry Collector 컨테이너가 실행 중이 아닙니다${NC}"
  fi
}

# 실시간 로그 모니터링
live_tail() {
  local service=$1
  echo -e "${GREEN}실시간 로그 모니터링을 시작합니다. 중단하려면 Ctrl+C를 누르세요.${NC}"
  
  case $service in
    watcher)
      tail -f "$WATCHER_DIR/access.log" "$WATCHER_DIR/error.log" "$WATCHER_DIR/daemon.log"
      ;;
    nginx)
      tail -f "$NGINX_DIR/access.log" "$NGINX_DIR/error.log"
      ;;
    otel)
      docker logs -f otel-collector
      ;;
    all)
      echo -e "${RED}모든 로그 실시간 모니터링은 지원하지 않습니다. 특정 서비스를 선택하세요.${NC}"
      exit 1
      ;;
    *)
      echo -e "${RED}알 수 없는 서비스: $service${NC}"
      exit 1
      ;;
  esac
}

# 메인 기능
check_log_dirs

case $SERVICE in
  watcher)
    monitor_watcher
    ;;
  nginx)
    monitor_nginx
    ;;
  otel)
    monitor_otel
    ;;
  all)
    monitor_watcher
    monitor_nginx
    monitor_otel
    ;;
  live-watcher|live-nginx|live-otel)
    service_name=${SERVICE#live-}
    live_tail $service_name
    ;;
  *)
    echo "사용법: $0 [watcher|nginx|otel|all|live-watcher|live-nginx|live-otel] [lines]"
    echo "  watcher      : Docker Event Watcher 로그만 표시"
    echo "  nginx        : Nginx 로그만 표시"
    echo "  otel         : OpenTelemetry Collector 로그만 표시"
    echo "  all          : 모든 서비스 로그 표시 (기본값)"
    echo "  live-watcher : Docker Event Watcher 로그 실시간 모니터링"
    echo "  live-nginx   : Nginx 로그 실시간 모니터링"
    echo "  live-otel    : OpenTelemetry Collector 로그 실시간 모니터링"
    echo "  lines        : 표시할 로그 라인 수 (기본값: 100)"
    exit 1
    ;;
esac