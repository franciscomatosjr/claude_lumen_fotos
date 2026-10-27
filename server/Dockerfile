# API image: compiles the TypeScript once, then runs on plain Node.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 8787
HEALTHCHECK --interval=5s --timeout=3s --start-period=60s --retries=5 CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "dist/index.js"]
