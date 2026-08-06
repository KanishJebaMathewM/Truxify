#!/usr/bin/env python3
"""
Regenerate Flutter localization delegates from the ARB files.

`flutter gen-l10n` is the canonical generator and should be used whenever a
Flutter SDK is available. This script exists because the generated files are
committed to source control, which lets the repository hold a state no build
step would ever produce — as it did: `app_localizations.dart` imported three
delegate files that were never committed, so neither app compiled.

It emits byte-compatible output for the subset of ARB features this project
uses (simple messages and positional placeholders). It does not implement
plurals, selects or date/number formatting; if a future ARB uses those, run
`flutter gen-l10n` instead.

Messages missing from a translation fall back to the English string, which is
what gen-l10n does after emitting an untranslated-message warning.

Usage:
    python3 scripts/gen_l10n.py                # regenerate both apps
    python3 scripts/gen_l10n.py --check        # exit 1 if output would differ
"""
import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

APPS = {
    "driver": {"class_suffix": "", "description": "Truxify Driver"},
    "customer": {"class_suffix": "", "description": "Truxify Customer"},
}

LOCALES = ["en", "hi", "ta", "kn", "mr"]

LOCALE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "ta": "Tamil",
    "kn": "Kannada",
    "mr": "Marathi",
}

PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")


def dart_string(value: str) -> str:
    """Quote a string for Dart, matching gen-l10n's escaping."""
    escaped = value.replace("\\", "\\\\").replace("'", "\\'").replace("$", "\\$")
    return f"'{escaped}'"


def dart_interpolated(value: str, placeholders) -> str:
    """Quote a Dart string, leaving {name} placeholders as $name interpolation."""
    escaped = value.replace("\\", "\\\\").replace("'", "\\'").replace("$", "\\$")
    for name in placeholders:
        escaped = escaped.replace("{" + name + "}", "$" + name)
    return f"'{escaped}'"


def placeholder_type(spec) -> str:
    """Map an ARB placeholder spec to a Dart type."""
    if not isinstance(spec, dict):
        return "Object"
    arb_type = spec.get("type")
    return {"int": "int", "num": "num", "double": "double", "String": "String"}.get(
        arb_type, "String"
    )


def load_arb(app: str, locale: str) -> dict:
    path = REPO_ROOT / "apps" / app / "lib" / "l10n" / f"app_{locale}.arb"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise SystemExit(f"{path} is not valid JSON: {err}")


def message_keys(arb: dict):
    return [k for k in arb if not k.startswith("@")]


def signature(key: str, arb: dict):
    """Return (params, placeholder_names) for a message, or (None, []) if simple."""
    meta = arb.get("@" + key)
    placeholders = {}
    if isinstance(meta, dict) and isinstance(meta.get("placeholders"), dict):
        placeholders = meta["placeholders"]

    if not placeholders:
        # Fall back to scanning the message body, since some ARB entries carry
        # placeholders without declaring them in metadata.
        found = PLACEHOLDER_RE.findall(str(arb.get(key, "")))
        placeholders = {name: {} for name in dict.fromkeys(found)}

    if not placeholders:
        return None, []

    params = ", ".join(
        f"{placeholder_type(spec)} {name}" for name, spec in placeholders.items()
    )
    return params, list(placeholders.keys())


def build_locale_file(app: str, locale: str, template: dict, translations: dict) -> str:
    class_name = f"AppLocalizations{locale.capitalize()}"
    lines = [
        "// ignore: unused_import",
        "import 'package:intl/intl.dart' as intl;",
        "import 'app_localizations.dart';",
        "",
        "// ignore_for_file: type=lint",
        "",
        f"/// The translations for {LOCALE_NAMES[locale]} (`{locale}`).",
        f"class {class_name} extends AppLocalizations {{",
        f"  {class_name}([String locale = '{locale}']) : super(locale);",
        "",
    ]

    body = []
    for key in message_keys(template):
        params, names = signature(key, template)
        # Untranslated messages fall back to the template string, as gen-l10n does.
        value = translations.get(key, template[key])

        if params is None:
            body.append("  @override")
            body.append(f"  String get {key} => {dart_string(value)};")
        else:
            body.append("  @override")
            body.append(f"  String {key}({params}) {{")
            body.append(f"    return {dart_interpolated(value, names)};")
            body.append("  }")
        body.append("")

    if body and body[-1] == "":
        body.pop()

    lines.extend(body)
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def build_members(template: dict) -> str:
    """Abstract member declarations for the base AppLocalizations class."""
    out = []
    for key in message_keys(template):
        params, _ = signature(key, template)
        meta = template.get("@" + key)
        if isinstance(meta, dict) and meta.get("description"):
            out.append(f"  /// {meta['description']}")
        if params is None:
            out.append(f"  String get {key};")
        else:
            out.append(f"  String {key}({params});")
        out.append("")
    if out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def rewrite_base_file(app: str, template: dict) -> str:
    """
    Rewrite app_localizations.dart, preserving its existing header, delegate
    and lookup scaffolding while replacing the member declarations.
    """
    path = REPO_ROOT / "apps" / app / "lib" / "l10n" / "app_localizations.dart"
    source = path.read_text(encoding="utf-8")

    # Members sit between the end of the class preamble and the closing brace
    # of the abstract class, which is followed by the delegate class.
    class_start = source.index("abstract class AppLocalizations {")
    delegate_start = source.index("class _AppLocalizationsDelegate")

    class_block = source[class_start:delegate_start]
    # Everything up to and including the last scaffolding member gen-l10n emits
    # before the message declarations.
    anchor = class_block.find("  static const List<Locale> supportedLocales")
    if anchor == -1:
        raise SystemExit("Could not locate the supportedLocales anchor")
    anchor_end = class_block.index("];", anchor) + len("];")

    preamble = class_block[:anchor_end]
    members = build_members(template)

    new_class = f"{preamble}\n\n{members}\n}}\n\n"
    return source[:class_start] + new_class + source[delegate_start:]


def generate(app: str):
    template = load_arb(app, "en")
    outputs = {}

    for locale in LOCALES:
        translations = template if locale == "en" else load_arb(app, locale)
        filename = f"app_localizations_{locale}.dart"
        outputs[filename] = build_locale_file(app, locale, template, translations)

    outputs["app_localizations.dart"] = rewrite_base_file(app, template)
    return outputs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="exit 1 if output differs")
    args = parser.parse_args()

    differs = False
    for app in APPS:
        outputs = generate(app)
        l10n_dir = REPO_ROOT / "apps" / app / "lib" / "l10n"

        for filename, content in outputs.items():
            path = l10n_dir / filename
            existing = path.read_text(encoding="utf-8") if path.exists() else None

            if existing == content:
                continue

            differs = True
            if args.check:
                print(f"would change: {path.relative_to(REPO_ROOT)}")
            else:
                path.write_text(content, encoding="utf-8")
                print(f"wrote: {path.relative_to(REPO_ROOT)}")

    if args.check and differs:
        print("\nGenerated localizations are out of date. Run: python3 scripts/gen_l10n.py")
        sys.exit(1)

    if not differs:
        print("Generated localizations are up to date.")


if __name__ == "__main__":
    main()
