from typing import List


MISTRAL_CONTROL_TOKENS = (
    "<s>",
    "</s>",
    "[INST]",
    "[/INST]",
    "<<SYS>>",
    "<</SYS>>",
)


def escape_mistral_control_tokens(text: str) -> str:
    """Keep model control sequences in untrusted text from becoming delimiters."""
    for token in MISTRAL_CONTROL_TOKENS:
        text = text.replace(token, token.replace("[", "\\[").replace("]", "\\]").replace("<", "\\<").replace(">", "\\>"))
    return text


def build_safe_mistral_prompt(tokenizer, system_prompt: str, context: List[str], query: str) -> str:
    """Serialize trusted instructions and untrusted text without exposing control tokens."""
    safe_context = "\\n".join(escape_mistral_control_tokens(item) for item in context)
    if not safe_context:
        safe_context = "No specific context available."

    user_content = f"Context information:\\n{safe_context}\\n\\nQuestion: {escape_mistral_control_tokens(query)}"
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    if getattr(tokenizer, "chat_template", None):
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

    return (
        f"<s>[INST] <<SYS>>\\n{system_prompt}\\n<</SYS>>\\n\\n"
        f"{user_content}\\n\\nAnswer: [/INST]"
    )
