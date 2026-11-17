
#!/usr/bin/env python3
"""
Truxify Flutter Localization Generator.

Generates localization delegates for Driver and Customer applications
from ARB files.

Features:
- Multiple locale support.
- Translation fallback to English.
- Placeholder and ARB metadata validation.
- Unsupported ICU syntax detection.
- Duplicate JSON key detection.
- Selective application generation.
- Check mode for CI pipelines.
- Atomic file writes to prevent partial output.

Usage:
    python3 scripts/gen_l10n.py
    python3 scripts/gen_l10n.py --check
    python3 scripts/gen_l10n.py --app driver
    python3 scripts/gen_l10n.py --app customer
"""

import argparse
import json
import os
import re
import sys
import tempfile

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent

APPS = {
    "driver": "Truxify Driver",
    "customer": "Truxify Customer",
}

LOCALES = {
    "en": "English",
    "hi": "Hindi",
    "ta": "Tamil",
    "kn": "Kannada",
    "mr": "Marathi",
}

PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")

UNSUPPORTED_ICU_RE = re.compile(
    r"\{\s*\w+\s*,\s*(plural|select|selectordinal|date|time|number)\b"
)

DART_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_]\w*$")

PLACEHOLDER_TYPES = {
    "String": "String",
    "int": "int",
    "num": "num",
    "double": "double",
}


class LocalizationError(Exception):
    """Raised when localization source files are invalid."""


# ==========================================
# File Utilities
# ==========================================

def app_l10n_dir(app: str) -> Path:
    return REPO_ROOT / "apps" / app / "lib" / "l10n"


def reject_duplicate_keys(pairs):
    """Prevent silently accepting duplicate JSON keys."""
    result = {}

    for key, value in pairs:
        if key in result:
            raise LocalizationError(
                f"Duplicate JSON key detected: {key}"
            )

        result[key] = value

    return result


def load_arb(app: str, locale: str) -> dict:
    path = app_l10n_dir(app) / f"app_{locale}.arb"

    if not path.is_file():
        raise LocalizationError(
            f"Missing ARB file: {path.relative_to(REPO_ROOT)}"
        )

    try:
        data = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_keys,
        )
    except json.JSONDecodeError as error:
        raise LocalizationError(
            f"Invalid JSON in {path}: {error}"
        ) from error

    if not isinstance(data, dict):
        raise LocalizationError(
            f"ARB root must be a JSON object: {path}"
        )

    return data


def message_keys(arb: dict):
    return [
        key for key in arb
        if not key.startswith("@")
    ]


# ==========================================
# ARB Validation
# ==========================================

def validate_message(key: str, value, arb: dict):
    """Validate message names, values, metadata and syntax."""

    if not DART_IDENTIFIER_RE.fullmatch(key):
        raise LocalizationError(
            f"Invalid Dart localization identifier: {key}"
        )

    if not isinstance(value, str):
        raise LocalizationError(
            f"Localization '{key}' must contain a string value"
        )

    if UNSUPPORTED_ICU_RE.search(value):
        raise LocalizationError(
            f"Unsupported ICU syntax in '{key}'. "
            "Use flutter gen-l10n for plural, select, "
            "date, time or number formatting."
        )

    metadata = arb.get(f"@{key}", {})

    if not isinstance(metadata, dict):
        raise LocalizationError(
            f"Metadata for '{key}' must be an object"
        )

    placeholders = metadata.get("placeholders", {})

    if not isinstance(placeholders, dict):
        raise LocalizationError(
            f"Placeholders for '{key}' must be an object"
        )

    for name, spec in placeholders.items():
        if not DART_IDENTIFIER_RE.fullmatch(name):
            raise LocalizationError(
                f"Invalid placeholder name '{name}' in '{key}'"
            )

        if not isinstance(spec, dict):
            raise LocalizationError(
                f"Invalid placeholder metadata for '{name}' in '{key}'"
            )

        arb_type = spec.get("type", "String")

        if arb_type not in PLACEHOLDER_TYPES:
            raise LocalizationError(
                f"Unsupported placeholder type '{arb_type}' "
                f"for '{name}' in '{key}'"
            )

    body_names = set(PLACEHOLDER_RE.findall(value))
    metadata_names = set(placeholders)

    if metadata_names and body_names != metadata_names:
        raise LocalizationError(
            f"Placeholder mismatch in '{key}': "
            f"message={sorted(body_names)}, "
            f"metadata={sorted(metadata_names)}"
        )


def validate_arb(template: dict, translations: dict, locale: str):
    """Validate translated keys and placeholder consistency."""

    for key in message_keys(template):
        validate_message(key, template[key], template)

        if key not in translations:
            continue

        validate_message(key, translations[key], translations)

        expected = set(
            PLACEHOLDER_RE.findall(template[key])
        )

        actual = set(
            PLACEHOLDER_RE.findall(translations[key])
        )

        if expected != actual:
            raise LocalizationError(
                f"Placeholder mismatch for '{key}' "
                f"in locale '{locale}': "
                f"expected={sorted(expected)}, "
                f"actual={sorted(actual)}"
            )

    unknown_keys = set(message_keys(translations)) - set(
        message_keys(template)
    )

    if unknown_keys:
        print(
            f"Warning: {locale} contains unused keys: "
            f"{', '.join(sorted(unknown_keys))}"
        )


# ==========================================
# Dart Code Generation
# ==========================================

def dart_string(value: str) -> str:
    """Generate a safely escaped Dart string literal."""
    return json.dumps(
        value,
        ensure_ascii=False,
    ).replace("$", r"\$")


def dart_interpolated(value: str, placeholders) -> str:
    """Generate Dart interpolation for positional placeholders."""

    escaped = dart_string(value)

    for name in placeholders:
        escaped = escaped.replace(
            "{" + name + "}",
            "$" + name,
        )

    return escaped


def signature(key: str, arb: dict):
    """Return parameter definitions and placeholder names."""

    metadata = arb.get(f"@{key}", {})
    placeholders = metadata.get("placeholders", {})

    if not placeholders:
        found = PLACEHOLDER_RE.findall(arb[key])

        placeholders = {
            name: {"type": "String"}
            for name in dict.fromkeys(found)
        }

    if not placeholders:
        return None, []

    parameters = []

    for name, spec in placeholders.items():
        arb_type = spec.get("type", "String")
        dart_type = PLACEHOLDER_TYPES[arb_type]

        parameters.append(
            f"{dart_type} {name}"
        )

    return ", ".join(parameters), list(placeholders)


def build_locale_file(
    locale: str,
    template: dict,
    translations: dict,
) -> str:

    class_name = f"AppLocalizations{locale.capitalize()}"

    lines = [
        "// GENERATED CODE - DO NOT MODIFY BY HAND.",
        "// Generated by scripts/gen_l10n.py.",
        "",
        "import 'package:intl/intl.dart' as intl;",
        "import 'app_localizations.dart';",
        "",
        "// ignore_for_file: type=lint",
        "",
        f"/// The translations for {LOCALES[locale]} (`{locale}`).",
        f"class {class_name} extends AppLocalizations {{",
        f"  {class_name}([String locale = '{locale}']) : super(locale);",
        "",
    ]

    for key in message_keys(template):
        params, names = signature(key, template)

        value = translations.get(
            key,
            template[key],
        )

        lines.append("  @override")

        if params is None:
            lines.append(
                f"  String get {key} => {dart_string(value)};"
            )
        else:
            lines.extend([
                f"  String {key}({params}) {{",
                f"    return {dart_interpolated(value, names)};",
                "  }",
            ])

        lines.append("")

    if lines[-1] == "":
        lines.pop()

    lines.extend([
        "}",
        "",
    ])

    return "\n".join(lines)


def build_members(template: dict) -> str:
    """Generate abstract localization member declarations."""

    output = []

    for key in message_keys(template):
        params, _ = signature(key, template)

        metadata = template.get(f"@{key}", {})
        description = metadata.get("description")

        if description:
            description = description.replace("\n", " ")
            output.append(f"  /// {description}")

        if params is None:
            output.append(f"  String get {key};")
        else:
            output.append(f"  String {key}({params});")

        output.append("")

    return "\n".join(output).rstrip()


def rewrite_base_file(app: str, template: dict) -> str:
    """Update abstract members while preserving delegate scaffolding."""

    path = app_l10n_dir(app) / "app_localizations.dart"

    if not path.is_file():
        raise LocalizationError(
            f"Base localization file not found: {path}"
        )

    source = path.read_text(encoding="utf-8")

    class_marker = "abstract class AppLocalizations {"
    delegate_marker = "class _AppLocalizationsDelegate"

    class_start = source.find(class_marker)
    delegate_start = source.find(delegate_marker)

    if class_start == -1 or delegate_start == -1:
        raise LocalizationError(
            f"Could not locate localization class scaffolding: {path}"
        )

    class_block = source[class_start:delegate_start]

    anchor = class_block.find(
        "static const List<Locale> supportedLocales"
    )

    if anchor == -1:
        raise LocalizationError(
            f"Could not locate supportedLocales declaration: {path}"
        )

    anchor_end = class_block.find("];", anchor)

    if anchor_end == -1:
        raise LocalizationError(
            f"Could not locate supportedLocales closing bracket: {path}"
        )

    anchor_end += 2

    preamble = class_block[:anchor_end]
    members = build_members(template)

    new_class = (
        f"{preamble}\n\n"
        f"{members}\n"
        "}\n\n"
    )

    return (
        source[:class_start]
        + new_class
        + source[delegate_start:]
    )


# ==========================================
# Generation
# ==========================================

def generate(app: str):
    template = load_arb(app, "en")

    outputs = {}

    for locale in LOCALES:
        translations = (
            template
            if locale == "en"
            else load_arb(app, locale)
        )

        validate_arb(
            template,
            translations,
            locale,
        )

        filename = f"app_localizations_{locale}.dart"

        outputs[filename] = build_locale_file(
            locale,
            template,
            translations,
        )

    outputs["app_localizations.dart"] = rewrite_base_file(
        app,
        template,
    )

    return outputs


def atomic_write(path: Path, content: str):
    """Write generated files atomically."""

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
        ) as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)

        os.replace(temporary_path, path)

    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


# ==========================================
# CLI
# ==========================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate Truxify Flutter localization files."
    )

    parser.add_argument(
        "--check",
        action="store_true",
        help="Check whether generated files are up to date.",
    )

    parser.add_argument(
        "--app",
        choices=["driver", "customer", "all"],
        default="all",
        help="Select which application to generate.",
    )

    args = parser.parse_args()

    selected_apps = (
        list(APPS)
        if args.app == "all"
        else [args.app]
    )

    differs = False

    try:
        for app in selected_apps:
            outputs = generate(app)

            l10n_dir = app_l10n_dir(app)

            for filename, content in outputs.items():
                path = l10n_dir / filename

                existing = (
                    path.read_text(encoding="utf-8")
                    if path.exists()
                    else None
                )

                if existing == content:
                    continue

                differs = True

                if args.check:
                    print(
                        f"OUTDATED: {path.relative_to(REPO_ROOT)}"
                    )
                else:
                    atomic_write(path, content)

                    print(
                        f"GENERATED: {path.relative_to(REPO_ROOT)}"
                    )

    except (LocalizationError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

    if args.check and differs:
        print(
            "\nLocalization files are outdated. "
            "Run: python3 scripts/gen_l10n.py",
            file=sys.stderr,
        )
        sys.exit(1)

    if not differs:
        print("Localization files are up to date.")
    elif not args.check:
        print("\nLocalization generation completed successfully.")


if __name__ == "__main__":
    main()
