
import os
import sys
import smtplib
import logging
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from pymongo import MongoClient
from pymongo.errors import PyMongoError

# Alert Configuration
MAE_ALERT_THRESHOLD = 500000  # Rs. 5000 in paisa
NOTIFICATION_EMAIL = os.getenv("ALERT_EMAIL", "admin@truxify.com")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)


def send_alert_email(mae, threshold, count):
    if not SMTP_USER or not SMTP_PASS:
        logging.warning("SMTP credentials missing. Skipping email alert.")
        return False

    message = EmailMessage()
    message["Subject"] = "ALERT: Truxify Dynamic Pricing Model Drift Detected"
    message["From"] = SMTP_USER
    message["To"] = NOTIFICATION_EMAIL

    message.set_content(
        f"Data drift detected in the ML dynamic pricing model.\n\n"
        f"Orders analyzed: {count}\n"
        f"Mean Absolute Error: Rs. {mae / 100:.2f}\n"
        f"Threshold: Rs. {threshold / 100:.2f}\n\n"
        f"Please consider retraining the model through the "
        f"/admin/retrain endpoint."
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(message)

        logging.info("Alert email sent successfully.")
        return True

    except (smtplib.SMTPException, OSError) as error:
        logging.error("Failed to send alert email: %s", error)
        return False


def calculate_mae(logs):
    total_error = 0
    count = 0
    missing_actual = 0

    for log in logs:
        predicted = log.get("predicted_price")
        accepted = log.get("accepted_price")

        if (
            isinstance(predicted, bool)
            or isinstance(accepted, bool)
            or not isinstance(predicted, (int, float))
            or not isinstance(accepted, (int, float))
        ):
            missing_actual += 1
            continue

        total_error += abs(predicted - accepted)
        count += 1

    return total_error / count if count else None, count, missing_actual


def main():
    mongo_uri = os.getenv("MONGODB_URI")

    if not mongo_uri:
        logging.error("MONGODB_URI is not configured.")
        return 1

    db_name = os.getenv("MONGODB_DB_NAME", "truxify_telemetry")
    client = None

    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")

        db = client[db_name]

        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

        logs = db.pricelog.find(
            {"created_at": {"$gte": seven_days_ago}},
            {"predicted_price": 1, "accepted_price": 1}
        )

        mae, count, missing = calculate_mae(logs)

        if missing:
            logging.warning(
                "Skipped %d logs with missing or invalid prices.", missing
            )

        if mae is None:
            logging.info("No valid price logs found in the last 7 days.")
            return 0

        logging.info(
            "Calculated MAE over %d orders: Rs. %.2f",
            count, mae / 100
        )

        if mae > MAE_ALERT_THRESHOLD:
            logging.critical(
                "MAE %.2f exceeds threshold %.2f.",
                mae, MAE_ALERT_THRESHOLD
            )
            send_alert_email(mae, MAE_ALERT_THRESHOLD, count)
        else:
            logging.info("Model performance is within acceptable bounds.")

        return 0

    except PyMongoError as error:
        logging.error("MongoDB error: %s", error)
        return 1

    except Exception:
        logging.exception("Unexpected error during drift monitoring.")
        return 1

    finally:
        if client is not None:
            client.close()


if __name__ == "__main__":
    sys.exit(main())

