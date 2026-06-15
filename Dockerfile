FROM node:20-alpine

WORKDIR /app

# Copy everything (excluding .dockerignore patterns)
COPY . .

# Install dependencies and build all packages
RUN npm ci
RUN npm run build -w @network-chess/core
RUN npm run build -w @network-chess/engine
RUN npm run build -w @network-chess/client
RUN npm run build -w @network-chess/server

# Remove dev dependencies to slim down the image
RUN npm prune --omit=dev

EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production

CMD ["sh", "-c", "npm run prisma:migrate -w @network-chess/server && node packages/server/dist/index.js"]


