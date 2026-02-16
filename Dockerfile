FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ARG DOCKER_CACHE_BUST=0
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 10000
CMD ["node","src/server.js"]
