FROM golang:1.23.2-alpine AS builder
WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/ops-api ./cmd/ops-api
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/migrate ./cmd/migrate

FROM alpine:3.20
WORKDIR /app
RUN addgroup -S ops && adduser -S ops -G ops

COPY --from=builder /bin/ops-api /bin/ops-api
COPY --from=builder /bin/migrate /bin/migrate
COPY migrations /app/migrations

USER ops
EXPOSE 8080
ENTRYPOINT ["/bin/ops-api"]
