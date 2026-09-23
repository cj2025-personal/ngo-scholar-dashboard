# Multi-stage build for a small, production-ready Next.js image on Cloud Run.
#
# Node 22 to match .nvmrc and the CI workflow.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle AT BUILD TIME, so a
# variable set only on the running container never reaches the browser. Each of
# these has a localhost default in the source; without the build arg that
# default is what ships, and the browser then calls the viewer's own machine —
# which presents as the page loading and every request failing, not as a
# configuration error anyone can see.
#
# NEXT_PUBLIC_AUTH_API_URL is SD-API, not the auth service, whatever the name
# says: its default is http://localhost:4000, which is the port sd-api listens
# on. Point it at the deployed sd-api URL. Setting it to ngo-auth-api instead
# would leave every editorial and story call 404ing, and a 404 on a content
# fetch reads as an empty page rather than as an error.
ARG NEXT_PUBLIC_AUTH_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_DOCS_PORTAL_URL
ENV NEXT_PUBLIC_AUTH_API_URL=${NEXT_PUBLIC_AUTH_API_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_DOCS_PORTAL_URL=${NEXT_PUBLIC_DOCS_PORTAL_URL}

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

# Only the standalone output: server.js plus the node_modules actually reached.
# AUTH_API_URL, AUTH_COOKIE_NAME and SITE_URL are read by the server at request
# time, so they are set on the Cloud Run service rather than baked in here.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
