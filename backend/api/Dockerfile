FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

FROM base AS development
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "run", "dev"]

FROM base AS production
RUN npm ci --only=production
COPY . .
EXPOSE 5000
CMD ["node", "src/index.js"]
