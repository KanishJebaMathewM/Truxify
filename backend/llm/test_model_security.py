"""Regression tests for the LLM model-loading trust boundary."""

from pathlib import Path
import ast
import re


def _resolve_literal_assignment(tree: ast.Module, name: str):
    assignments = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                assignments[target.id] = node.value

    value = assignments[name]
    if isinstance(value, ast.Dict):
        resolved = {}
        for key_node, value_node in zip(value.keys, value.values):
            if isinstance(key_node, ast.Name):
                key = ast.literal_eval(assignments[key_node.id])
            else:
                key = ast.literal_eval(key_node)
            resolved[key] = ast.literal_eval(value_node)
        return resolved

    return ast.literal_eval(value)


def test_llm_model_is_allowlisted_and_pinned():
    source = Path(__file__).with_name("llm_service.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    mapping = _resolve_literal_assignment(tree, "PINNED_LLM_MODEL_REVISIONS")
    assert mapping == {
        "mistralai/Mistral-7B-Instruct-v0.1":
            "464c09acb438a06c3a5eaafa25b90069df87efca"
    }
    assert all(re.fullmatch(r"[0-9a-f]{40}", revision) for revision in mapping.values())


def test_model_loading_disables_remote_code_and_pickle_weights():
    source = Path(__file__).with_name("llm_service.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "from_pretrained"
    ]
    assert len(calls) == 2

    for call in calls:
        keywords = {keyword.arg: keyword.value for keyword in call.keywords}
        assert isinstance(keywords["trust_remote_code"], ast.Constant)
        assert keywords["trust_remote_code"].value is False
        assert isinstance(keywords["revision"], ast.Attribute)
        assert isinstance(keywords["revision"].value, ast.Name)
        assert keywords["revision"].value.id == "self"

        if isinstance(call.func.value, ast.Name) and call.func.value.id == "AutoModelForCausalLM":
            assert isinstance(keywords["use_safetensors"], ast.Constant)
            assert keywords["use_safetensors"].value is True


def test_arbitrary_model_names_are_rejected_before_loading():
    source = Path(__file__).with_name("llm_service.py").read_text(encoding="utf-8")
    assert "if self.model_revision is None:" in source
    assert "Unsupported LLM_MODEL" in source
