FROM node:22

# Native compilation toolchain (matches the old node-builder so projects with
# node-gyp dependencies keep working).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Corepack ships with Node. Pre-prepare pnpm and both yarn lines at image-build
# time so deploys never hit the network on first use of corepack.
RUN corepack enable \
    && corepack prepare pnpm@latest --activate \
    && corepack prepare yarn@stable --activate \
    && corepack prepare yarn@1 --activate

# Bun is not managed by Corepack, install directly.
RUN npm install -g bun

# Projects without a `packageManager` field fall back to the latest version
# Corepack resolves at install time.
ENV COREPACK_DEFAULT_TO_LATEST=1
