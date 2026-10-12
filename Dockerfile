# Orbit Sync Server – kør selv med Docker
FROM node:20-alpine

WORKDIR /app
COPY server/sync-server.mjs ./sync-server.mjs
COPY package.json ./package.json

ENV PORT=4320
EXPOSE 4320

# Kør med token:  docker run -e ORBIT_SYNC_TOKEN=hemmeligt -p 4320:4320 orbit-sync
CMD ["node", "sync-server.mjs"]
