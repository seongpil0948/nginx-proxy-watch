FROM node:23.11.0-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-main/server.js ./server.js
ENV PORT=8080
EXPOSE 8080

# 헬스체크 추가 - 30초 간격으로 /health 엔드포인트를 호출하고, 
# 3번 실패하면 unhealthy로 간주, 5초 타임아웃
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD [ "node", "server.js" ]