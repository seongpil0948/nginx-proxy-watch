# ---- Builder Stage ----
# Use the same base or consider a dedicated Node image (e.g., node:23-slim)
FROM nginx:stable-otel AS builder

LABEL stage="builder"
USER 0
WORKDIR /app

# Install build dependencies: curl, wget, unzip for NodeSource script and potential downloads, gnupg for repo keys
RUN apt-get update && \
        apt-get install -y curl wget unzip gnupg && \
        # Install Node.js (using NodeSource method from original Dockerfile)
        # Consider using a specific Node.js version or a dedicated Node base image for better control
        curl -fsSL https://deb.nodesource.com/setup_23.x | bash - && \
        apt-get install -y nodejs && \
        # Install global build tools
        npm install -g typescript webpack-cli webpack && \
        # Clean up apt cache
        apt-get clean && \
        rm -rf /var/lib/apt/lists/*

# Copy package files first for dependency caching
COPY project/package*.json ./project/

# Install project dependencies (use --only=production if applicable, or install all for build)
# Using ci is generally recommended if you have a package-lock.json
# RUN cd project && npm ci
# Or using install:
RUN cd project && npm install

# Copy the rest of the project source code
COPY project/ ./project/

# Build the application using webpack
# Ensure your package.json has a 'build' script or adjust this command
# RUN cd project && npm run build
# Using the direct webpack command from original Dockerfile:
RUN cd project && webpack

# ---- Final Stage ----
FROM nginx:stable-otel

LABEL category="nginx"
USER 0
ENV TZ=Asia/Seoul

# Install RUNTIME dependencies only (logrotate)
RUN apt-get update && \
        apt-get install -y logrotate && \
        # Clean up apt cache
        apt-get clean && \
        rm -rf /var/lib/apt/lists/*

# Create necessary directories (Combine mkdir)
# Ensure all necessary parent directories are created (-p flag helps)
RUN mkdir -p /app/conf.d/upstream.conf \
        /app/conf.d/vhost.conf \
        /app/conf.d/location.conf \
        /var/log/docker-event-watcher \
        /etc/nginx/dhparam \
        /web \
        /app/scripts \
        /app/templates \
        /app/project \
        /lib/systemd/system \
        /etc/init.d \
        /docker-entrypoint.d \
        /usr/local/share/ca-certificates # Keep if HQSSL needed

# Copy configurations, templates, scripts, service files, dhparam from the build context
COPY conf/nginx.conf /etc/nginx/nginx.conf
COPY conf/nginx /etc/logrotate.d/
COPY conf/docker-event-watcher-logrotate /etc/logrotate.d/
COPY conf/nginx-proxy-watch-logrotate /etc/logrotate.d/
COPY conf/error.html /web/error.html
COPY scripts/ /app/scripts/
COPY templates/ /app/templates/
COPY services /lib/systemd/system/
COPY services/docker-event-watcher /etc/init.d/
COPY scripts/docker-entrypoint.d/40-docker-event-watcher.sh /docker-entrypoint.d/
COPY dhparam/dhparam.pem /etc/nginx/dhparam/
# Uncomment if you need the certificates
# COPY    ./HQSSL_2020.cer /usr/local/share/ca-certificates/

# Copy ONLY the built artifacts from the builder stage
# !!! IMPORTANT: Adjust '/app/project/dist' if your webpack output is different !!!
COPY --from=builder /app/project/dist /app/project/dist
# If the watcher script itself needs node_modules at runtime (less common with webpack),
# you might need to copy node_modules from the builder stage:
# COPY --from=builder /app/project/node_modules /app/project/node_modules

# Set permissions and ownership (Combine related chmod/chown)
RUN chmod 644 /etc/logrotate.d/nginx && \
        chmod -R 644 /etc/logrotate.d && \
        chown -R root:root /etc/logrotate.d && \
        # Link the watcher script and set executable permissions
        ln -s /app/scripts/docker-event-watcher /usr/bin/docker-event-watcher && \
        chmod 755 /usr/bin/docker-event-watcher && \
        chmod a+x /etc/init.d/docker-event-watcher && \
        chmod a+x /docker-entrypoint.d/40-docker-event-watcher.sh && \
        chmod a-x /lib/systemd/system/docker-event-watcher.service && \
        # Register init.d service (if applicable in container)
        update-rc.d docker-event-watcher defaults && \
        # Create log files and set permissions
        mkdir -p /var/log/docker-event-watcher && \
        touch /var/log/docker-event-watcher/daemon.log \
        /var/log/docker-event-watcher/access.log \
        /var/log/docker-event-watcher/error.log \
        /var/log/docker-event-watcher/debug.log && \
        chmod -R 755 /var/log/docker-event-watcher && \
        chown -R root:root /var/log/docker-event-watcher
# Uncomment if you need to update certificates
# update-ca-certificates
