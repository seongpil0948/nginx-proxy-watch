#!/bin/bash
# 로그 요약 스크립트
# 사용법: ./log-summary.sh [timeframe]

TIMEFRAME=${1:-hour}  # 기본값은 hour (last hour)

WATCHER_DIR="/data/nginx-proxy-watch/logs"
NGINX_DIR="/data/nginx/logs"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 시간 범위에 따른 grep 패턴 생성
get_time_pattern() {
  local timeframe=$1
  local pattern=""
  
  case $timeframe in
    hour)
      # 현재 시간에 맞는 패턴 생성
      pattern=$(date +'%d/%b/%Y:%H:')
      ;;
    today)
      # 오늘 날짜에 맞는 패턴 생성
      pattern=$(date +'%d/%b/%Y')
      ;;
    yesterday)
      # 어제 날짜에 맞는 패턴 생성
      pattern=$(date -d "yesterday" +'%d/%b/%Y')
      ;;
    week)
      # 일주일 패턴은 복잡하므로 빈 패턴 반환 (전체 확인)
      pattern=""
      ;;
    *)
      echo "알 수 없는 시간 범위: $timeframe"
      exit 1
      ;;
  esac
  
  echo $pattern
}

# Nginx 에러 로그 요약
summarize_nginx_errors() {
  local pattern=$(get_time_pattern $TIMEFRAME)
  local logfile="$NGINX_DIR/error.log"
  
  echo -e "${GREEN}===== Nginx 에러 로그 요약 ($TIMEFRAME) =====${NC}"
  
  if [ ! -f "$logfile" ]; then
    echo -e "${RED}로그 파일이 존재하지 않습니다: $logfile${NC}"
    return
  fi
  
  # 에러 수준별 카운트
  echo -e "${YELLOW}에러 수준별 카운트:${NC}"
  if [ -z "$pattern" ]; then
    grep -E 'error|warn|notice|info|debug' "$logfile" | grep -o -E 'error|warn|notice|info|debug' | sort | uniq -c | sort -nr
  else
    grep "$pattern" "$logfile" | grep -E 'error|warn|notice|info|debug' | grep -o -E 'error|warn|notice|info|debug' | sort | uniq -c | sort -nr
  fi
  
  # 가장 빈번한 에러 메시지
  echo -e "\n${YELLOW}가장 빈번한 에러 메시지 (상위 5개):${NC}"
  if [ -z "$pattern" ]; then
    grep -E 'error|warn' "$logfile" | awk '{$1=$2=$3=$4=""; print $0}' | sort | uniq -c | sort -nr | head -5
  else
    grep "$pattern" "$logfile" | grep -E 'error|warn' | awk '{$1=$2=$3=$4=""; print $0}' | sort | uniq -c | sort -nr | head -5
  fi
  
  echo ""
}

# Nginx 접근 로그 요약
summarize_nginx_access() {
  local pattern=$(get_time_pattern $TIMEFRAME)
  local logfile="$NGINX_DIR/access.log"
  
  echo -e "${GREEN}===== Nginx 접근 로그 요약 ($TIMEFRAME) =====${NC}"
  
  if [ ! -f "$logfile" ]; then
    echo -e "${RED}로그 파일이 존재하지 않습니다: $logfile${NC}"
    return
  fi
  
  # HTTP 상태 코드 카운트
  echo -e "${YELLOW}HTTP 상태 코드별 카운트:${NC}"
  if [ -z "$pattern" ]; then
    awk '{print $9}' "$logfile" | sort | uniq -c | sort -nr
  else
    grep "$pattern" "$logfile" | awk '{print $9}' | sort | uniq -c | sort -nr
  fi
  
  # 가장 많이 접근한 IP
  echo -e "\n${YELLOW}가장 많이 접근한 IP (상위 5개):${NC}"
  if [ -z "$pattern" ]; then
    awk '{print $1}' "$logfile" | sort | uniq -c | sort -nr | head -5
  else
    grep "$pattern" "$logfile" | awk '{print $1}' | sort | uniq -c | sort -nr | head -5
  fi
  
  # 가장 많이 접근한 URL
  echo -e "\n${YELLOW}가장 많이 접근한 URL (상위 5개):${NC}"
  if [ -z "$pattern" ]; then
    awk '{print $7}' "$logfile" | sort | uniq -c | sort -nr | head -5
  else
    grep "$pattern" "$logfile" | awk '{print $7}' | sort | uniq -c | sort -nr | head -5
  fi
  
  # 응답 시간이 가장 긴 요청 (1초 이상)
  echo -e "\n${YELLOW}응답 시간이 긴 요청 (1초 이상, 상위 5개):${NC}"
  if [ -z "$pattern" ]; then
    awk '$(NF-1) > 1 {print $(NF-1) " " $7}' "$logfile" | sort -nr | head -5
  else
    grep "$pattern" "$logfile" | awk '$(NF-1) > 1 {print $(NF-1) " " $7}' | sort -nr | head -5
  fi
  
  echo ""
}

# Docker Event Watcher 로그 요약
summarize_watcher_logs() {
  local pattern=$(get_time_pattern $TIMEFRAME)
  local logfile="$WATCHER_DIR/daemon.log"
  local errorlog="$WATCHER_DIR/error.log"
  
  echo -e "${GREEN}===== Docker Event Watcher 로그 요약 ($TIMEFRAME) =====${NC}"
  
  if [ ! -f "$logfile" ] && [ ! -f "$errorlog" ]; then
    echo -e "${RED}로그 파일이 존재하지 않습니다${NC}"
    return
  fi
  
  # 에러 로그 카운트
  if [ -f "$errorlog" ]; then
    echo -e "${YELLOW}에러 로그 카운트:${NC}"
    if [ -z "$pattern" ]; then
      wc -l "$errorlog"
    else
      grep "$pattern" "$errorlog" | wc -l
    fi
    
    # 가장 빈번한 에러 메시지
    echo -e "\n${YELLOW}가장 빈번한 에러 메시지 (상위 5개):${NC}"
    if [ -z "$pattern" ]; then
      grep -o -E '\[ERROR\].*' "$errorlog" | sort | uniq -c | sort -nr | head -5
    else
      grep "$pattern" "$errorlog" | grep -o -E '\[ERROR\].*' | sort | uniq -c | sort -nr | head -5
    fi
  fi
  
  # 데몬 로그 분석
  if [ -f "$logfile" ]; then
    echo -e "\n${YELLOW}Watcher 이벤트 유형별 카운트:${NC}"
    if [ -z "$pattern" ]; then
      grep -o -E 'event: [a-z]+' "$logfile" | sort | uniq -c | sort -nr
    else
      grep "$pattern" "$logfile" | grep -o -E 'event: [a-z]+' | sort | uniq -c | sort -nr
    fi
  fi
  
  echo ""
}

# 오늘의 전체 로그 통계 요약
display_stats_summary() {
  echo -e "${GREEN}===== 로그 파일 크기 요약 =====${NC}"
  echo -e "${YELLOW}Docker Event Watcher 로그:${NC}"
  du -sh $WATCHER_DIR/* 2>/dev/null || echo "로그 파일이 없습니다"
  
  echo -e "\n${YELLOW}Nginx 로그:${NC}"
  du -sh $NGINX_DIR/* 2>/dev/null || echo "로그 파일이 없습니다"
  
  echo -e "\n${YELLOW}디스크 사용량:${NC}"
  df -h | grep -E '/$|/data'
  
  echo ""
}

# 메인 실행부
echo -e "${BLUE}로그 요약 보고서 - $(date)${NC}\n"

case $TIMEFRAME in
  hour|today|yesterday|week)
    summarize_nginx_errors
    summarize_nginx_access
    summarize_watcher_logs
    display_stats_summary
    ;;
  *)
    echo "사용법: $0 [timeframe]"
    echo "  hour      : 최근 1시간 로그 요약 (기본값)"
    echo "  today     : 오늘 로그 요약"
    echo "  yesterday : 어제 로그 요약"
    echo "  week      : 최근 일주일 로그 요약"
    exit 1
    ;;
esac

echo -e "${GREEN}로그 요약 완료${NC}"