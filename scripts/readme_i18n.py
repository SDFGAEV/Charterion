from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "readme"
LANGUAGES_PATH = DOCS / "LANGUAGES.json"
STATE_PATH = DOCS / "TRANSLATION_STATE.json"
NAV_START = "<!-- readme-i18n:navigation:start -->"
NAV_END = "<!-- readme-i18n:navigation:end -->"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def languages() -> list[dict]:
    return load_json(LANGUAGES_PATH)["languages"]


def navigation(locale: str) -> str:
    parts: list[str] = []
    for item in languages():
        label = item["name"]
        if item["locale"] == locale:
            parts.append(f"<strong>{label}</strong>")
        else:
            parts.append(f'<a href="{item["file"]}">{label}</a>')
    return f'{NAV_START}\n<p align="center">{" · ".join(parts)}</p>\n{NAV_END}'


def replace_navigation(text: str, locale: str) -> str:
    block = navigation(locale)
    pattern = re.compile(re.escape(NAV_START) + r".*?" + re.escape(NAV_END), re.S)
    if pattern.search(text):
        return pattern.sub(block, text, count=1)
    lines = text.splitlines()
    insert_at = 1
    while insert_at < len(lines) and (not lines[insert_at].strip() or lines[insert_at].startswith("[!")):
        insert_at += 1
    lines[insert_at:insert_at] = ["", block, ""]
    return "\n".join(lines).rstrip() + "\n"


def semantic_source_text() -> str:
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    text = re.sub(re.escape(NAV_START) + r".*?" + re.escape(NAV_END), "", text, flags=re.S)
    text = re.sub(r"^\[!\[.*?\]\(.*?\)\]\(.*?\)\s*$", "", text, flags=re.M)
    text = re.sub(r"<!--\s*readme-section:[^>]+-->", "", text)
    text = re.sub(r"<!--\s*readme-source-sha256:[^>]+-->", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def source_digest() -> str:
    return hashlib.sha256(semantic_source_text().encode("utf-8")).hexdigest()


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"schema": "charterion.readme-translation-state.v1", "source_locale": "en", "source_digest": "", "translations": {}}
    return load_json(STATE_PATH)

def sync_navigation() -> None:
    for item in languages():
        path = ROOT / item["file"]
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        path.write_text(replace_navigation(text, item["locale"]), encoding="utf-8")
    print(f"README_I18N_NAV_SYNC languages={len(languages())}")


def status() -> None:
    digest = source_digest()
    state = load_state()
    print(f"en\tSOURCE\t{digest[:12]}")
    translations = state.get("translations", {})
    for item in languages():
        locale = item["locale"]
        if locale == "en":
            continue
        entry = translations.get(locale, {})
        current = entry.get("source_digest") == digest and entry.get("status") == "current"
        state_label = "CURRENT" if current else "STALE"
        print(f"{locale}\t{state_label}\ttier={item['tier']}")


def mark_current(locales: list[str]) -> None:
    available = {item["locale"] for item in languages() if item["locale"] != "en"}
    unknown = sorted(set(locales) - available)
    if unknown:
        raise SystemExit(f"Unknown locale(s): {', '.join(unknown)}")
    digest = source_digest()
    state = load_state()
    state["source_digest"] = digest
    translations = state.setdefault("translations", {})
    for locale in locales:
        translations[locale] = {"source_digest": digest, "status": "current"}
    write_json(STATE_PATH, state)
    print(f"README_I18N_MARK_CURRENT locales={','.join(locales)} source={digest[:12]}")


def init_state() -> None:
    digest = source_digest()
    state = {
        "schema": "charterion.readme-translation-state.v1",
        "source_locale": "en",
        "source_digest": digest,
        "translations": {},
    }
    for item in languages():
        locale = item["locale"]
        if locale == "en":
            continue
        state["translations"][locale] = {"source_digest": digest, "status": "current"}
    write_json(STATE_PATH, state)
    print(f"README_I18N_STATE_INIT languages={len(languages())} source={digest[:12]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage multilingual README metadata and navigation.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sync-navigation")
    sub.add_parser("status")
    sub.add_parser("init-state")
    mark = sub.add_parser("mark-current")
    mark.add_argument("locales", nargs="+")
    args = parser.parse_args()
    if args.command == "sync-navigation":
        sync_navigation()
    elif args.command == "status":
        status()
    elif args.command == "init-state":
        init_state()
    elif args.command == "mark-current":
        mark_current(args.locales)


if __name__ == "__main__":
    main()
