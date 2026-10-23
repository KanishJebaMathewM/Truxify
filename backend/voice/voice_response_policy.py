from typing import Optional


def safe_sensitive_response(intent: str, lang_name: str = "Hindi") -> Optional[str]:
    """Return a non-assertive response for sensitive intents until authoritative state is available."""
    responses = {
        "cancel_order": (
            "I can’t confirm or complete order cancellation from this voice command "
            "because no cancellation was performed."
        ),
        "payment_status": (
            "I can’t confirm your payment status "
            "without checking the authoritative payment record."
        ),
    }
    return responses.get(intent)
