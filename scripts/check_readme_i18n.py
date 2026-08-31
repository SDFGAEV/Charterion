from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

from readme_i18n import NAV_END, NAV_START, navigation, source_digest

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "readme"
LANGUAGES = json.loads((DOCS / "LANGUAGES.json").read_text(encoding="utf-8"))["languages"]
SCHEMA = json.loads((DOCS / "README_SCHEMA.json").read_text(encoding="utf-8"))
STATE = json.loads((DOCS / "TRANSLATION_STATE.json").read_text(encoding="utf-8")) if (DOCS / "TRANSLATION_STATE.json").exists() else {"translations": {}}
SECTION_RE = re.compile(r"<!--\s*readme-section:([a-z0-9-]+)\s*-->\s*\n##\s+", re.M)
CODE_RE = re.compile(r"^```([^\n]*)\n(.*?)^```[ \t]*$", re.M | re.S)
MD_LINK_RE = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+['\"][^'\"]*['\"])?\)")
HTML_LINK_RE = re.compile(r"<a\s+[^>]*href=['\"]([^'\"]+)['\"][^>]*>", re.I)


def strict_text(path: Path) -> str:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"{path.name}: UTF-8 BOM is forbidden")
    text = raw.decode("utf-8", errors="strict")
    if "\ufffd" in text:
        raise ValueError(f"{path.name}: contains U+FFFD replacement character")
    return text.replace("\r\n", "\n")

def strip_navigation(text: str) -> str:
    return re.sub(re.escape(NAV_START) + r".*?" + re.escape(NAV_END), "", text, flags=re.S)


def section_ids(text: str) -> list[str]:
    return SECTION_RE.findall(text)


def code_blocks(text: str) -> list[str]:
    return [f"```{lang}\n{body}```" for lang, body in CODE_RE.findall(text)]


def relative_links(text: str) -> list[str]:
    clean = strip_navigation(text)
    targets = MD_LINK_RE.findall(clean) + HTML_LINK_RE.findall(clean)
    result: list[str] = []
    for target in targets:
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        result.append(target)
    return result


def navigation_block(text: str) -> str | None:
    match = re.search(re.escape(NAV_START) + r".*?" + re.escape(NAV_END), text, re.S)
    return match.group(0) if match else None


def check_relative_targets(file_name: str, targets: list[str], errors: list[str]) -> None:
    for target in targets:
        file_part = unquote(target.split("#", 1)[0].split("?", 1)[0])
        if not file_part:
            continue
        candidate = (ROOT / file_part).resolve()
        try:
            candidate.relative_to(ROOT.resolve())
        except ValueError:
            errors.append(f"{file_name}: relative link escapes repository: {target}")
            continue
        if not candidate.exists():
            errors.append(f"{file_name}: broken relative link: {target}")


def package_version() -> str:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if package.get("version") != manifest.get("version"):
        raise ValueError("package.json and manifest.json versions differ")
    return str(package["version"])

def run(release: bool) -> tuple[dict, list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    expected_sections = SCHEMA["section_ids"]
    locale_set = {item["locale"] for item in LANGUAGES}
    if len(locale_set) != len(LANGUAGES):
        errors.append("LANGUAGES.json contains duplicate locales")
    if "en" not in locale_set:
        errors.append("LANGUAGES.json must contain default locale en")
    valid_locale = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
    for item in LANGUAGES:
        if not valid_locale.fullmatch(item["locale"]):
            errors.append(f"invalid locale: {item['locale']}")

    texts: dict[str, str] = {}
    for item in LANGUAGES:
        path = ROOT / item["file"]
        if not path.exists():
            errors.append(f"missing README locale file: {item['file']}")
            continue
        try:
            texts[item["locale"]] = strict_text(path)
        except (UnicodeDecodeError, ValueError) as exc:
            errors.append(str(exc))

    if "en" not in texts:
        return {}, errors, warnings
    english = texts["en"]
    english_codes = code_blocks(english)
    english_links = relative_links(english)
    version = package_version()
    version_token = f"version-{version}-"
    current_digest = source_digest()
    stale: list[str] = []
    translation_state = STATE.get("translations", {})

    for item in LANGUAGES:
        locale = item["locale"]
        text = texts.get(locale)
        if text is None:
            continue
        file_name = item["file"]
        ids = section_ids(text)
        if ids != expected_sections:
            errors.append(f"{file_name}: section order drift: {ids}")
        if code_blocks(text) != english_codes:
            errors.append(f"{file_name}: code block drift")
        links = relative_links(text)
        if links != english_links:
            errors.append(f"{file_name}: relative link target drift: {links}")
        check_relative_targets(file_name, links, errors)
        expected_nav = navigation(locale)
        if navigation_block(text) != expected_nav:
            errors.append(f"{file_name}: language navigation drift")
        if not text.startswith("# GPT Agent Manager\n"):
            errors.append(f"{file_name}: canonical project name/header changed")
        if version_token not in text:
            errors.append(f"{file_name}: README version badge does not match {version}")
        for required in ("Apache-2.0", "](LICENSE)", "](NOTICE)", "](THIRD_PARTY_NOTICES.md)"):
            if required not in text:
                errors.append(f"{file_name}: missing required license/notices reference: {required}")
        if text.count("```") % 2 != 0:
            errors.append(f"{file_name}: unpaired Markdown code fence")
        if locale != "en":
            entry = translation_state.get(locale, {})
            is_current = entry.get("status") == "current" and entry.get("source_digest") == current_digest
            if not is_current:
                stale.append(locale)
                if release and int(item.get("tier", 2)) <= 1:
                    errors.append(f"{file_name}: Tier {item.get('tier')} translation is stale")
    if stale:
        warnings.append("README_TRANSLATION_STALE: " + " ".join(stale))
    result = {
        "status": "PASS" if not errors else "FAIL",
        "languages": len(LANGUAGES),
        "sections": len(expected_sections),
        "links": len(english_links),
        "code_blocks": len(english_codes),
        "source_digest": current_digest,
        "tier1_current": not any(item["locale"] in stale and int(item.get("tier", 2)) <= 1 for item in LANGUAGES),
        "stale": stale,
        "broken_links": sum("broken relative link" in error for error in errors),
        "section_drift": sum("section order drift" in error for error in errors),
        "code_block_drift": sum("code block drift" in error for error in errors),
    }
    return result, errors, warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate multilingual README invariants.")
    parser.add_argument("--release", action="store_true", help="Require Tier 0/1 translations to be current.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()
    try:
        result, errors, warnings = run(args.release)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        result, errors, warnings = {"status": "FAIL"}, [str(exc)], []
    if args.json:
        print(json.dumps({**result, "errors": errors, "warnings": warnings}, ensure_ascii=False))
    elif errors:
        print("README_I18N_CHECK_FAIL")
        for error in errors:
            print("  " + error)
        for warning in warnings:
            print("  " + warning)
    else:
        print(f"README_I18N_CHECK_PASS languages={result['languages']} sections={result['sections']} links={result['links']} code_blocks={result['code_blocks']}")
        for warning in warnings:
            print(warning)
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
