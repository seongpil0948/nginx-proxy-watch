#!/bin/bash
# 모니터링 스크립트 설치 및 설정
# 사용법: ./setup-monitoring.sh [install_dir]

INSTALL_DIR=${1:-/opt/monitoring}

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# 스크립트 설치 디렉토리 생성
create_dirs() {
  echo -e "${GREEN}모니터링 스크립트 설치 디렉토리 생성: $INSTALL_DIR${NC}"
  mkdir -p "$INSTALL_DIR" || { echo -e "${RED}디렉토리 생성 실패${NC}"; exit 1; }
  echo "디렉토리 생성 완료"
}

# 스크립트 복사 및 권한 설정
copy_scripts() {
  echo -e "${GREEN}모니터링 스크립트 복사 중...${NC}"
  
  # 현재 디렉토리의 모니터링 스크립트 복사
  cp monitor-logs.sh "$INSTALL_DIR/" || { echo -e "${RED}monitor-logs.sh 복사 실패${NC}"; exit 1; }
  cp journalctl-docker-monitor.sh "$INSTALL_DIR/" || { echo -e "${RED}journalctl-docker-monitor.sh 복사 실패${NC}"; exit 1; }
  cp log-summary.sh "$INSTALL_DIR/" || { echo -e "${RED}log-summary.sh 복사 실패${NC}"; exit 1; }
  
  # 실행 권한 부여
  chmod +x "$INSTALL_DIR/"*.sh || { echo -e "${RED}실행 권한 설정 실패${NC}"; exit 1; }
  
  echo "스크립트 복사 및 권한 설정 완료"
}

# 심볼릭 링크 생성
create_symlinks() {
  echo -e "${GREEN}실행 경로에 심볼릭 링크 생성 중...${NC}"
  
  ln -sf "$INSTALL_DIR/monitor-logs.sh" /usr/local/bin/monitor-logs || { echo -e "${RED}monitor-logs 심볼릭 링크 생성 실패${NC}"; exit 1; }
  ln -sf "$INSTALL_DIR/journalctl-docker-monitor.sh" /usr/local/bin/docker-monitor || { echo -e "${RED}docker-monitor 심볼릭 링크 생성 실패${NC}"; exit 1; }
  ln -sf "$INSTALL_DIR/log-summary.sh" /usr/local/bin/log-summary || { echo -e "${RED}log-summary 심볼릭 링크 생성 실패${NC}"; exit 1; }
  
  echo "심볼릭 링크 생성 완료"
}

# cron 작업 설정
setup_cron() {
  echo -e "${GREEN}Cron 작업 설정 중...${NC}"
  
  # 임시 crontab 파일 생성
  TEMP_CRON=$(mktemp)
  crontab -l > "$TEMP_CRON" 2>/dev/null || echo "# 새로운 crontab 파일" > "$TEMP_CRON"
  
  # 기존 항목 확인 및 추가
  if ! grep -q "$INSTALL_DIR/log-summary.sh" "$TEMP_CRON"; then
    echo "# 매일 자정에 어제 로그 요약 생성" >> "$TEMP_CRON"
    echo "0 0 * * * $INSTALL_DIR/log-summary.sh yesterday > /var/log/log-summary-yesterday.log 2>&1" >> "$TEMP_CRON"
    
    echo "# 매주 월요일 오전 1시에 주간 로그 요약 생성" >> "$TEMP_CRON"
    echo "0 1 * * 1 $INSTALL_DIR/log-summary.sh week > /var/log/log-summary-weekly.log 2>&1" >> "$TEMP_CRON"
    
    # crontab 설정
    crontab "$TEMP_CRON" || { echo -e "${RED}crontab 설정 실패${NC}"; rm "$TEMP_CRON"; exit 1; }
    echo "Cron 작업 설정 완료"
  else
    echo "Cron 작업이 이미 설정되어 있습니다"
  fi
  
  # 임시 파일 삭제
  rm "$TEMP_CRON"
}

# 사용법 안내 출력
display_usage() {
  echo -e "${GREEN}모니터링 스크립트 사용법:${NC}"
  echo -e "${YELLOW}기본 로그 모니터링:${NC}"
  echo "  monitor-logs [watcher|nginx|otel|all] [lines]"
  echo "  monitor-logs live-watcher  # 실시간 watcher 로그 모니터링"
  echo "  monitor-logs live-nginx    # 실시간 nginx 로그 모니터링"
  
  echo -e "\n${YELLOW}systemd 및 Docker 모니터링:${NC}"
  echo "  docker-monitor [service_name]"
  echo "  docker-monitor all         # 모든 서비스 상태 및 로그 확인"
  echo "  docker-monitor docker-live  # docker 컨테이너 실시간 로그"
  
  echo -e "\n${YELLOW}로그 요약 보고서:${NC}"
  echo "  log-summary [hour|today|yesterday|week]"
  
  echo -e "\n${YELLOW}설치 경로:${NC} $INSTALL_DIR"
}

# 메인 실행부
echo -e "${GREEN}로그 모니터링 스크립트 설치 시작${NC}"

create_dirs
copy_scripts
create_symlinks
setup_cron
display_usage

echo -e "${GREEN}설치 완료!${NC}"