#!/bin/bash
 
# 파일이 존재하는지 확인
if [ -z "$1" ]; then
  echo "사용법: $0 <path/to/directory> [regex_pattern]"
  exit 1
fi

DIRECTORY=$1
PATTERN=$2  # 정규 표현식 패턴 (선택 사항)

# 디렉토리가 유효한지 확인
if [ ! -d "$DIRECTORY" ]; then
  echo "유효하지 않은 디렉토리: $DIRECTORY"
  exit 1
fi

# 모든 파일을 재귀적으로 탐색하고 출력하는 함수
print_files() {
  local DIR=$1
  local REGEX=$2

  # 정규 표현식이 제공된 경우에만 적용
  if [ -z "$REGEX" ]; then
    # 정규 표현식이 없으면 모든 파일 출력
    find "$DIR" -type f | while read -r FILE; do
      echo "file name: $FILE"
      echo "file content:"
      cat "$FILE"
      echo -e "\n ===\n"
    done
  else
    # 정규 표현식이 있으면 해당 파일만 출력
    find "$DIR" -type f | grep -E "$REGEX" | while read -r FILE; do
      echo "file name: $FILE"
      echo "file content:"
      cat "$FILE"
      echo -e "\n === \n"
    done
  fi
}

# 주어진 디렉토리에서 정규 표현식을 적용하여 파일 탐색
print_files "$DIRECTORY" "$PATTERN"
