"""Active-window distraction check.

Browser tab titles appear in the window title, so we match keywords like
"instagram" or "reddit". ALLOW wins over DISTRACTING (e.g. "YouTube - lecture"
can be allowed by adding "lecture").
"""
from typing import Optional

try:
    import pywinctl as pwc
except Exception:  # missing permissions / unsupported platform
    pwc = None

# category -> keywords (lowercase). Extend with the team's site category list.
DISTRACTING = {
    "social": ["instagram", "tiktok", "twitter", "x.com", "facebook", "snapchat", "reddit", "threads"],
    "video": ["youtube", "netflix", "twitch", "hulu", "disney+", "prime video"],
    "shopping": ["amazon", "shein", "aliexpress"],
    "games": ["steam", "roblox", "miniclip"],
}

# Anything containing these is treated as focused, even if a distracting keyword also matches.
ALLOW = ["docs.google", "notion", "github", "stack overflow", "leetcode", "canvas", "lecture", "vscode", "cursor"]


def active_title() -> str:
    if pwc is None:
        return ""
    try:
        win = pwc.getActiveWindow()
        return (win.title or "") if win else ""
    except Exception:
        return ""


def check_window(title: Optional[str] = None) -> Optional[str]:
    """Returns a reason like 'window:instagram' if distracting, else None."""
    t = (title if title is not None else active_title()).lower()
    if not t:
        return None
    if any(a in t for a in ALLOW):
        return None
    for _category, words in DISTRACTING.items():
        for w in words:
            if w in t:
                return f"window:{w}"
    return None
