FROM golang:1.23.2-alpine AS builder
WORKDIR /app

ARG GOPROXY=https://goproxy.cn,direct
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
