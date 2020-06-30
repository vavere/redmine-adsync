FROM node:carbon-alpine
ENV NODE_ENV=production
COPY index.js package*.json /app/
WORKDIR /app
RUN npm install --production && \
 ln -sf /proc/1/fd/1 /var/log/cron.log && \
 echo "0 7 * * * cd /app && exec /usr/local/bin/node index.js >> /var/log/cron.log 2>&1" | crontab -
ENTRYPOINT ["/usr/sbin/crond", "-f", "-l", "7", "-L", "/var/log/cron.log"]