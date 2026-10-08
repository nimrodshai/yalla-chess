# node:sqlite needs Node 22.5+; 24 has it unflagged.
FROM node:24-alpine

# Litestream replicates the SQLite file to object storage so the service can
# run on hosts without a persistent disk (Render's free tier). The upstream
# image ships a statically linked binary, so it runs on Alpine as is. It only
# activates when LITESTREAM_BUCKET is set; see deploy/entrypoint.sh.
COPY --from=litestream/litestream:0.5.17 /usr/local/bin/litestream /usr/local/bin/litestream
COPY deploy/litestream.yml /etc/litestream.yml

# No dependencies to install, so there is no package manager step.
WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY index.html logo.png dolev.jpeg placeholder.mp4 ./
COPY deploy/entrypoint.sh ./entrypoint.sh

# The database lives on a mounted volume, not in the image layer. Without a
# volume the entrypoint restores it from the Litestream replica instead.
ENV DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8001 \
    NODE_ENV=production
VOLUME ["/data"]

RUN mkdir -p /data && chown -R node:node /data /app && chmod +x /app/entrypoint.sh
USER node

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint execs either the server (PID 1, handles SIGTERM itself) or
# litestream with the server as its child (litestream forwards SIGTERM).
ENTRYPOINT ["/app/entrypoint.sh"]
