
#!/bin/bash
# 개선된 예제 실행 스크립트

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
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

# 호스트 파일 설정 확인
echo -e "${YELLOW}호스트 파일 설정을 확인해주세요:${NC}"
echo "127.0.0.1 main.test.local group.test.local cookie.test.local secure.test.local balance.test.local multipath.test.local"

# Docker 환경 시작
echo -e "${GREEN}Docker Compose 환경 시작 중...${NC}"
docker compose -f example/docker-compose-sample.yml up -d --build --force-recreate --remove-orphans

# 상태 확인
echo -e "${GREEN}실행 중인 컨테이너 확인:${NC}"
docker compose -f example/docker-compose-sample.yml ps

echo -e "${GREEN}테스트 환경이 성공적으로 시작되었습니다!${NC}"
echo -e "${YELLOW}다음 URL로 테스트할 수 있습니다:${NC}"
echo "  - 기본 Vhost: http://main.test.local"
echo "  - API 경로: http://main.test.local/api"
echo "  - 관리자 경로: http://main.test.local/admin"
echo "  - 그룹 서비스: http://group.test.local/serviceA 및 http://group.test.local/serviceB"
echo "  - 쿠키 라우팅: http://cookie.test.local"
echo "  - 보안 연결: https://secure.test.local"
echo "  - 로드 밸런싱: http://balance.test.local"
echo "  - 다중 경로: http://multipath.test.local/path1, .../path5"