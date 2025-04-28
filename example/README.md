# Nginx Proxy Watch - 라우팅 테스트 샘플 프로젝트

이 프로젝트는 `nginx-proxy-watch`의 다양한 라우팅 기능을 로컬 환경에서 테스트하기 위해 구성되었습니다. 다음 시나리오들을 포함합니다:

* **기본 Vhost 라우팅**: 특정 호스트 이름으로 들어오는 요청을 지정된 컨테이너로 라우팅합니다.
* **Location 기반 라우팅**: 특정 호스트의 특정 경로로 들어오는 요청을 다른 컨테ainer로 라우팅합니다.
* **Group Host 라우팅**: 여러 서비스(location path)를 하나의 그룹 호스트 아래로 묶어 관리합니다.
* **쿠키 기반 라우팅**: 특정 쿠키의 값에 따라 요청을 다른 컨테이너(업스트림)로 동적으로 라우팅합니다.

## 전제 조건

* **Docker 및 Docker Compose**: 시스템에 Docker와 Docker Compose가 설치되어 있어야 합니다.
* **nginx-proxy-watch 프로젝트**: 쿠키 라우팅 기능이 추가된 `nginx-proxy-watch` 프로젝트 코드가 필요합니다. 이 샘플 프로젝트의 `nginx-proxy` 폴더 안에 해당 프로젝트 파일들을 위치시켜야 합니다. (`index.ts`, `watcher.d.ts` 수정 및 `vhost-cookie-routing-template.ejs` 추가 확인)
* **호스트 파일 수정 권한**: 테스트 도메인을 로컬 IP(127.0.0.1)로 연결하기 위해 시스템의 호스트 파일을 수정할 수 있어야 합니다.

## 설정 방법

1.  **호스트 파일 수정**:
    * 시스템의 호스트 파일(`/etc/hosts` 또는 `C:\Windows\System32\drivers\etc\hosts`)을 엽니다.
    * 아래 내용을 파일 끝에 추가하고 저장합니다.
        ```
        127.0.0.1 main.test.local
        127.0.0.1 group.test.local
        127.0.0.1 cookie.test.local
        ```

## 실행 방법

프로젝트 루트 디렉토리 (`sample-test-project`)에서 다음 명령어를 터미널에 입력합니다. `--build` 옵션은 Docker 이미지를 새로 빌드합니다.

```bash
docker-compose up -d --build
```

## 테스트 시나리오 및 방법
웹 브라우저나 curl과 같은 도구를 사용하여 아래 시나리오를 테스트합니다.

1. 기본 Vhost 라우팅 테스트:
   1. URL: http://main.test.local
   2. 예상 응답: <h1>Hello from Main App!</h1>...
2. Location 기반 라우팅 테스트:
   1. URL: http://main.test.local/api
   2. 예상 응답: <h1>Hello from API App!</h1>...
3. Group Host 및 Location Path 라우팅 테스트:
   1. URL: http://group.test.local/serviceA
   2. 예상 응답: <h1>Hello from Group Service A!</h1>...
4. 쿠키 기반 라우팅 테스트 (cookie.test.local):
   1. 쿠키 없음 또는 매칭 안 됨 (기본 라우팅 - 약국):
      1. URL: http://cookie.test.local
      2. 예상 응답: <h1>Hello from Pharmacy App (Cookie=2/Default)!</h1>...
   2. 쿠키 service_type=1 설정 (병원 라우팅):
      1. 방법 1 (curl): curl -H "Cookie: service_type=1" http://cookie.test.local
      2. 방법 2 (브라우저): 개발자 도구(F12) > Application (or Storage) > Cookies 에서 cookie.test.local 도메인에
      3. service_type 쿠키를 추가하고 값을 1로 설정 후 새로고침합니다.
      4. 예상 응답: <h1>Hello from Hospital App (Cookie=1)!</h1>...
   3. 쿠키 service_type=2 설정 (약국 라우팅):
      1. 방법 1 (curl): curl -H "Cookie: service_type=2" http://cookie.test.local
      2. 방법 2 (브라우저): 위와 동일한 방법으로 쿠키 값을 2로 설정 후 새로고침합니다.
      3. 예상 응답: <h1>Hello from Pharmacy App (Cookie=2/Default)!</h1>...

### 1. 부하 테스트 (Stress Testing)

간단하면서도 효과적인 부하 테스트 도구인 `ab` (Apache Bench)를 사용해 보겠습니다. 대부분의 리눅스 배포판이나 macOS (개발자 도구 설치 시)에 포함되어 있습니다. 없다면 `sudo apt install apache2-utils` (Debian/Ubuntu) 또는 `brew install ab` (macOS) 등으로 설치할 수 있습니다.

**테스트 목표:**

* Nginx 프록시가 높은 부하를 처리할 수 있는지 확인합니다.
* 백엔드 애플리케이션들이 부하 상황에서 정상적으로 응답하는지 확인합니다.
* 로그가 정상적으로 쌓이는지 확인합니다 (로그 로테이션 테스트를 위해).

**테스트 방법:**

호스트 머신(또는 `*.test.local` 도메인을 127.0.0.1로 해석할 수 있는 다른 머신)의 터미널에서 다음 명령어를 실행합니다.

* **기본 Vhost 테스트 (main.test.local):**
    * 동시 요청 100개로 총 10000개의 요청 보내기
    ```bash
    ab -n 10000 -c 100 http://main.test.local/
    ```

* **Location 기반 라우팅 테스트 (main.test.local/api):**
    * 동시 요청 50개로 총 5000개의 요청 보내기
    ```bash
    ab -n 5000 -c 50 http://main.test.local/api
    ```

* **쿠키 기반 라우팅 테스트 (cookie.test.local):**
    * 쿠키 `service_type=1` (병원) 포함하여 동시 50개, 총 5000개 요청
    ```bash
    ab -n 5000 -c 50 -H "Cookie: service_type=1" http://cookie.test.local/
    ```
    * 쿠키 `service_type=2` (약국) 포함하여 동시 50개, 총 5000개 요청
    ```bash
    ab -n 5000 -c 50 -H "Cookie: service_type=2" http://cookie.test.local/
    ```

**모니터링:**

부하 테스트 중 다음 사항을 모니터링합니다.

1.  **컨테이너 리소스 사용량:** 다른 터미널을 열고 `docker stats` 명령어를 실행하여 `nginx-proxy-test` 및 백엔드 앱 컨테이너들의 CPU, 메모리 사용량을 확인합니다.
    ```bash
    docker stats
    ```
2.  **Nginx 에러 로그:** Nginx 에러 로그에 문제가 없는지 확인합니다. 로그 파일 경로는 `docker-compose.yml`의 volumes 설정에 따라 다릅니다. 이전 설정 기준으로는 호스트의 `../nginx-proxy/local_logs/nginx/error.log` 입니다. (프로젝트 루트 기준 상대 경로)
    ```bash
    tail -f <프로젝트_루트>/nginx-proxy/local_logs/nginx/error.log
    ```
3.  **`ab` 결과:** `ab` 명령 실행 완료 후 출력되는 `Requests per second`, `Time per request`, `Failed requests` 등의 지표를 확인합니다. 실패한 요청(Failed requests)이 0에 가까워야 합니다.

### 2. 로그 로테이션 (Log Rotation)

로그 파일이 계속 커지는 것을 방지하기 위해 `logrotate` 유틸리티를 사용합니다. 로그 파일이 호스트 머신에 마운트되어 있으므로, **호스트 머신**에 `logrotate` 설정을 추가하는 것이 가장 간단합니다.

**설정 방법 (호스트 머신에서):**

1.  **`logrotate` 설치 확인/설치:** 대부분의 리눅스 시스템에는 기본 설치되어 있습니다. 없다면 `sudo apt install logrotate` 등으로 설치합니다.

2.  **`logrotate` 설정 파일 생성:** `/etc/logrotate.d/` 디렉토리에 Docker Nginx 프록시 로그를 위한 설정 파일을 생성합니다. (예: `nginx-proxy-docker`)
    ```bash
    sudo nano /etc/logrotate.d/nginx-proxy-docker
    ```

3.  **설정 내용 작성:** 아래 내용을 설정 파일에 붙여넣습니다. **경로는 실제 프로젝트 위치에 맞게 수정해야 합니다.** (예: `/home/user/myproject/nginx-proxy/local_logs/...`)

    ```
    # /etc/logrotate.d/nginx-proxy-docker

    # !!! 중요: 아래 경로는 실제 프로젝트의 절대 경로로 수정하세요 !!!
    /path/to/your/project/root/nginx-proxy/local_logs/nginx/*.log {
        daily          # 매일 로테이션
        size 10M       # 또는 파일 크기가 10MB 이상이면 로테이션
        rotate 7       # 최대 7개의 로테이션된 로그 파일 보관
        compress       # 로테이션된 로그 파일 압축 (gzip)
        delaycompress  # 다음 로테이션 시 압축 (Nginx가 즉시 새 파일 사용 가능)
        missingok      # 로그 파일이 없어도 에러 발생 안 함
        notifempty     # 로그 파일이 비어있으면 로테이션 안 함
        create 0644 root root # 새 로그 파일 생성 권한 (필요시 소유자/그룹 변경)
        sharedscripts  # 여러 로그 파일에 대해 postrotate 스크립트 한 번만 실행
        postrotate
            # Nginx 컨테이너에 로그 파일을 다시 열도록 신호 보내기
            # !!! 중요: 컨테이너 이름(nginx-proxy-test)이 정확한지 확인 !!!
            if [ -f /var/run/docker.pid ]; then
                docker exec nginx-proxy-test nginx -s reopen > /dev/null 2>&1 || true
            fi
        endscript
    }

    # 필요하다면 Watcher 로그도 동일한 방식으로 추가
    # /path/to/your/project/root/nginx-proxy/local_logs/watcher/*.log {
    #     daily
    #     size 5M
    #     rotate 3
    #     compress
    #     delaycompress
    #     missingok
    #     notifempty
    #     create 0644 root root
    #     # Watcher는 별도 reopen 신호가 필요 없을 수 있음 (필요시 해당 프로세스에 맞게 수정)
    # }
    ```

    **주요 설정 설명:**

    * `/path/to/your/project/root/...`: **반드시** 실제 로그 파일이 있는 호스트 경로로 수정해야 합니다.
    * `daily / size 10M`: 둘 중 하나 또는 둘 다 조건을 만족하면 로테이션됩니다.
    * `rotate 7`: `access.log`, `access.log.1`, `access.log.2.gz`, ..., `access.log.7.gz` 와 같이 최대 7개(+원본 1개) 로그 파일을 유지합니다.
    * `compress / delaycompress`: 로테이션된 파일을 압축합니다. `delaycompress`는 Nginx가 즉시 새 파일에 로깅할 수 있도록 압축을 한 단계 늦춥니다.
    * `postrotate`: 로그 파일 로테이션 후 실행될 스크립트입니다.
    * `docker exec nginx-proxy-test nginx -s reopen`: **매우 중요.** Nginx 컨테이너(`nginx-proxy-test`) 내부에서 `nginx -s reopen` 명령을 실행하여, Nginx가 기존 로그 파일 핸들을 닫고 새로 생성된 로그 파일에 쓰도록 합니다. 이 부분이 없으면 로테이션 후 로그가 기록되지 않을 수 있습니다.

4.  **설정 테스트:** `logrotate` 설정을 강제로 실행하여 테스트합니다. `-d` 옵션은 실제로 실행하지 않고 테스트만 하며, `-v` 옵션은 상세 정보를 출력합니다. `-f` 옵션은 강제로 실행합니다.
    ```bash
    # 설정 문법 오류 등 테스트 (실행 안 함)
    sudo logrotate -d /etc/logrotate.d/nginx-proxy-docker

    # 상세 정보와 함께 강제 실행 (실제로 로그 로테이션 수행)
    sudo logrotate -vf /etc/logrotate.d/nginx-proxy-docker
    ```

5.  **결과 확인:** 강제 실행 후 호스트의 로그 디렉토리 (`<프로젝트_루트>/nginx-proxy/local_logs/nginx/`) 에 `access.log.1`, `error.log.1` (압축 설정 시 `.gz` 포함) 등이 생성되었는지 확인합니다. 원본 `access.log`, `error.log` 파일 크기가 줄어들었는지 확인합니다. 로테이션 후 다시 웹 요청을 보내 새 로그 파일에 정상적으로 기록되는지 확인합니다.

### 3. 통합 테스트

1.  **로그 생성:** 먼저 `ab` 등을 이용한 부하 테스트를 잠시 실행하여 로그 파일(`access.log` 등)에 충분한 데이터를 쌓습니다.
2.  **로그 로테이션 실행:** `sudo logrotate -vf /etc/logrotate.d/nginx-proxy-docker` 명령으로 로그 로테이션을 수동 실행합니다.
3.  **로테이션 확인:** 로그 디렉토리에서 파일들이 정상적으로 로테이션되고 압축되었는지 확인합니다.
4.  **로깅 지속 확인:** 다시 `ab` 또는 `curl` 등으로 웹 요청을 보내고, **새로 생성된 (또는 비워진) `access.log` 파일**에 로그가 정상적으로 기록되는지 확인합니다. `docker exec nginx-proxy-test nginx -s reopen` 명령이 성공적으로 실행되었다면 문제없이 기록될 것입니다.
5.  **부하 상태 로테이션:** 가능하다면, `ab` 부하 테스트가 실행 중인 상태에서 `logrotate`를 실행하여 시스템 안정성에 문제가 없는지도 확인해 볼 수 있습니다.

**참고:**

* 호스트 머신에서 `logrotate`를 설정하는 것이 권한 문제가 없다면 가장 간편합니다.
* 호스트 수정이 어렵다면, `logrotate`를 포함하는 별도의 "사이드카(sidecar)" 컨테이너를 띄워 로그 볼륨을 공유하고 해당 컨테이너가 주기적으로 `logrotate`와 `docker exec` 명령을 실행하도록 구성할 수도 있습니다.
* `logrotate` 설정 파일의 경로는 **호스트 머신 기준 절대 경로**를 사용하는 것이 혼동을 줄일 수 있습니다.
* 로그 파일 및 디렉토리의 **소유권/권한** 문제로 `logrotate`나 Nginx 로깅이 실패할 수 있으니 주의가 필요합니다. `create` 지시어의 소유자/그룹 설정을 환경에 맞게 조정해야 할 수 있습니다.

## 문제
컨테이너 내부 logrotate(daily directive) 가 동작하지 않습니다. cron 문제로 추정되어 외부에서 직접 rorate를 해주어야합니다.  

### 수동 Logrotate
`hourly_logrotate.sh` 파일 작성