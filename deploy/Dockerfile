FROM node:22-bookworm-slim

RUN npm install --global wrangler@4.92.0 && npm cache clean --force
WORKDIR /app

COPY dist ./dist
COPY drizzle ./drizzle
COPY deploy/wrangler.vps.jsonc ./deploy/wrangler.vps.jsonc
COPY deploy/run-worker.sh ./deploy/run-worker.sh
RUN chmod +x ./deploy/run-worker.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-lc", "exec deploy/run-worker.sh"]
