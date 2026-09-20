# Planty Slicer — static, browser-based slicer for the Flashforge Adventurer 5M.
# Stage 1 builds the site; stage 2 serves it with nginx (works standalone and as
# a Home Assistant add-on with Ingress). Build context = this directory.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
# The workspace lockfile lives in the repository root; install from package.json here.
RUN npm install --no-audit --no-fund --no-package-lock
COPY index.html vite.config.ts tsconfig.json ./
COPY src src
COPY tests tests
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8099/ || exit 1
