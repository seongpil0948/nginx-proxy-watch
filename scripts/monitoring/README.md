!아직 테스트 안된 스크립트입니다!

1. **monitor-logs.sh** - 기본 로그 파일 확인 스크립트
   ```bash
   # 일반 모니터링
   ./monitor-logs.sh watcher   # watcher 로그 확인
   ./monitor-logs.sh nginx     # nginx 로그 확인
   ./monitor-logs.sh all       # 모든 로그 확인
   
   # 실시간 모니터링
   ./monitor-logs.sh live-watcher  # watcher 로그 실시간 모니터링
   ./monitor-logs.sh live-nginx    # nginx 로그 실시간 모니터링
   ```

2. **journalctl-docker-monitor.sh** - systemd 서비스 및 Docker 컨테이너 모니터링
   ```bash
   ./journalctl-docker-monitor.sh docker-event-watcher  # 서비스 상태와 로그 확인
   ./journalctl-docker-monitor.sh nginx-proxy-watch     # 컨테이너 상태와 로그 확인
   ./journalctl-docker-monitor.sh docker-live           # 컨테이너 실시간 로그
   ```

3. **log-summary.sh** - 로그 분석 및 요약 스크립트
   ```bash
   ./log-summary.sh hour       # 최근 1시간 로그 요약
   ./log-summary.sh today      # 오늘 로그 요약
   ./log-summary.sh yesterday  # 어제 로그 요약
   ```

4. **setup-monitoring.sh** - 모든 스크립트 설치 및 cron 작업 설정
   ```bash
   ./setup-monitoring.sh /opt/monitoring  # 지정 경로에 스크립트 설치
   ```

설치 후 명령어:
```bash
# 스크립트 설치 및 설정
chmod +x *.sh
sudo ./setup-monitoring.sh

# 전역 명령어로 사용
monitor-logs all
docker-monitor all
log-summary today
```