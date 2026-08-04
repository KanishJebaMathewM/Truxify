FROM alpine:3.19

RUN apk add --no-cache bash postgresql-client mongodb-tools tar aws-cli

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# Set up cron job to run daily at 3:00 AM UTC
RUN echo "0 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" > /etc/crontabs/root

CMD ["crond", "-f", "-d", "8"]
