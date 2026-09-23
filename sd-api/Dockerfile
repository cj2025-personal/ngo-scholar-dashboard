# syntax=docker/dockerfile:1
#
# sd-api on Cloud Run.
#
# Node 22 to match .nvmrc and the CI workflow. The rest of the estate is on
# node:20-slim; this service is the one that pins 22, and a runtime older than
# the one its tests run against is not a saving worth making.

FROM node:22-slim

WORKDIR /usr/src/app

# Lockfile first, so a source-only change reuses the dependency layer.
COPY package*.json ./
RUN npm ci --omit=dev

# src/ only. `config/` holds a service account key on a developer's machine and
# is gitignored; on Cloud Run the runtime service account supplies credentials
# through ADC, so no key file belongs in this image. `tests/`, `tests-e2e/`,
# `evals/` and `scripts/` are not reached by the server.
COPY src ./src

ENV NODE_ENV=production

# Cloud Run sets PORT and the server reads it (config/env.js defaults to 4000
# for local use). Declared for documentation; Cloud Run's value wins.
ENV PORT=8080
EXPOSE 8080

# Build-time metadata, never a secret.
ARG COMMIT_SHA=local
ENV COMMIT_SHA=${COMMIT_SHA}

USER node

CMD ["node", "src/index.js"]
