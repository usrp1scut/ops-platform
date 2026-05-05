# Stage 1: build the React/Vite web app. The output is consumed by the Go
# embed in stage 2 and served at /portal/. Cached separately from the Go
# layers because npm install is the slow step.
FROM node:20-alpine AS web-builder
WORKDIR /app/web

ARG VITE_BASE=/portal/
ENV VITE_BASE=${VITE_BASE}

ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${HTTP_PROXY}
ENV https_proxy=${HTTPS_PROXY}

COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
RUN npm run build

# Stage 2: build the Go binaries. The web build output is overlaid onto the
# embed directory (replacing the committed placeholder.html) before go build
# runs so /portal/ serves the real React app.
FROM golang:1.25-alpine AS builder
WORKDIR /app

ARG GOPROXY=https://proxy.golang.org,direct
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV GOPROXY=${GOPROXY}
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${HTTP_PROXY}
ENV https_proxy=${HTTPS_PROXY}

COPY go.mod ./
RUN go mod download

COPY . .
COPY --from=web-builder /app/web/dist/. ./internal/httpserver/ui/v2/static/

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/ops-api ./cmd/ops-api
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/migrate ./cmd/migrate
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/ops-worker ./cmd/ops-worker
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/bastion-probe ./cmd/bastion-probe

FROM alpine:3.20
WORKDIR /app
RUN addgroup -S ops && adduser -S ops -G ops

ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${HTTP_PROXY}
ENV https_proxy=${HTTPS_PROXY}

COPY --from=builder /bin/ops-api /bin/ops-api
COPY --from=builder /bin/migrate /bin/migrate
COPY --from=builder /bin/ops-worker /bin/ops-worker
COPY --from=builder /bin/bastion-probe /bin/bastion-probe
COPY migrations /app/migrations

USER ops
EXPOSE 8080
ENTRYPOINT ["/bin/ops-api"]
