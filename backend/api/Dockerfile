FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS development
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup
RUN npm install --legacy-peer-deps
COPY --chown=appuser:appgroup . .
USER appuser
EXPOSE 5000
CMD ["npm", "run", "dev"]

FROM base AS production
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup
RUN npm install --omit=dev --legacy-peer-deps
COPY --chown=appuser:appgroup . .
USER appuser
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:5000/api/health/live').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"]
CMD ["node", "src/index.js"]
