# Nginx Proxy Watch - 로컬 테스트 환경

이 프로젝트는 `nginx-proxy-watch`의 다양한 라우팅 기능을 로컬 환경에서 테스트하기 위한 샘플입니다. nginx-proxy-watch는 Docker 컨테이너 이벤트를 감시하고 Nginx 설정을 자동으로 생성해주는 도구입니다.

## 지원하는 라우팅 시나리오

- **기본 Vhost 라우팅**: 특정 호스트 이름으로 들어오는 요청을 지정된 컨테이너로 라우팅
- **Group Host 라우팅**: 여러 서비스를 하나의 그룹 호스트 아래 경로로 묶어 관리 (권장 방식)
- **쿠키 기반 라우팅**: 특정 쿠키 값에 따라 요청을 다른 컨테이너로 동적 라우팅
- **로드 밸런싱**: 동일 서비스의 여러 인스턴스 간 요청 분산

## 환경변수 가이드

### 기본 환경변수

| 환경변수 | 설명 | 기본값 |
|---------|------|--------|
| `VIRTUAL_HOST` | 서비스할 도메인 이름 (필수) | - |
| `VIRTUAL_PORT` | 컨테이너 내부 서비스 포트 | 80 |

### Group Host 관련 환경변수 (권장 방식)

| 환경변수 | 설명 | 예시 |
|---------|------|------|
| `VIRTUAL_GROUP_HOST` | 그룹 호스트 도메인 이름 | `group.example.com` |
| `VIRTUAL_LOCATION_PATH` | 그룹 호스트 내 경로명 | `serviceA` |

### SSL/HTTPS 관련 환경변수

| 환경변수 | 설명 | 예시 |
|---------|------|------|
| `VIRTUAL_SSL` | SSL 인증서 이름 | `example.com` |
| `VIRTUAL_CERT` | 인증서 타입 | `crt` 또는 `pem` |

### 쿠키 라우팅 관련 환경변수

| 환경변수 | 설명 | 예시 |
|---------|------|------|
| `VIRTUAL_COOKIE_NAME` | 라우팅에 사용할 쿠키 이름 | `user_type` |
| `VIRTUAL_ROUTING_MAP` | 쿠키 값:업스트림 매핑 | `admin:admin-svc,user:user-svc` |
| `VIRTUAL_DEFAULT_UPSTREAM` | 쿠키가 없거나 매핑되지 않은 경우 기본 라우팅 대상 | `default-svc` |
| `VIRTUAL_HOST_HEADER_MAP` | 업스트림별 Host 헤더 재정의 | `admin-svc:admin.internal,user-svc:user.internal` |

## 프로젝트 구조

```
example/
├── app-common/              # 모든 테스트 앱이 공유하는 코드
├── app-main/                # 기본 Vhost 테스트 (/main)
├── app-api/                 # API 경로 라우팅 테스트 (/api)
├── app-admin/               # 관리자 경로 라우팅 테스트 (/admin)
├── app-group-service-a/     # Group Host 테스트 (serviceA)
├── app-group-service-b/     # Group Host 테스트 (serviceB)
├── app-cookie-hospital/     # 쿠키 라우팅 테스트 (hospital)
├── app-cookie-pharmacy/     # 쿠키 라우팅 테스트 (pharmacy)
├── app-secure/              # SSL/HTTPS 테스트
├── app-balance/             # 로드 밸런싱 테스트
├── app-multipath/           # 다중 경로 테스트
├── docker-compose-sample.yml # Docker Compose 설정 파일
└── nginx-proxy/            # Nginx 관련 파일들이 마운트될 디렉토리
    ├── local_certs/        # SSL 인증서 파일
    └── local_logs/         # 로그 파일
```

## 환경변수 사용 예시

### 1. 기본 Vhost 설정
```yaml
environment:
  - VIRTUAL_HOST=example.com
  - VIRTUAL_PORT=8080
```

### 2. Group Host 라우팅 (권장 방식)
```yaml
environment:
  - VIRTUAL_GROUP_HOST=example.com
  - VIRTUAL_HOST=api-internal
  - VIRTUAL_PORT=8081
  - VIRTUAL_LOCATION_PATH=api
```

### 3. 쿠키 기반 라우팅
```yaml
environment:
  - VIRTUAL_HOST=cookie.example.com
  - VIRTUAL_PORT=80
  - VIRTUAL_COOKIE_NAME=mall_type
  - VIRTUAL_ROUTING_MAP=1:service-a,2:service-b
  - VIRTUAL_DEFAULT_UPSTREAM=service-b
  - VIRTUAL_HOST_HEADER_MAP=service-a:service-a.internal,service-b:service-b.internal
```

### 4. 보안 연결(HTTPS)
```yaml
environment:
  - VIRTUAL_HOST=secure.example.com
  - VIRTUAL_PORT=8087
  - VIRTUAL_SSL=secure.example.com
  - VIRTUAL_CERT=pem  # 또는 crt
```

## hosts 파일 설정 방법

로컬 환경에서 테스트하려면 hosts 파일에 테스트 도메인을 추가해야 합니다:

### Windows의 경우:
1. 관리자 권한으로 메모장 실행
2. 파일 열기: `C:\Windows\System32\drivers\etc\hosts`
3. 다음 줄 추가:
```
127.0.0.1 main.test.local group.test.local cookie.test.local secure.test.local balance.test.local multipath.test.local
```
4. 저장 후 닫기

### macOS/Linux의 경우:
1. 터미널에서 다음 명령 실행:
```bash
sudo nano /etc/hosts
```
2. 다음 줄 추가:
```
127.0.0.1 main.test.local group.test.local cookie.test.local secure.test.local balance.test.local multipath.test.local
```
3. Ctrl+O로 저장 후 Ctrl+X로 나가기

## 환경 실행 방법

1. 필요한 디렉토리 구조 생성:
```bash
mkdir -p ./nginx-proxy/local_certs ./nginx-proxy/local_logs/nginx ./nginx-proxy/local_logs/watcher
```

2. SSL 테스트를 위한 자체 서명 인증서 생성 (선택사항):
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ./nginx-proxy/local_certs/secure.test.local_key.pem \
  -out ./nginx-proxy/local_certs/secure.test.local_crt.pem
```

3. 제공된 스크립트로 환경 실행:
```bash
./scripts/ignite-example.sh
```
또는 직접 Docker Compose 명령 실행:
```bash
docker compose -f example/docker-compose-sample.yml up -d --build
```

4. 브라우저에서 테스트:
   - 기본 Vhost: http://main.test.local
   - 그룹 호스트 API: http://main.test.local/api
   - 그룹 호스트 Admin: http://main.test.local/admin
   - 그룹 서비스: http://group.test.local/serviceA 및 http://group.test.local/serviceB
   - 쿠키 라우팅: http://cookie.test.local (쿠키 mall_type=1 또는 mall_type=2 설정)
   - 보안 연결: https://secure.test.local
   - 로드 밸런싱: http://balance.test.local (여러 번 새로고침)
   - 다중 경로: http://multipath.test.local/path1, /path2, .../path5

## 문제 해결

### 로그 확인
```bash
# Nginx 로그 확인
docker logs nginx-proxy-test

# 이벤트 감시 로그 확인
docker exec nginx-proxy-test cat /var/log/docker-event-watcher/daemon.log
docker exec nginx-proxy-test cat /var/log/docker-event-watcher/error.log
```

### 설정 확인
```bash
# 생성된 upstream 설정 확인
docker exec nginx-proxy-test ls -la /app/conf.d/upstream.conf/

# 생성된 vhost 설정 확인
docker exec nginx-proxy-test ls -la /app/conf.d/vhost.conf/

# 설정 내용 확인 (예: main.test.local)
docker exec nginx-proxy-test cat /app/conf.d/vhost.conf/vhost-main.test.local.conf
```