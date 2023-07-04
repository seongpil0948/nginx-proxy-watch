FROM nginx

LABEL category="nginx"
USER    0

ENV     TZ Asia/Seoul

# COPY    ./HQSSL_2020.cer /opt/
# COPY    ./HQSSL_2020.cer /usr/local/share/ca-certificates

RUN     mkdir /app /app/conf.d /app/conf.d/upstream.conf /app/conf.d/vhost.conf /var/log/docker-event-watcher /etc/nginx/dhparam
COPY    conf/nginx.conf /etc/nginx/nginx.conf
COPY    conf/nginx /etc/logrotate.d/
COPY    conf/index.html /web/html
COPY    scripts/ /app/scripts/
COPY    templates/ /app/templates/
COPY    project /app/project/
COPY    services /lib/systemd/system
COPY    services/docker-event-watcher /etc/init.d/
COPY    scripts/docker-entrypoint.d/40-docker-event-watcher.sh /docker-entrypoint.d/
COPY    dhparam/dhparam.pem /etc/nginx/dhparam/

RUN     apt-get update && \
        apt-get install -y curl && \
        curl -fsSL -k https://deb.nodesource.com/setup_16.x | bash -  && \
        apt-get install -y nodejs npm wget unzip logrotate && \
        apt-get clean

RUN     npm -v && \
        npm config set strict-ssl false && \
        npm install -g typescript webpack-cli webpack

# BUILD EVENT WATCHER
RUN     cd /app/project && \
        npm install && \
        webpack && ln -s /app/scripts/docker-event-watcher /usr/bin/docker-event-watcher && \
        chmod 755 /usr/bin/docker-event-watcher

RUN     chmod a+x /etc/init.d/docker-event-watcher && \
        chmod a+x /docker-entrypoint.d/40-docker-event-watcher.sh && \
        chmod a-x /lib/systemd/system/docker-event-watcher.service && \
        update-rc.d docker-event-watcher defaults
