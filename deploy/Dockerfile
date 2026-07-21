FROM node:22-bookworm-slim

RUN npm install --global wrangler@4.92.0 && npm cache clean --force
WORKDIR /app

COPY dist ./dist
COPY drizzle ./drizzle
COPY deploy/wrangler.vps.jsonc ./deploy/wrangler.vps.jsonc

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["wrangler", "dev", "--config", "deploy/wrangler.vps.jsonc", "--ip", "0.0.0.0", "--port", "3000", "--persist-to", "/data"]
