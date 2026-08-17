# 构建与装依赖用 Bun（快、免 tsx）；生产运行时保持 Node——
# node:sqlite（Better Auth 存储）、@hono/node-server 均以 Node 为验证基线
FROM oven/bun:1.3-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY result_view/package.json ./result_view/package.json
COPY widget/package.json ./widget/package.json
COPY console/package.json ./console/package.json
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY result_view ./result_view
COPY widget ./widget
COPY console ./console
RUN bun run build

FROM oven/bun:1.3-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY result_view/package.json ./result_view/package.json
COPY widget/package.json ./widget/package.json
COPY console/package.json ./console/package.json
RUN bun install --frozen-lockfile --production

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
