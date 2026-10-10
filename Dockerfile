# syntax=docker/dockerfile:1
#
# Builds torrented from source. The result is a small Alpine image with a
# statically linked binary and ffmpeg (for remuxing and file scanning).
#
#   docker build -t torrented .
#   docker run -p 8080:8080 -p 6881:6881 -p 6881:6881/udp -v torrented-data:/data torrented

FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM rust:1-alpine AS server
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY vendor ./vendor
COPY server ./server
COPY --from=web /src/web/dist ./web/dist
ENV TORRENTED_SKIP_WEB_BUILD=1
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked \
    && cp target/release/torrented /usr/local/bin/torrented

FROM alpine:3.22
RUN apk add --no-cache ffmpeg ca-certificates tzdata \
    && addgroup -S -g 1000 torrented \
    && adduser -S -D -H -u 1000 -G torrented torrented \
    && mkdir /data \
    && chown torrented:torrented /data
COPY --from=server /usr/local/bin/torrented /usr/local/bin/torrented

USER torrented
ENV TORRENTED_DATA_DIR=/data \
    TORRENTED_LISTEN=0.0.0.0:8080 \
    TORRENTED_PEER_PORT=6881
VOLUME /data
EXPOSE 8080 6881/tcp 6881/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD wget -qO /dev/null "http://127.0.0.1:${TORRENTED_LISTEN##*:}/api/instance" || exit 1
ENTRYPOINT ["torrented"]
