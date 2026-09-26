FROM node:24-alpine
ARG OKX_AGENT_TRADE_CLI_VERSION=1.4.7
WORKDIR /app
# Official OKX Agent Trade Kit CLI. KULT still hard-forces --demo for every market command.
RUN npm install -g "@okx_ai/okx-trade-cli@${OKX_AGENT_TRADE_CLI_VERSION}"
COPY --chown=node:node . .
RUN mkdir -p /var/data && chown node:node /var/data
ENV NODE_ENV=production
ENV PORT=8060
EXPOSE 8060
USER node
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8060/api/ready >/dev/null || exit 1
CMD ["npm", "start"]
