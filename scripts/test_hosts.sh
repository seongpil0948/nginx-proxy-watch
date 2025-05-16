#!/bin/bash

# 호스트 접근 테스트 스크립트
# 사용법: ./test_hosts.sh [--verbose] [--all]

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# 옵션 파싱
VERBOSE=0
TEST_ALL=0

for arg in "$@"; do
  case $arg in
    --verbose|-v)
      VERBOSE=1
      shift
      ;;
    --all|-a)
      TEST_ALL=1
      shift
      ;;
  esac
done

# 결과 저장 디렉토리
RESULTS_DIR="./test_results"
mkdir -p "$RESULTS_DIR"

# 로그 파일
LOG_FILE="$RESULTS_DIR/test_$(date +%Y%m%d_%H%M%S).log"

# 유틸리티 함수
log() {
  local level=$1
  local message=$2
  local color=$NC

  case $level in
    "INFO") color=$GREEN ;;
    "WARN") color=$YELLOW ;;
    "ERROR") color=$RED ;;
    "TEST") color=$BLUE ;;
  esac

  echo -e "${color}[$level] $message${NC}"
  echo "[$(date +"%Y-%m-%d %H:%M:%S")] [$level] $message" >> "$LOG_FILE"
}

# HTTP 요청 테스트 함수
test_http() {
  local url=$1
  local description=$2
  local expected_code=${3:-200}
  local cookie_header=$4

  log "TEST" "테스트: $description ($url)"
  
  local curl_opts="-s -o /dev/null -w '%{http_code}'"
  
  if [ -n "$cookie_header" ]; then
    curl_opts="$curl_opts -H 'Cookie: $cookie_header'"
  fi
  
  # 쿠키 헤더가 있는 경우의 curl 명령
  if [ -n "$cookie_header" ]; then
    result=$(curl -s -o "$RESULTS_DIR/$(echo $url | sed 's/[:\/.?=]/_/g').html" -w "%{http_code}" -H "Cookie: $cookie_header" "$url")
  else
    result=$(curl -s -o "$RESULTS_DIR/$(echo $url | sed 's/[:\/.?=]/_/g').html" -w "%{http_code}" "$url")
  fi
  
  if [ "$result" = "$expected_code" ]; then
    log "INFO" "성공: $url (응답 코드: $result)"
    if [ $VERBOSE -eq 1 ]; then
      # 응답 본문 처음 100자 출력
      body=$(head -c 100 "$RESULTS_DIR/$(echo $url | sed 's/[:\/.?=]/_/g').html")
      log "INFO" "응답 미리보기: ${body}..."
    fi
    return 0
  else
    log "ERROR" "실패: $url (응답 코드: $result, 기대: $expected_code)"
    if [ $VERBOSE -eq 1 ]; then
      # 에러 응답 출력
      error=$(cat "$RESULTS_DIR/$(echo $url | sed 's/[:\/.?=]/_/g').html")
      log "ERROR" "에러 응답: ${error:0:100}..."
    fi
    return 1
  fi
}

# 호스트 확인 및 결과 요약을 위한 변수
total_tests=0
passed_tests=0

# 테스트 시작 정보
log "INFO" "호스트 접근 테스트 시작 - $(date)"
log "INFO" "결과 로그 파일: $LOG_FILE"
log "INFO" "테스트 결과 저장 폴더: $RESULTS_DIR"

# 기본 호스트 테스트
log "INFO" "=== 기본 호스트 테스트 ==="
test_http "http://main.test.local" "메인 호스트" 200
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

# 그룹 호스트 테스트
log "INFO" "=== 그룹 호스트 테스트 ==="
test_http "http://main.test.local/api" "API 서비스" 200
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

test_http "http://main.test.local/admin" "Admin 서비스" 200
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

test_http "http://group.test.local/serviceA" "ServiceA" 200
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

test_http "http://group.test.local/serviceB" "ServiceB" 200
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

# 쿠키 기반 라우팅 테스트
log "INFO" "=== 쿠키 기반 라우팅 테스트 ==="
test_http "http://cookie.test.local" "기본 라우팅 (쿠키 없음)" 200
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

test_http "http://cookie.test.local" "병원 서비스 (쿠키 mall_type=1)" 200 "mall_type=1"
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

test_http "http://cookie.test.local" "약국 서비스 (쿠키 mall_type=2)" 200 "mall_type=2"
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

# 보안 연결 테스트
log "INFO" "=== 보안 연결 테스트 ==="
test_http "https://secure.test.local" "HTTPS 연결" 200 "" "-k"
((total_tests++))
if [ $? -eq 0 ]; then ((passed_tests++)); fi

# 로드 밸런싱 테스트
log "INFO" "=== 로드 밸런싱 테스트 ==="
log "INFO" "로드 밸런싱 요청 5회 전송 중..."
for i in {1..5}; do
  test_http "http://balance.test.local" "Balance 서비스 요청 #$i" 200
  ((total_tests++))
  if [ $? -eq 0 ]; then ((passed_tests++)); fi
  # 요청 간 짧은 지연
  sleep 0.5
done

# 다중 경로 테스트
log "INFO" "=== 다중 경로 테스트 ==="
for path in {1..5}; do
  test_http "http://multipath.test.local/path$path" "다중 경로 서비스 path$path" 200
  ((total_tests++))
  if [ $? -eq 0 ]; then ((passed_tests++)); fi
done

# 추가 테스트 (--all 옵션이 있는 경우)
if [ $TEST_ALL -eq 1 ]; then
  log "INFO" "=== 추가 상세 테스트 ==="
  
  # 잘못된 경로 테스트
  test_http "http://main.test.local/nonexistent" "잘못된 경로" 404
  ((total_tests++))
  if [ $? -eq 0 ]; then ((passed_tests++)); fi
  
  # 헤더 테스트
  log "TEST" "헤더 확인: main.test.local"
  headers=$(curl -s -I "http://main.test.local" | head -20)
  echo "$headers" > "$RESULTS_DIR/main_headers.txt"
  log "INFO" "헤더 저장됨: $RESULTS_DIR/main_headers.txt"
  
  # 기타 추가 테스트...
fi

# 테스트 결과 요약
success_rate=$(( (passed_tests * 100) / total_tests ))
log "INFO" "=== 테스트 결과 요약 ==="
log "INFO" "총 테스트: $total_tests"
log "INFO" "성공한 테스트: $passed_tests"
log "INFO" "실패한 테스트: $(( total_tests - passed_tests ))"
log "INFO" "성공률: ${success_rate}%"

# 테스트 종료 정보
log "INFO" "호스트 접근 테스트 완료 - $(date)"

# 결과에 따른 종료 코드 설정
if [ $passed_tests -eq $total_tests ]; then
  log "INFO" "모든 테스트 통과!"
  exit 0
else
  log "WARN" "일부 테스트 실패. 로그 파일 확인: $LOG_FILE"
  exit 1
fi