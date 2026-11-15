# SPHEREx blink viewer: one container, the API and the built web app on one port.
# Build:  docker build -t spherex-viewer .
# Run:    docker run --rm -p 8000:8000 -v spherex-cache:/data spherex-viewer
# See docs/deploy.md for hosting notes.

# ---- build the web app
FROM node:20-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# vite.config.js loads the dev-only mock, which reads these two files even for a production build; they are not copied into the final image from here.
COPY fixtures/ /src/fixtures/
COPY verify/targets.json /src/verify/targets.json
RUN npm run build

# ---- the service
FROM python:3.9-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SPHEREX_CACHE_DIR=/data/cache \
    PORT=8000
WORKDIR /app
COPY requirements.txt ./
# numcodecs (pulled in by reproject) has no prebuilt wheel on some platforms (seen on arm64), so a compiler is installed for the install only.
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
 && pip install -r requirements.txt \
 && apt-get purge -y gcc libc6-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY api/ api/
COPY pipeline/ pipeline/
COPY contracts/ contracts/
COPY static/ static/
COPY verify/targets.json verify/targets.json
COPY --from=web /src/web/dist web/dist
# A folder the service may write to (remembered archive searches); mount a volume here to keep them across restarts.
RUN useradd --create-home app && mkdir -p /data/cache && chown -R app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/api/targets' % os.environ.get('PORT','8000'), timeout=4)"
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
