#!/bin/bash
# bash scripts/scan.sh  ./ --exclude-dir '.git' --exclude-dir 'node_modules' --exclude-file '*.log' --exclude-file 'out.txt' --exclude-file '*DS_Store*' --exclude-file '*.lock'  > out.txt

# 색상 코드 정의
COLOR_BLUE='\033[0;34m'
COLOR_GREEN='\033[0;32m'
COLOR_RED='\033[0;31m'
COLOR_YELLOW='\033[0;33m'
COLOR_RESET='\033[0m' # 색상 초기화

# 사용법 안내 함수
usage() {
  echo -e "${COLOR_BLUE}사용법: $0 <경로/대상_디렉토리> [--exclude-dir <제외할_디렉토리_패턴1>] [--exclude-dir <패턴2> ...] [--exclude-file <제외할_파일_패턴1>] [--exclude-file <패턴2> ...]${COLOR_RESET}"
  echo -e "${COLOR_BLUE}예시: $0 ./ --exclude-dir '.git' --exclude-dir 'node_modules' --exclude-file '*.log' --exclude-file '*.tmp'${COLOR_RESET}"
  echo ""
  echo -e "${COLOR_BLUE}설명:${COLOR_RESET}"
  echo "  <경로/대상_디렉토리> : 스캔을 시작할 디렉토리 경로."
  echo "  --exclude-dir <패턴> : 스캔에서 제외할 디렉토리 이름 패턴. 여러 번 지정 가능."
  echo "                         (예: '.git', 'node_modules')"
  echo "  --exclude-file <패턴> : 스캔에서 제외할 파일 이름 패턴. 여러 번 지정 가능."
  echo "                         (예: '*.log', '*.tmp', '*.bak')"
  echo ""
  echo "패턴은 쉘 글로브 패턴(*, ?, [])을 사용합니다."
}

# 인자 파싱
EXCLUDE_DIRS=()
EXCLUDE_FILES=()
TARGET_DIRECTORY=""

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    --exclude-dir)
      if [ -z "$2" ]; then
        echo -e "${COLOR_RED}오류: --exclude-dir 옵션에는 패턴이 필요합니다.${COLOR_RESET}"
        usage
        exit 1
      fi
      EXCLUDE_DIRS+=("$2")
      shift # --exclude-dir 처리
      shift # 패턴 처리
      ;;
    --exclude-file)
      if [ -z "$2" ]; then
        echo -e "${COLOR_RED}오류: --exclude-file 옵션에는 패턴이 필요합니다.${COLOR_RESET}"
        usage
        exit 1
      fi
      EXCLUDE_FILES+=("$2")
      shift # --exclude-file 처리
      shift # 패턴 처리
      ;;
    *) # 첫 번째 인자는 대상 디렉토리로 간주
      if [ -z "$TARGET_DIRECTORY" ]; then
        TARGET_DIRECTORY="$1"
        shift # 디렉토리 처리
      else
        echo -e "${COLOR_RED}오류: 알 수 없는 인자 '$1' 입니다.${COLOR_RESET}"
        usage
        exit 1
      fi
      ;;
  esac
done

# 대상 디렉토리 필수 확인
if [ -z "$TARGET_DIRECTORY" ]; then
  echo -e "${COLOR_RED}오류: 스캔할 대상 디렉토리를 지정해야 합니다.${COLOR_RESET}"
  usage
  exit 1
fi

# 대상 디렉토리 유효성 확인
if [ ! -d "$TARGET_DIRECTORY" ]; then
  echo -e "${COLOR_RED}오류: 유효하지 않은 디렉토리 '$TARGET_DIRECTORY' 입니다.${COLOR_RESET}"
  exit 1
fi

# find 명령어 동적 구성
FIND_CMD=("find" "$TARGET_DIRECTORY")

# 디렉토리 제외 옵션 추가
if [ ${#EXCLUDE_DIRS[@]} -gt 0 ]; then
  FIND_CMD+=("(" "-type" "d")
  first=1
  for pattern in "${EXCLUDE_DIRS[@]}"; do
    if [ $first -eq 0 ]; then FIND_CMD+=("-o"); fi
    # -path는 전체 경로를 glob 매칭, -name은 이름만 glob 매칭.
    # 일반적으로 .git, node_modules 같은 이름은 -name으로 충분하며 더 간단함.
    # 만약 특정 경로의 디렉토리만 제외하려면 -path 사용 고려
    # FIND_CMD+=("-path" "$TARGET_DIRECTORY/$pattern") # 특정 경로 기준 제외 시
    FIND_CMD+=("-name" "$pattern") # 이름 기준 제외 시
    first=0
  done
  FIND_CMD+=(")")
  FIND_CMD+=("-prune") # 제외 디렉토리 내부 탐색 방지
  FIND_CMD+=("-o") # 디렉토리가 아니거나 제외 디렉토리가 아닌 경우
fi

# 파일 제외 옵션 추가 및 파일 타입 지정
# 디렉토리 제외가 없더라도 -type f는 필요하므로 항상 추가
FIND_CMD+=("-type" "f")

if [ ${#EXCLUDE_FILES[@]} -gt 0 ]; then
    FIND_CMD+=("(");
    first=1
    for pattern in "${EXCLUDE_FILES[@]}"; do
        if [ $first -eq 0 ]; then FIND_CMD+=("-a"); fi # 파일 제외는 AND 조건으로 연결
        FIND_CMD+=("!" "-name" "$pattern") # 패턴에 해당하지 않는 파일
        first=0
    done
    FIND_CMD+=(")");
fi


# 최종 결과로 파일 경로를 null 종단 문자(\0)로 출력
FIND_CMD+=("-print0")

# 디버깅을 위해 생성된 find 명령어 출력 (필요시 주석 해제)
# echo "실행될 find 명령어: ${FIND_CMD[@]}"

# find 명령 실행 및 결과 처리
# find는 결과 파일 경로를 null 종단 문자로 구분하여 출력 (-print0)
# read -d ''는 null 종단 문자를 구분자로 사용하여 안전하게 파일 경로를 읽음
processed_count=0
"${FIND_CMD[@]}" | while IFS= read -r -d '' FILE; do
  if [ -f "$FILE" ]; then # 파일인지 다시 한번 확인 (심볼릭 링크 등)
    echo -e "${COLOR_GREEN}--- 파일 시작: ${FILE} ---${COLOR_RESET}"
    cat "$FILE"
    echo -e "${COLOR_GREEN}--- 파일 끝: ${FILE} ---${COLOR_RESET}"
    echo "" # 파일 내용 끝에 빈 줄 추가
    processed_count=$((processed_count + 1))
  fi
done

echo -e "${COLOR_BLUE}--- 스캔 완료: 총 ${processed_count}개의 파일 처리 ---${COLOR_RESET}"

exit 0