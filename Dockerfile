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
RUN npm run build

# ---- the service
FROM python:3.9-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SPHEREX_CACHE_DIR=/data/cache \
    PORT=8000
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
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
