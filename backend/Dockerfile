FROM golang:1.24-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
ARG COMMIT_HASH="dev"
ARG BUILD_TIME="unknown"
RUN go build -ldflags "-X main.CommitHash=${COMMIT_HASH} -X main.BuildTime=${BUILD_TIME}" -o nimconnect-backend .

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/nimconnect-backend .
EXPOSE 8787
ENV PORT=8787
ENV BACKUP_DIR=/data/backups
ENTRYPOINT ["./nimconnect-backend"]
