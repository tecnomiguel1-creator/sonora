FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV SONORA_DATA=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]

# Uso:
#   docker build -t sonora .
#   docker run -d --name sonora --restart unless-stopped -p 3000:3000 \
#     -v sonora-data:/data -e SONORA_PASSWORD="mi-clave-segura" sonora
