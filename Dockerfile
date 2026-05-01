# =============================================================================
# Affiliate Bot — multi-stage Bun image
# Built for: scheduler (long-running) + ad-hoc CLI tasks
# =============================================================================

# ---- Stage 1: deps ----
FROM oven/bun:1.1-alpine AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production=false

# ---- Stage 2: build (typecheck) ----
FROM deps AS build
COPY . .
# Typecheck (catches errors before deploy; fast)
RUN bun run typecheck || (echo "TypeScript errors — fix before deploy" && exit 1)

# ---- Stage 3: runtime ----
FROM oven/bun:1.1-alpine AS runtime
WORKDIR /app

# System deps for Playwright (used by some scrapers — optional Phase 2+)
RUN apk add --no-cache \
    postgresql-client \
    ca-certificates \
    tzdata \
    bash \
  && rm -rf /var/cache/apk/*

ENV TZ=Asia/Bangkok

# Copy from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts

# Mark scripts executable
RUN chmod +x ./scripts/*.sh

# Run as non-root for safety
RUN addgroup -S bot && adduser -S bot -G bot \
  && chown -R bot:bot /app
USER bot

# Healthcheck: scheduler should keep responding to "ps"
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -f "bun run src/scheduler" > /dev/null || exit 1

# Default command: scheduler (override with docker-compose for one-shot tasks)
CMD ["bun", "run", "src/scheduler/index.ts"]
