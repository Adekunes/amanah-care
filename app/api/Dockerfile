FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js app.js bus.js redisbus.js ./
COPY routes ./routes
EXPOSE 4000
CMD ["node","server.js"]
