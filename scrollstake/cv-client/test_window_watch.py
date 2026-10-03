"""Run with:  python test_window_watch.py   (or pytest)"""
from window_watch import check_window
from trigger import Debounce, DistractionTimer

# (title, process, expected reason or None)
CASES = [
    # --- should trip -------------------------------------------------------
    ("Instagram - Google Chrome", "chrome", "window:instagram"),
    ("(3) Instagram \u2022 Direct - Google Chrome", "chrome", "window:instagram"),
    ("TikTok - Make Your Day - Microsoft\u200b Edge", "msedge", "window:tiktok"),
    ("Funny cats (r/aww) : reddit - Mozilla Firefox", "firefox", "window:reddit"),
    ("reddit: the front page of the internet - Brave", "brave", "window:reddit"),
    ("Funny cat videos - YouTube - Google Chrome", "chrome", "window:youtube"),
    ("(2) Home / X - Google Chrome", "chrome", "window:x"),
    ("Watch Netflix - Google Chrome", "chrome", "window:netflix"),
    ("Amazon.com: gaming chair - Google Chrome", "chrome", "window:amazon"),
    ("Instagram", "", "window:instagram"),            # installed web app, exact title
    ("Steam", "steam", "app:steam"),                  # native app by process
    ("Welcome to Steam - Google Chrome", "chrome", "window:welcome to steam"),
    ("Reddit - The heart of the internet - Google Chrome - Chloe", "chrome", "window:reddit"),
    ("Reddit - The heart of the internet - Google Chrome - Chloe", "", "window:reddit"),
    ("Instagram and 2 more pages - Personal - Microsoft Edge", "msedge", "window:instagram"),
    ("Reddit - Dive into anything", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "window:reddit"),
    ("r/Vancouver - Google Chrome - Chloe", "chrome", "window:reddit"),
    ("r/AskReddit - Google Chrome", "chrome", "window:reddit"),
    ("(2) r/programming - Google Chrome", "chrome", "window:reddit"),
    ("u/spez - Google Chrome", "chrome", "window:reddit"),
    ("Best pizza in town? : r/vancouver - Google Chrome", "chrome", "window:reddit"),
    # --- must NOT trip (false-positive traps) ------------------------------
    ("R/W permissions explained - Google Chrome", "chrome", None),
    ("Read/write speeds - Google Chrome", "chrome", None),
    ("r/programming - GitHub - Google Chrome", "chrome", None),
    ("my_notes_r/askreddit.txt - Visual Studio Code", "code", None),
    ("reddit_scraper.py - scrollstake - Visual Studio Code", "code", None),
    ("Java threads tutorial - Google Chrome", "chrome", None),
    ("Multi-threads vs processes - Google Chrome", "chrome", None),
    ("Dropbox.com - Google Chrome", "chrome", None),
    ("Linux.com - Google Chrome", "chrome", None),
    ("Steam engine essay.docx - Word", "winword", None),
    ("Amazon Web Services - Google Chrome", "chrome", None),
    ("S3 buckets - Amazon S3 - Google Chrome", "chrome", None),
    ("CS 61A Lecture 5 - YouTube - Google Chrome", "chrome", None),
    ("lofi hip hop radio - YouTube - Google Chrome", "chrome", None),
    ("Solana docs - Reddit - Google Chrome", "chrome", None),   # allow wins ties
    ("GitHub - instagram/instagram - Google Chrome", "chrome", None),
    ("Terminal - python main.py", "windowsterminal", None),
    ("Notion - Google Chrome", "chrome", None),
    ("", "", None),
    ("Untitled - Notepad", "notepad", None),
    ("Pixel art tips - Google Chrome", "chrome", None),
    ("Mix - Google Chrome", "chrome", None),
]


def test_window_cases():
    bad = []
    for title, app, want in CASES:
        got = check_window(title, app)
        if got != want:
            bad.append((title, app, want, got))
    assert not bad, "\n".join(f"{t!r} [{a}] want={w} got={g}" for t, a, w, g in bad)


def test_debounce_bridges_flicker_and_requires_sustain():
    d = Debounce(on_after=1.5, off_after=1.5)
    assert d.update(0.0, "cam:x") is None            # not yet sustained
    assert d.update(1.0, "cam:x") is None
    assert d.update(1.6, "cam:x") == "cam:x"         # now active
    assert d.update(2.0, None) == "cam:x"            # brief gap bridged
    assert d.update(2.5, "cam:x") == "cam:x"
    assert d.update(3.0, None) == "cam:x"
    assert d.update(4.6, None) is None               # gap > off_after, streak broken


def test_single_blip_never_activates():
    d = Debounce(on_after=1.5, off_after=1.5)
    assert d.update(0.0, "cam:x") is None
    assert d.update(0.4, None) is None
    assert d.update(0.8, "cam:x") is None
    assert d.update(1.2, None) is None


def test_timer_fires_once_then_cooldown():
    t = DistractionTimer(grace=10, cooldown=15)
    fired, _ = t.update(0.0, "window:instagram")
    assert fired is None
    fired, _ = t.update(9.9, "window:instagram")
    assert fired is None
    fired, _ = t.update(10.0, "window:instagram")
    assert fired == ("window:instagram", 10.0)
    for now in (11.0, 20.0, 24.9):                    # cooldown: nothing fires
        assert t.update(now, "window:instagram")[0] is None
    assert t.update(25.0, "window:instagram")[0] is None      # grace restarts
    assert t.update(35.0, "window:instagram")[0] is not None  # fires again


def test_timer_resets_when_focus_returns():
    t = DistractionTimer(grace=10, cooldown=15)
    t.update(0.0, "window:x")
    t.update(8.0, "window:x")
    t.update(8.5, None)
    assert t.update(9.0, "window:x")[0] is None
    assert t.update(18.0, "window:x")[0] is None     # only 9s since restart
    assert t.update(19.0, "window:x")[0] is not None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok  ", name)
    print("all passed")