FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY users.yaml ./users.yaml
RUN useradd --system --create-home app && chown -R app:app /app
USER app
EXPOSE 7999
CMD ["node", "dist/index.js"]
