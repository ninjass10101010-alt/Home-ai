FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG NEXT_PUBLIC_PB_URL
ARG NEXT_PUBLIC_OPENCLAW_BRIDGE_URL
ENV NEXT_PUBLIC_PB_URL=$NEXT_PUBLIC_PB_URL
ENV NEXT_PUBLIC_OPENCLAW_BRIDGE_URL=$NEXT_PUBLIC_OPENCLAW_BRIDGE_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["npm", "run", "start"]
