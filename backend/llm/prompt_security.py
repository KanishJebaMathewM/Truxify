"""
Utilities for securing user-controlled text in LLM prompts.
"""


def escape_mistral_control_tokens(text: str) -> str:
    """Escape Mistral control tokens in untrusted text."""
    return (
        text.replace("[INST]", r"\[INST\]")
        .replace("[/INST]", r"\[/INST\]")
        .replace("<<SYS>>", r"\<\<SYS\>\>")
        .replace("<</SYS>>", r"\<\</SYS\>\>")
    )


def serialize_untrusted_content(
    context: list[str],
    query: str,
) -> str:
    """Serialize untrusted context and query using explicit boundaries."""
    safe_context = [
        escape_mistral_control_tokens(item)
        for item in context
    ]
    safe_query = escape_mistral_control_tokens(query)

    context_str = (
        "\n".join(safe_context)
        if safe_context
        else "No specific context available."
    )

    return (
        "<CONTEXT>\n"
        f"{context_str}\n"
        "</CONTEXT>\n\n"
        "<QUERY>\n"
        f"{safe_query}\n"
        "</QUERY>"
    )


def build_mistral_fallback_prompt(
    system_prompt: str,
    context: list[str],
    query: str,
) -> str:
    """Build a Mistral prompt when tokenizer chat templates are unavailable."""
    user_content = serialize_untrusted_content(context, query)

    return f"""<s>[INST] <<SYS>>
{system_prompt}
<</SYS>>

{user_content}

Answer: [/INST]"""