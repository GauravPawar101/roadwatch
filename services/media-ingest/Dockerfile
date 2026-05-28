FROM node:18-slim
WORKDIR /usr/src/app
COPY package.json .
RUN npm ci --only=prod
COPY src ./src
EXPOSE 4000
CMD ["node", "src/index.js"]
