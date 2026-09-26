FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm cache clean --force 2>/dev/null; npm install
COPY . .
ARG NEXT_PUBLIC_PB_URL
ENV NEXT_PUBLIC_PB_URL=$NEXT_PUBLIC_PB_URL
# Next bakes rewrites() at build time, so the ledger proxy target must be
# present here (not only as a runtime env). NAS build passes
# --build-arg FINANCE_DASHBOARD_URL=http://finance-dashboard.
ARG FINANCE_DASHBOARD_URL
ENV FINANCE_DASHBOARD_URL=$FINANCE_DASHBOARD_URL
ARG NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS=false
ENV NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS=$NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS
RUN npm run build

FROM builder AS seed
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_PUBLIC_CANONICAL_MEMBER_FALLBACKS=false
CMD ["npm", "run", "pb:seed"]

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# The on-disk MUSE API reference is read at request time by /api/muse/docs.
# It is in the builder (COPY . . includes it) and COPY --from is not affected
# by .dockerignore, so docs/muse-api.md survives the `*.md` ignore rule.
COPY --from=builder /app/docs ./docs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["npm", "run", "start"]
