FROM node:18-alpine

# 工作目录
WORKDIR /app

# 先安装 server 端依赖 (利用缓存)
COPY server/package.json ./server/
COPY server/package-lock.json* ./server/
RUN cd server && npm install --production

# 复制源代码
COPY server/ ./server/
COPY public/ ./public/

# 持久数据目录挂载点
RUN mkdir -p /data
ENV DATA_DIR=/data
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# 启动
CMD ["node", "server/app.js"]
