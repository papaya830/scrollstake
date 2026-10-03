"""Pure timing logic (no OpenCV, no network) so it can be unit-tested.

Debounce          turns a flickery per-frame signal into a stable on/off state.
DistractionTimer  grace period + cooldown; decides when to fire an event.
"""
from typing import Optional, Tuple


class Debounce:
    """Active only after `on_after` seconds of continuous truthy input; stays active
    until the input has been falsy for `off_after` seconds."""

    def __init__(self, on_after: float = 0.0, off_after: float = 0.0):
        self.on_after = on_after
        self.off_after = off_after
        self._true_since: Optional[float] = None
        self._false_since: Optional[float] = None
        self._active = False
        self._reason: Optional[str] = None

    def reset(self) -> None:
        self.__init__(self.on_after, self.off_after)

    def update(self, now: float, reason: Optional[str]) -> Optional[str]:
        if reason:
            self._reason = reason
            self._false_since = None
            if self._true_since is None:
                self._true_since = now
            if not self._active and now - self._true_since >= self.on_after:
                self._active = True
        else:
            self._true_since = None
            if self._active:
                if self._false_since is None:
                    self._false_since = now
                if now - self._false_since >= self.off_after:
                    self._active = False
                    self._false_since = None
        return self._reason if self._active else None


class DistractionTimer:
    """Fires once when the (debounced) reason has been continuously present for
    `grace` seconds, then ignores input for `cooldown` seconds."""

    def __init__(self, grace: float, cooldown: float):
        self.grace = grace
        self.cooldown = cooldown
        self._since: Optional[float] = None
        self._cooldown_until = 0.0

    @property
    def elapsed_hint(self) -> Optional[float]:
        return self._since

    def update(self, now: float, reason: Optional[str]) -> Tuple[Optional[Tuple[str, float]], str]:
        """Returns (fired, status). `fired` is (reason, seconds) when an event should be sent."""
        if now < self._cooldown_until:
            self._since = None
            return None, f"cooldown {self._cooldown_until - now:0.0f}s"
        if not reason:
            self._since = None
            return None, "focused"
        if self._since is None:
            self._since = now
        elapsed = now - self._since
        if elapsed >= self.grace:
            self._since = None
            self._cooldown_until = now + self.cooldown
            return (reason, elapsed), "slash!"
        return None, f"distracted {elapsed:0.0f}/{self.grace:0.0f}s ({reason})"
