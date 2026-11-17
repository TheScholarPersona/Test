# Build-Kontext: Wurzel des Repositorys (siehe docker-compose.yml)
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Optional: zusätzliche Zertifizierungsstelle (z. B. Firmen-Proxy) als Build-Secret
#   docker build --secret id=extra_ca,src=/pfad/ca.crt ...
# Das Zertifikat wird nur während des Builds eingebunden, nicht im Image gespeichert.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile --filter "@wms/api..." --filter "@wms/web..."
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
# API und Oberfläche bauen, nur die Laufzeit-Abhängigkeiten der API nach /out kopieren
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm --filter "@wms/api..." build \
 && pnpm --filter @wms/web build \
 && pnpm --filter @wms/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out ./
# Oberfläche unter /ui/
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
ENV WEB_DIST_DIR=/app/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]
