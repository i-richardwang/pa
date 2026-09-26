# 构建用 Bun；生产运行时用 Node，node:sqlite（Better Auth 存储）与 @hono/node-server 以 Node 为验证基线
FROM oven/bun:1.4.0-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY result_view/package.json ./result_view/package.json
COPY widget/package.json ./widget/package.json
COPY console/package.json ./console/package.json
RUN bun ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY result_view ./result_view
COPY widget ./widget
COPY console ./console
RUN bun run build

FROM oven/bun:1.4.0-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY result_view/package.json ./result_view/package.json
COPY widget/package.json ./widget/package.json
COPY console/package.json ./console/package.json
RUN bun ci --production

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/widget/dist ./widget/dist
COPY --from=build /app/console/dist ./console/dist
EXPOSE 8788
CMD ["node", "dist/index.js"]
