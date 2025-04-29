# Nginx Proxy Watch - 라우팅 테스트 샘플 프로젝트

이 프로젝트는 `nginx-proxy-watch`의 다양한 라우팅 기능을 로컬 환경에서 테스트하기 위한 샘플입니다. 다음과 같은 다양한 라우팅 시나리오를 제공합니다:

- **기본 Vhost 라우팅**: 특정 호스트 이름으로 들어오는 요청을 지정된 컨테이너로 라우팅
- **Location 기반 라우팅**: 특정 호스트의 특정 경로(/api, /admin 등)로 들어오는 요청을 다른 컨테이너로 라우팅
- **Group Host 라우팅**: 여러 서비스를 하나의 그룹 호스트 아래 경로로 묶어 관리
- **쿠키 기반 라우팅**: 특정 쿠키 값에 따라 요청을 다른 컨테이너로 동적 라우팅
- **다중 경로 라우팅**: 단일 호스트에서 5개의 서로 다른 경로를 각각 다른 컨테이너로 라우팅
- **로드 밸런싱**: 동일 서비스의 여러 인스턴스 간 요청 분산

## 환경변수 가이드

### 기본 환경변수

- **VIRTUAL_HOST**: 서비스할 도메인 이름 (필수)
- **VIRTUAL_PORT**: 컨테이너 내부 서비스 포트 (기본값: 80)

### Location 기반 라우팅 환경변수

- **VIRTUAL_IS_LOCATION**: 호스트 내 특정 경로를 처리 여부 (`Y`/`yes`/`true` 등)
- **VIRTUAL_LOCATION**: 처리할 호스트와 경로 조합 (형식: `host:path`, 여러 개는 쉼표로 구분)

### Group Host 관련 환경변수

- **VIRTUAL_GROUP_HOST**: 그룹 호스트 도메인 이름 
- **VIRTUAL_LOCATION_PATH**: 그룹 호스트 내 경로명

### SSL/HTTPS 관련 환경변수

- **VIRTUAL_SSL**: SSL 인증서 이름 (기본값: VIRTUAL_HOST 값)
- **VIRTUAL_CERT**: 인증서 타입 (`crt` 또는 `pem`)

### 쿠키 라우팅 관련 환경변수

- **VIRTUAL_COOKIE_NAME**: 라우팅에 사용할 쿠키 이름
- **VIRTUAL_ROUTING_MAP**: 쿠키 값:업스트림 매핑 (형식: `value1:upstream1,value2:upstream2`)
- **VIRTUAL_DEFAULT_UPSTREAM**: 쿠키가 없거나 매핑되지 않은 경우 기본 라우팅 대상

## 환경변수 사용 예시

### 1. 기본 Vhost 설정