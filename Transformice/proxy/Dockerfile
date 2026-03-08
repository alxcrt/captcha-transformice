FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

EXPOSE 11801 12801 13801 14801 8081 8082

CMD ["node", "dist/index.js"]
