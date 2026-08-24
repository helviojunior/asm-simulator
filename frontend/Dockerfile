FROM node:20-alpine

WORKDIR /app

# Build arguments (para variáveis React)
ARG REACT_APP_BACKEND_URL=http://localhost:8000

# Definir como variável de ambiente para o build e runtime
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

# Copiar package.json
COPY package.json ./

# Tentar copiar yarn.lock se existir, senão continuar
COPY yarn.loc[k] ./

# Instalar dependências
RUN yarn install

# Copiar o resto do código
COPY . .

# Carimbo de build para o cache-busting (?ts=). Em dev o craco.config.js gera
# um valor proprio quando a variavel nao vem definida.
ARG REACT_APP_BUILD_TS
ENV REACT_APP_BUILD_TS=$REACT_APP_BUILD_TS

EXPOSE 3000

CMD ["yarn", "start"]
