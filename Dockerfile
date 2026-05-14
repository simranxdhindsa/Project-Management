# ─────────────────────────────────────────────────────────────
# Stage 1: Build Go backend
# ─────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS go-builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o server \
    .


# ─────────────────────────────────────────────────────────────
# Stage 2: Build Vite frontend
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

ARG VITE_API_URL=/api
ARG VITE_GOOGLE_CLIENT_ID=

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .

ENV VITE_API_URL=$VITE_API_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build


# ─────────────────────────────────────────────────────────────
# Stage 3: Runtime image
# ─────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata nginx curl

WORKDIR /app

# Go backend binary
COPY --from=go-builder /app/server /app/server

# Vite static build
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html

# nginx config and entrypoint
COPY nginx.conf    /etc/nginx/nginx.conf
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV PORT=8081 \
    ENVIRONMENT=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://localhost:8080/api/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]