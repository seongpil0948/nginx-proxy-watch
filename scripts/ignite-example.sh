#!/bin/bash
# 개선된 예제 실행 스크립트

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${GREEN}nginx-proxy-watch 테스트 환경 시작 중...${NC}"

# 필요한 디렉토리 구조 생성
echo -e "${YELLOW}필요한 디렉토리 생성 중...${NC}"
mkdir -p ./example/nginx-proxy/local_certs \
         ./example/nginx-proxy/local_logs/nginx \
         ./example/nginx-proxy/local_logs/watcher

# 자체 서명 인증서 생성 (파일이 없는 경우)
CERT_PATH="./example/nginx-proxy/local_certs/secure.test.local_crt.pem"
KEY_PATH="./example/nginx-proxy/local_certs/secure.test.local_key.pem"
export COMPOSE_BAKE=true

if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
  echo -e "${YELLOW}SSL 테스트용 자체 서명 인증서 생성 중...${NC}"
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY_PATH" \
    -out "$CERT_PATH" \
    -subj "/CN=secure.test.local/O=Test/C=US" \
    -addext "subjectAltName = DNS:secure.test.local"
fi

# 호스트 파일 설정 확인 및 안내
echo -e "${BLUE}========== 호스트 파일 설정 ===========${NC}"
echo -e "${YELLOW}테스트 환경이 제대로 작동하려면 로컬 hosts 파일에 다음 항목을 추가해야 합니다:${NC}"
echo -e "${GREEN}127.0.0.1 main.test.local group.test.local cookie.test.local secure.test.local balance.test.local multipath.test.local${NC}"

echo -e "\n${YELLOW}호스트 파일 위치:${NC}"
echo -e "  - Windows: ${BLUE}C:\\Windows\\System32\\drivers\\etc\\hosts${NC} (관리자 권한으로 편집)"
echo -e "  - macOS/Linux: ${BLUE}/etc/hosts${NC} (sudo 권한으로 편집)"

# 호스트 파일 상태 확인 (리눅스/맥 전용)
if [ -f "/etc/hosts" ]; then
  echo -e "\n${YELLOW}현재 hosts 파일 확인 중...${NC}"
  if grep -q "main.test.local\|group.test.local" /etc/hosts; then
    echo -e "${GREEN}테스트 도메인이 이미 hosts 파일에 설정되어 있습니다.${NC}"
  else
    echo -e "${RED}테스트 도메인 설정이 확인되지 않았습니다. hosts 파일을 수동으로 편집해주세요.${NC}"
    echo -e "명령어 예시: ${BLUE}sudo sh -c 'echo \"127.0.0.1 main.test.local group.test.local cookie.test.local secure.test.local balance.test.local multipath.test.local\" >> /etc/hosts'${NC}"
  fi
fi
echo -e "${BLUE}=====================================${NC}\n"

# Docker 환경 시작
echo -e "${GREEN}Docker Compose 환경 시작 중...${NC}"
docker compose -f example/docker-compose-sample.yml up \
  -d --build --force-recreate --remove-orphans \
  --scale app-main=2 --scale app-multipath-root=2 --scale app-cookie-pharmacy=2 --scale app-balance-2=2

# 상태 확인
echo -e "${GREEN}실행 중인 컨테이너 확인:${NC}"
docker compose -f example/docker-compose-sample.yml ps

echo -e "\n${GREEN}테스트 환경이 성공적으로 시작되었습니다!${NC}"
echo -e "${YELLOW}다음 URL로 테스트할 수 있습니다:${NC}"
echo "  - 기본 Vhost: http://main.test.local/main"
echo "  - Group Host API: http://main.test.local/api"
echo "  - Group Host Admin: http://main.test.local/admin"
echo "  - 그룹 서비스: http://group.test.local/serviceA 및 http://group.test.local/serviceB"
echo "  - 쿠키 라우팅: http://cookie.test.local (브라우저에서 쿠키 service_type=1 또는 2 설정)"
echo "  - 보안 연결: https://secure.test.local"
echo "  - 로드 밸런싱: http://balance.test.local (여러 번 새로고침)"
echo "  - 다중 경로: http://multipath.test.local/path1, /path2, .../path5"