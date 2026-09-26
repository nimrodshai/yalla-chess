# node:sqlite needs Node 22.5+; 24 has it unflagged.
FROM node:24-alpine

# No dependencies to install, so there is no package manager step.
WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY index.html logo.png dolev.jpeg placeholder.mp4 ./

# The database lives on a mounted volume, not in the image layer.
ENV DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8001 \
    NODE_ENV=production
VOLUME ["/data"]

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run the server directly as PID 1; it handles SIGTERM itself.
CMD ["node", "server.mjs"]
