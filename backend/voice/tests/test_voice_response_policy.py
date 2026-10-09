from voice_response_policy import safe_sensitive_response


def test_cancel_response_never_claims_completion():
    response = safe_sensitive_response("cancel_order")

    assert response
    assert "cancelled" not in response.lower()
    assert "cancellation was performed" in response.lower()


def test_payment_response_requires_authoritative_confirmation():
    response = safe_sensitive_response("payment_status")

    assert response
    assert "payment status" in response.lower()
    assert "can’t confirm" in response.lower()
    assert "authoritative payment record" in response.lower()
    assert "released" not in response.lower()


def test_non_sensitive_intents_are_not_overridden():
    assert safe_sensitive_response("track_order") is None
