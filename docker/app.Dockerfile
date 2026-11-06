# Image for one ToD app (APP=node, verifier or coordinator): Python 3.12 plus the app, installed from the uv lockfile.
# The ledger loads these two ABIs at runtime and they're generated, not in git. The interfaces import nothing, so no
# submodules are needed. The stage runs on the build machine, so arm64 images don't compile under QEMU.
FROM --platform=$BUILDPLATFORM ghcr.io/foundry-rs/foundry@sha256:3a392c18f9b16e665e932de159fb6fa9ed972c4b4352f2f76a1a8c7ca9b57d39 AS abi
USER root
WORKDIR /src
COPY contracts/src/IJobMarket.sol contracts/src/INodeRegistry.sol contracts/src/
RUN mkdir /abi && for n in IJobMarket INodeRegistry; do \
      forge inspect "contracts/src/$n.sol:$n" abi --json --use 0.8.38 > "/abi/$n.json"; done

FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /usr/local/bin/uv
ARG APP
# Use the image's own Python and copy packages into the venv, so the venv works without uv's cache.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PATH=/app/.venv/bin:$PATH
# Keys and node state live on the volume, so they survive container replacement.
ENV TOD_DATA=/data
# The spec runs training on one CPU thread; keep numeric libraries from starting a pool per core.
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
# The wrapper publishes 7777 on the host's 127.0.0.1 only, so the node's local API listens on every interface in here.
ENV TOD_API_BIND=0.0.0.0:7777
# Already a container, so train in-process; a node installed on the host trains in a container instead.
ENV TOD_SANDBOX=off
WORKDIR /app
COPY . .
COPY --from=abi /abi packages/abi/json
# The coordinator has no CLI of its own; docker/compose.prod.yml starts it with uvicorn.
RUN test -n "$APP" \
 && uv sync --locked --no-dev --package "tod-$APP" \
 && { [ "$APP" = coordinator ] || ln -s "/app/.venv/bin/tod-$APP" /usr/local/bin/tod-app; } \
 && useradd --create-home --uid 10001 tod \
 && mkdir /data && chown tod /data
USER tod
VOLUME /data
ENTRYPOINT ["tod-app"]
