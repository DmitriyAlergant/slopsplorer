# Build stage for the corpus.
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json ./
RUN npm ci --ignore-scripts   # deterministic install

# Runtime stage.
FROM node:22-alpine
COPY --from=build /app /app
CMD ["node", "index.js"]
