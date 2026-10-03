"""Active-window distraction check.

Why this is more than a substring match
---------------------------------------
Window titles are noisy: "reddit_scraper.py - Visual Studio Code" contains
"reddit", "Java threads tutorial - Chrome" contains "threads", and
"Dropbox.com - Chrome" contains "x.com". A false slash looks terrible in the
demo, so matching is deliberately conservative:

1. Distracting SITE keywords are only matched against BROWSER windows (title
   ends in "- Google Chrome", "- Microsoft Edge", "— Mozilla Firefox", ... or
   the process is a known browser). A code editor or Word doc never matches.
2. Keywords match on word boundaries ("x.com" will not match "dropbox.com").
3. ALLOW wins ties ("YouTube - CS lecture", "Amazon Web Services").
4. Native (non-browser) apps are matched by process name / exact title only.

Extend the lists below, or without editing code set EXTRA_DISTRACTING /
EXTRA_ALLOW in .env as comma-separated lowercase keywords.
"""
import re
from typing import Iterable, Optional, Tuple

try:
    import pywinctl as pwc
except Exception:  # missing permissions / unsupported platform
    pwc = None

import config

# --------------------------------------------------------------------------- #
# Lists (all lowercase). Browser-tab keywords, matched on word boundaries.
# --------------------------------------------------------------------------- #
DISTRACTING = {
    "social": [
        "instagram", "tiktok", "twitter", "facebook", "snapchat", "reddit",
        "pinterest", "tumblr", "bereal", "9gag", "imgur", "buzzfeed",
        "threads.net", "threads.com",  # bare "threads" would hit programming titles
    ],
    "video": [
        "youtube", "netflix", "twitch", "hulu", "disney+", "disneyplus",
        "prime video", "hbo max", "crunchyroll", "dailymotion", "kick.com",
    ],
    "shopping": ["amazon", "shein", "aliexpress", "temu", "ebay", "etsy"],
    "games": [
        "roblox", "poki", "miniclip", "crazygames", "friv", "geoguessr",
        "steam community", "steampowered", "welcome to steam",
    ],
}

# X/Twitter tab titles look like "(3) Home / X", so match on the page title (suffix
# stripped). label -> regex
DISTRACTING_REGEX = {
    "x": r"\s/\sx$",
    # Subreddit / user pages have no "reddit" in the tab title, just "r/Vancouver" or "u/name".
    # Subreddit names are 3+ chars, which keeps "R/W permissions" from matching.
    "reddit": r"(?<![a-z0-9])[ru]/[a-z0-9_]{3,21}(?![a-z0-9_])",
}

# Anything matching these wins, even if a distracting keyword also matches.
ALLOW = [
    # docs / notes / code hosting
    "docs.google", "google docs", "google sheets", "google slides", "google drive",
    "notion", "github", "gitlab", "bitbucket", "stack overflow", "stackoverflow",
    "leetcode", "codeforces", "overleaf", "jupyter", "colab", "figma", "devpost",
    # school
    "canvas", "lecture", "coursera", "khan academy", "wikipedia", "arxiv",
    "tutorial", "course", "syllabus", "homework", "assignment",
    # focus music / study streams people leave on YouTube
    "lofi", "lo-fi", "study with me", "pomodoro", "focus music",
    # AWS etc. (Amazon in title but work)
    "aws", "amazon web services", "amazon s3", "amazon ec2", "amazon bedrock",
    # tooling / project
    "mdn web docs", "documentation", "docs", "localhost", "scrollstake",
    "solana", "anchor", "privy", "elevenlabs", "tiger data", "claude", "chatgpt",
    "gemini", "mlh",
    # editors
    "visual studio code", "vscode", "cursor", "pycharm", "intellij", "terminal",
    "powershell", "command prompt",
]

# Native apps (not browsers). Process stem (no .exe), lowercase.
APP_DISTRACTING = {
    "steam": "steam", "steamwebhelper": "steam", "netflix": "netflix",
    "roblox": "roblox", "robloxplayerbeta": "roblox", "epicgameslauncher": "epicgames",
    "valorant": "valorant", "leagueclient": "lol", "minecraft": "minecraft",
    "javaw": None,  # javaw is also IDEs/Minecraft; ignore
}
APP_DISTRACTING = {k: v for k, v in APP_DISTRACTING.items() if v}

# Installed-web-app / unknown-process fallback: the title is exactly one of these.
EXACT_TITLES = {
    "instagram", "tiktok", "netflix", "youtube", "reddit", "facebook",
    "snapchat", "twitch", "hulu", "disney+", "prime video", "steam", "roblox",
}

BROWSER_NAMES = (
    "google chrome", "microsoft edge", "mozilla firefox", "firefox", "brave",
    "opera", "vivaldi", "chromium", "safari", "arc", "duckduckgo",
)
BROWSER_EXES = {
    "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "chromium",
    "safari", "arc", "duckduckgo",
}

_ZERO_WIDTH = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")


def _extra(env_value: str) -> list:
    return [w.strip().lower() for w in env_value.split(",") if w.strip()]


def _compile_keywords(words: Iterable[str]):
    return [
        (w, re.compile(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])"))
        for w in words
    ]


def _build():
    allow = _compile_keywords(ALLOW + _extra(getattr(config, "EXTRA_ALLOW", "")))
    distracting = []
    for words in DISTRACTING.values():
        distracting += _compile_keywords(words)
    distracting += _compile_keywords(_extra(getattr(config, "EXTRA_DISTRACTING", "")))
    regexes = [(label, re.compile(rx)) for label, rx in DISTRACTING_REGEX.items()]
    return allow, distracting, regexes


_ALLOW, _DISTRACTING, _REGEXES = _build()


def normalize(title: str) -> str:
    t = _ZERO_WIDTH.sub("", title or "").lower()
    return re.sub(r"\s+", " ", t).strip()


_SEP = "-\u2013\u2014|"
_BROWSER_TAIL = re.compile(
    r"\s[" + _SEP + r"]\s(?:" + "|".join(re.escape(b) for b in BROWSER_NAMES) + r")"
    r"(?:\s[" + _SEP + r"]\s[^" + _SEP + r"]+)?$"   # optional profile name: "- Google Chrome - Chloe"
)


def split_browser(title: str) -> Tuple[bool, str]:
    """If the normalized title ends in a browser name (optionally followed by a profile
    name), return (True, page_title)."""
    m = _BROWSER_TAIL.search(title)
    if m:
        return True, title[: m.start()].rstrip()
    return False, title


def active_window() -> Tuple[str, str]:
    """(title, process stem) of the foreground window; empty strings on failure."""
    if pwc is None:
        return "", ""
    try:
        win = pwc.getActiveWindow()
        if not win:
            return "", ""
        title = win.title or ""
        try:
            app = (win.getAppName() or "").lower()
        except Exception:
            app = ""
        app = app.replace("\\", "/").rsplit("/", 1)[-1]
        if app.endswith(".exe"):
            app = app[:-4]
        return title, app
    except Exception:
        return "", ""


def active_title() -> str:  # kept for backwards compatibility
    return active_window()[0]


def check_window(title: Optional[str] = None, app: Optional[str] = None) -> Optional[str]:
    """Returns a reason like 'window:instagram' if distracting, else None."""
    if title is None:
        title, app = active_window()
    t = normalize(title)
    app = (app or "").lower().replace("\\", "/").rsplit("/", 1)[-1]
    if app.endswith(".exe"):
        app = app[:-4]
    if not t:
        return None

    # 1. Native distracting apps (by process name).
    if app in APP_DISTRACTING:
        return f"app:{APP_DISTRACTING[app]}"

    is_browser, page = split_browser(t)
    if app in BROWSER_EXES:
        is_browser = True

    # 2. ALLOW wins over everything below.
    if any(rx.search(t) for _w, rx in _ALLOW):
        return None

    # 3. Installed web apps / unknown process: exact title only.
    if not is_browser:
        return f"window:{t}" if t in EXACT_TITLES else None

    # 4. Browser tab: keyword on word boundary, then regex rules.
    for word, rx in _DISTRACTING:
        if rx.search(page):
            return f"window:{word}"
    for label, rx in _REGEXES:
        if rx.search(page):
            return f"window:{label}"
    return None


if __name__ == "__main__":
    # Diagnostic: python window_watch.py   (Ctrl+C to stop). Click between windows and watch.
    import time
    print("Showing the foreground window every second. Switch to Chrome/Reddit and look at the output.")
    try:
        while True:
            t, a = active_window()
            print(f"title={t!r} app={a!r} -> {check_window(t, a)}")
            time.sleep(1)
    except KeyboardInterrupt:
        pass