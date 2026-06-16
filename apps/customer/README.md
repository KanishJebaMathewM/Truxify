# Truxify Customer App

Flutter app for customers to create bookings, track orders, and manage profile details.

## Features

- create freight bookings with route and cargo details
- browse truck matches and compare results
- track active shipments on a live map
- view shipment timelines, receipts, and order detail cards
- use voice-based shipment help for live status questions
- manage saved addresses, payments, and profile data

## Run Locally

```bash
flutter pub get
flutter run
```

If you are running against the local backend API, pass the API base URL:

```bash
flutter run --dart-define=TRUXIFY_API_BASE_URL=http://localhost:5000
```

## Useful Notes

- The app uses Supabase configuration passed through `--dart-define`.
- The app includes live tracking, voice assistance, and delivery receipt views.
- See the root `README.md` and `docs/wiki/Getting-Started-&-Local-Setup.md` for the full setup flow.
