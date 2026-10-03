"""End-to-end check without webcam/Windows: fake API + patched window signal."""
import json, os, sys, threading, _thread, time
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.update(API_URL="http://127.0.0.1:8765", SESSION_CODE="AB12CD", CLIENT_TOKEN="tok", WALLET="W1",
                  GRACE_SECONDS="2", COOLDOWN_SECONDS="3")
got = []
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        got.append((self.path, self.headers.get("x-client-token"), body))
        out = json.dumps({"status": "forgiven", "livesLeft": 2, "strikes": 0}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
srv = HTTPServer(("127.0.0.1", 8765), H); threading.Thread(target=srv.serve_forever, daemon=True).start()

import main
state = {"t0": time.time()}
def fake_window():  # instagram for 5s, then focused
    return "window:instagram" if time.time() - state["t0"] < 5 else None
main.check_window = fake_window
sys.argv = ["main.py", "--no-cam"]
threading.Timer(9.0, _thread.interrupt_main).start()
main.main()
print("events received:", len(got))
for path, tok, body in got: print(path, tok, body)
assert len(got) == 1 and got[0][0] == "/api/events" and got[0][1] == "tok"
assert got[0][2]["type"] == "distraction" and got[0][2]["reason"] == "window:instagram" and got[0][2]["wallet"] == "W1"
print("e2e ok")
