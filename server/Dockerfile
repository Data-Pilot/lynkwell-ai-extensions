# LynkWell AI Cloud API — run without installing Node on the host (only Docker).
FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

# Listen on all interfaces inside the container (required for Docker port mapping).
ENV BIND_HOST=0.0.0.0
ENV PORT=3847
ENV NODE_ENV=production

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3847/health || exit 1

CMD ["node", "index.js"]
