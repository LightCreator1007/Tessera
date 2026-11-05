# Image for one ToD app (APP=node or APP=verifier): Python 3.12 plus the app, installed from the uv lockfile.
FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /usr/local/bin/uv
ARG APP
# Use the image's own Python and copy packages into the venv, so the venv works without uv's cache.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PATH=/app/.venv/bin:$PATH
# Keys and node state live on the volume, so they survive container replacement.
ENV TOD_DATA=/data
WORKDIR /app
COPY . .
RUN test -n "$APP" \
 && uv sync --locked --no-dev --package "tod-$APP" \
 && ln -s "/app/.venv/bin/tod-$APP" /usr/local/bin/tod-app \
 && useradd --create-home --uid 10001 tod \
 && mkdir /data && chown tod /data
USER tod
VOLUME /data
ENTRYPOINT ["tod-app"]
