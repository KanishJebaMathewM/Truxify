# 🎙️ Automation & Voice AI

Truxify leverages self-hosted **n8n workflows** for dispute operations and model retraining, and implements a real-time **WebRTC Voice AI** pipeline to allow customers and drivers to query system states hands-free.

---

## 🎛️ n8n Automation Workflows

Workflows are located in the `automation/n8n/` directory.

### 1. Dispute Resolution Pipeline

When a driver marks a trip as delivered but the customer reports an OTP mismatch or challenges the delivery, the API triggers the Dispute n8n Workflow:

```
[API Triggers Dispute]
          │
          ▼
[Freeze Payment Escrow] ──► (Smart Contract holds funds)
          │
          ▼
[Compile Evidence Package]
  ├── Fetch MongoDB GPS trail logs
  ├── Fetch telemetry & WebSocket logs
  ├── Fetch chat/activity history
  └── Compile document upload states
          │
          ▼
[Distribute Notifications] ──► Send Email/SMS alerts to Customer & Driver
          │
          ▼
[24-Hour Wait Step]
          │
    ┌─────┴─────────────────────┐
(Settled by Parties?)     (No Resolution?)
    │                           │
    ▼                           ▼
[Release Escrow & Close]   [Escalate to Human Arbiter Panel]
                           [Create Portal Ticket]
```

1. **Locking Funds**: The workflow triggers a call to `TruxifyEscrow.sol` to freeze the transaction's payment.
2. **Evidence Gathering**: The workflow compiles trip metadata, including MongoDB GPS breadcrumbs, driver speed logs, and message records, into a PDF package.
3. **Notification**: Both parties receive SMS and email notifications containing the evidence package.
4. **Resolution Check**: If unresolved after 24 hours, the dispute is escalated to a human arbitrator portal. The arbitrator's final decision releases the escrowed funds to either the driver or customer.

### 2. ML Retraining Pipeline
This pipeline runs every Sunday:
1. **Log Check**: It queries MongoDB to count the number of new completed trips over the past week.
2. **Execution**: If the logs exceed 500 entries, it triggers a POST call to `http://localhost:8000/train/demand`.
3. **Validation**: The pipeline evaluates the output metrics (MAE, $R^2$ scores) against the active model metadata.
4. **Deploy/Rollback**: If performance is improved, it triggers an update script on the API gateway and alerts the dev team on Slack.

---

## 🗣️ Voice AI Assistant Architecture

Truxify implements an interactive voice agent that allows users to query order statuses, check balances, or ask navigation details hands-free.

### 🛠️ The Voice Stack

To keep operations cost-effective, the system uses WebRTC for real-time streaming, bypassing Twilio or traditional SIP gateway charges:

```
[Flutter Client App]
        │  ▲ (WebRTC Audio Stream)
        ▼  │
 [Express API Gateway]
        │
        ▼ (Raw Audio Stream)
[Whisper STT Service] ──► (Generates query text: "Where is my truck?")
        │
        ▼
[LLM Router Service] ──► (Calls Supabase / MongoDB APIs to find status)
        │
        ▼ (Generates text response: "Your truck is 5 km away.")
[ElevenLabs TTS Service]
        │
        ▼ (Synthesized audio bytes)
[WebRTC Stream Return] ──► Playback to User
```

1. **Audio Capture**: The Flutter client opens a WebRTC channel to stream raw microphone audio to the Express gateway.
2. **Speech-to-Text (STT)**: The gateway forwards the audio stream to **OpenAI Whisper** to generate text.
3. **Intent Routing**: An LLM (e.g., GPT-4o-mini) parses the text to determine the user's intent and extracts relevant variables:
   * *Query*: "Where is my package for order TR-1024?"
   * *Intent*: `track_order`
   * *Entities*: `order_display_id: TR-1024`
4. **Data Retrieval**: The system fetches the latest GPS coordinates from MongoDB and resolves them to a nearby landmark or road name using OSRM.
5. **Text-to-Speech (TTS)**: The system generates a text response (e.g., "Your shipment is currently on NH-48 near Jaipur, moving at 45 kilometers per hour. ETA is one hour.") and sends it to **ElevenLabs** for voice synthesis.
6. **Playback**: The synthesized audio is streamed back through the WebRTC channel for playback in the app.

---

## 💬 Dialogue Examples

| User Input (Speech) | Extracted Intent | System Query | Generated Voice Response (Audio) |
| :--- | :--- | :--- | :--- |
| *"Where has my driver reached?"* | `track_active_order` | Fetch last GPS coordinate for the user's active order. | *"Your driver is currently 8 kilometers away, near the Mumbai highway toll booth."* |
| *"When will my cement delivery arrive?"* | `get_order_eta` | Call ML ETA Predictor endpoint. | *"The ETA for your cement delivery is 4:45 PM, subject to a 10-minute traffic delay near the entry point."* |
| *"Is the payment released to the driver?"* | `check_escrow_status` | Check the escrow smart contract state. | *"The payment of 12,000 rupees is currently locked in escrow. It will be released when the driver confirms delivery."* |
| *"Toggle my status to online"* | `update_driver_presence` | Update driver online state in database. | *"You are now online and will begin receiving nearby load offers."* |
