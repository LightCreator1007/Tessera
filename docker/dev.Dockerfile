# Dev image for docker/compose.dev.yml: the whole workspace plus anvil and forge, one image for every local service.
FROM ghcr.io/foundry-rs/foundry@sha256:3a392c18f9b16e665e932de159fb6fa9ed972c4b4352f2f76a1a8c7ca9b57d39 AS foundry

FROM python:3.12-slim-bookworm
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/anvil /usr/local/bin/
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /usr/local/bin/uv
# deploy.py regenerates the ABI package with a stdlib-only Node script.
COPY --from=node:22.11.0-bookworm-slim /usr/local/bin/node /usr/local/bin/node
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PATH=/app/.venv/bin:$PATH
# Same single-thread numerics as the release image, so a round here behaves like one on a node.
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
WORKDIR /app
COPY . .
# Contracts compiled at build time, so the deploy step starts in seconds (contracts/lib must be checked out).
RUN uv sync --locked --all-packages --no-dev && cd contracts && forge build && node ../packages/abi/scripts/generate.mjs
