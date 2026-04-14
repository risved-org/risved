FROM oven/bun:1

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ nodejs npm \
    && rm -rf /var/lib/apt/lists/*
