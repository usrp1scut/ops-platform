# Standalone frontend image.
#
# Stage 1 builds the Vite/React app. The output is then served by nginx in
# stage 2, which also reverse-proxies the API routes (/api, /auth, /healthz,
# /ws) to whatever ops-api hostname the container can resolve. The default
# upstream `ops-api:8080` works inside docker-compose; production overrides
# it via the OPS_API_UPSTREAM build/run arg below.
#
# Why a separate image at all (vs. the all-in-one ops-api binary that
# already embeds /portal/)?
#   - Lets the frontend scale and roll independently of the backend.
#   - Cleaner CDN / cache story: nginx serves hashed assets with
#     immutable-cache headers without the Go binary in the path.
#   - Frontend changes don't need a Go rebuild + restart, just an image
#     rebuild.
#
# The all-in-one path stays usable for dev and small deployments via the
# top-level Dockerfile; production should prefer this image + the API-only
# ops-api image deployed independently.

FROM node:20-alpine AS build
WORKDIR /app
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} \
    http_proxy=${HTTP_PROXY} https_proxy=${HTTPS_PROXY}

# Install deps first so they cache independently of the source changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# VITE_BASE is the public path the SPA will be served from. Default is the
# domain root (`/`) so the standalone deployment is the canonical shape;
# set to `/portal/` when reusing this build under a sub-path.
ARG VITE_BASE=/
RUN VITE_BASE=${VITE_BASE} npm run build


FROM nginx:1.27-alpine

# Upstream API host:port. Defaults to the docker-compose service name; in
# production set to your ops-api ingress or internal DNS.
ARG OPS_API_UPSTREAM=ops-api:8080
ENV OPS_API_UPSTREAM=${OPS_API_UPSTREAM}

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# nginx:alpine's default entrypoint already runs envsubst over files under
# /etc/nginx/templates and writes them to /etc/nginx/conf.d. We rely on
# that so OPS_API_UPSTREAM can be tweaked at run-time without rebuilding.

EXPOSE 80
