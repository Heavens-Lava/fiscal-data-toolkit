# Zero-dependency Node app — no `npm install` needed.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
