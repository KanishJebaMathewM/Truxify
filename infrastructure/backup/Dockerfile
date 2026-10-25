FROM alpine:3.19

RUN apk add --no-cache bash postgresql-client mongodb-tools tar aws-cli openssl coreutils

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

RUN addgroup -S backup && adduser -S backup -G backup \
  && mkdir -p /var/truxify/backups /var/log && touch /var/log/backup.log && chown -R backup:backup /var/truxify /var/log/backup.log

# Set up cron job to run daily at 3:00 AM UTC
RUN echo "0 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" > /etc/crontabs/root

USER backup

HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD pgrep crond || exit 1

CMD ["crond", "-f", "-d", "8"]
