FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY vendor ./vendor
RUN npm run build && cp -r vendor dist/vendor
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
