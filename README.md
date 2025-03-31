
# nginx-proxy-watch 프로젝트

Docker 컨테이너 이벤트를 모니터링하고, Nginx 설정을 자동 생성하여, 동적 리버스 프록시 서버를 생성합니다.

## 주요 기능  

- **Docker 이벤트 모니터링**: Docker API를 통해 컨테이너 시작/중지 이벤트를 감지합니다.  
- **자동 Nginx 설정 생성**: 환경 변수를 분석해 upstream, vhost, location 설정 파일을 동적으로 생성합니다.  
- **SSL 지원**: HTTPS 인증서를 자동 적용합니다.  
- **다중 호스트 지원**: 여러 도메인을 하나의 Nginx 인스턴스로 관리합니다.  

## 작동 방식  
1. Docker API를 통해 컨테이너 이벤트를 구독합니다.  
2. 컨테이너가 시작되면 `VIRTUAL_` 접두사를 가진 환경 변수를 분석합니다.  
3. EJS 템플릿 엔진을 사용해 Nginx 설정 파일을 생성합니다.  
4. 설정이 변경될 때마다 Nginx를 자동으로 리로드합니다.  

## 주요 컴포넌트  

- **Docker 이벤트 리스너** (`index.ts`) → Docker API 클라이언트  
- **템플릿 엔진** (EJS) → `upstream-template.ejs`, `vhost-template.ejs`, `location-template.ejs`  
- **Nginx 서버** → 리버스 프록시 역할  
- **로깅 시스템** → Winston 기반 (`logging.ts`)  

## 환경 변수 설정  

컨테이너는 다음 환경 변수로 Nginx 설정을 제어합니다:  

- `VIRTUAL_HOST`: 서비스할 도메인  
- `VIRTUAL_PORT`: 내부 포트 (기본값: 80)  
- `VIRTUAL_SSL`, `VIRTUAL_CERT`: SSL 인증서 설정  
- `VIRTUAL_IS_LOCATION`: 위치 기반 라우팅 여부  
- `VIRTUAL_LOCATION`: 여러 경로 설정 (`host:path` 형식)  
- `VIRTUAL_GROUP_HOST`: 그룹화할 호스트  

## 기술 스택 및 특징  

- **Node.js + TypeScript**로 개발  
- **Dockerode** 라이브러리를 사용해 Docker API와 연동  
- **systemd 및 init.d** 스크립트 지원  
- **logrotate** 설정으로 로그 관리 자동화  

이 프로젝트는 마이크로서비스 및 컨테이너 기반 배포 환경에서 유용합니다. 컨테이너 추가·제거 시 Nginx 설정을 수동으로 관리할 필요 없이 자동으로 라우팅이 구성됩니다.  

추가 질문이 있으시면 언제든지 말씀해 주세요.