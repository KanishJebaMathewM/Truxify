import os
import sys
import smtplib
from datetime import datetime, timedelta
from pymongo import MongoClient

# Alert configuration
MAE_ALERT_THRESHOLD = 500000  # Example: Alert if MAE > 5000 Rupees (stored in paisa)
NOTIFICATION_EMAIL = os.environ.get('ALERT_EMAIL', 'admin@truxify.com')
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', 587))
SMTP_USER = os.environ.get('SMTP_USER')
SMTP_PASS = os.environ.get('SMTP_PASS')

def send_alert_email(mae, threshold, count):
    if not SMTP_USER or not SMTP_PASS:
        print("SMTP credentials missing, skipping email alert.")
        return

    subject = f"ALERT: Truxify Dynamic Pricing Model Drift Detected"
    body = (
        f"Data drift detected in the ML dynamic pricing model.\n\n"
        f"Over the last 7 days (based on {count} orders):\n"
        f"Mean Absolute Error (MAE): {mae / 100:.2f} INR\n"
        f"Threshold limit: {threshold / 100:.2f} INR\n\n"
        f"Please consider retraining the model via the /admin/retrain endpoint."
    )
    message = f"Subject: {subject}\n\n{body}"
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, NOTIFICATION_EMAIL, message)
        print("Alert email sent successfully.")
    except Exception as e:
        print(f"Failed to send email alert: {e}")

def main():
    mongo_uri = os.environ.get('MONGODB_URI')
    if not mongo_uri:
        print("MONGODB_URI not set. Exiting.")
        sys.exit(1)

    db_name = os.environ.get('MONGODB_DB_NAME', 'truxify_telemetry')
    client = MongoClient(mongo_uri)
    db = client[db_name]

    # Query last 7 days of price logs
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    
    logs = db.pricelog.find({
        "created_at": {"$gte": seven_days_ago}
    })

    total_error = 0
    count = 0

    for log in logs:
        pred = log.get('predicted_price', 0)
        accepted = log.get('accepted_price', 0)
        total_error += abs(pred - accepted)
        count += 1

    if count == 0:
        print("No price logs found for the last 7 days. Nothing to analyze.")
        sys.exit(0)

    mae = total_error / count
    print(f"Calculated MAE over {count} recent orders: {mae / 100:.2f} INR")

    if mae > MAE_ALERT_THRESHOLD:
        print(f"CRITICAL: MAE ({mae}) exceeds threshold ({MAE_ALERT_THRESHOLD})!")
        send_alert_email(mae, MAE_ALERT_THRESHOLD, count)
    else:
        print("Model performance is within acceptable bounds.")

if __name__ == "__main__":
    main()
