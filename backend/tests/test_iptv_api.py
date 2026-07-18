"""Backend API tests for Charm IPTV / GridStream backend."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://iptv-player-guide.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _wait_for_load(api, timeout=90):
    """Wait until backend has loaded channels."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = api.get(f"{BASE_URL}/api/status/source", timeout=30)
        if r.status_code == 200 and r.json().get("channel_count", 0) > 0:
            return r.json()
        time.sleep(3)
    pytest.fail("Backend never loaded channels in time")


# ---- status/source ----
class TestStatus:
    def test_source_status(self, api):
        data = _wait_for_load(api)
        assert data["channel_count"] > 500, f"Expected ~688 channels, got {data['channel_count']}"
        assert data["channels_with_epg"] > 500, f"Expected ~665 with EPG, got {data['channels_with_epg']}"
        assert data["last_refresh"] is not None
        assert data["m3u_url"]
        assert data["epg_url"]


# ---- channels ----
class TestChannels:
    def test_channels_list(self, api):
        _wait_for_load(api)
        r = api.get(f"{BASE_URL}/api/channels", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["count"] == len(d["channels"])
        assert d["count"] > 500
        c = d["channels"][0]
        for k in ("id", "name", "url", "stream_type", "logo", "tvg_id"):
            assert k in c


# ---- guide ----
class TestGuide:
    def test_guide_24h(self, api):
        _wait_for_load(api)
        r = api.get(f"{BASE_URL}/api/guide?hours=24", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "channels" in d and "start" in d and "end" in d and "now" in d
        assert len(d["channels"]) > 500
        ch = d["channels"][0]
        for k in ("id", "name", "logo", "url", "stream_type", "programs"):
            assert k in ch, f"channel missing key {k}"
        # at least one channel should have programs
        with_progs = [c for c in d["channels"] if c["programs"]]
        assert len(with_progs) > 100
        p = with_progs[0]["programs"][0]
        assert "title" in p and "start" in p and "stop" in p


# ---- search ----
class TestSearch:
    def test_search_espn(self, api):
        _wait_for_load(api)
        r = api.get(f"{BASE_URL}/api/search", params={"q": "espn"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "channels" in d and "programs" in d
        # At least channels or programs should return
        assert len(d["channels"]) > 0 or len(d["programs"]) > 0
        for c in d["channels"]:
            assert "espn" in c["name"].lower()


# ---- refresh ----
class TestRefresh:
    def test_force_refresh(self, api):
        _wait_for_load(api)
        r = api.post(f"{BASE_URL}/api/refresh", timeout=120)
        assert r.status_code == 200
        d = r.json()
        assert d["channel_count"] > 500
        assert d["last_refresh"] is not None


# ---- settings ----
class TestSettings:
    def test_get_settings(self, api):
        r = api.get(f"{BASE_URL}/api/settings", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "m3u_url" in d and "epg_url" in d
        assert d["m3u_url"]
