FROM node:23.11.0-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY ./app-common/server.js ./app-common/server.js
COPY ./app-group-service-a/server.js ./server.js
ENV PORT=8083
EXPOSE 8083

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8083/health || exit 1

CMD [ "node", "server.js" ]