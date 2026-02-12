FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node","src/server.js"]ARG CACHE_BUST=20260211-205440
