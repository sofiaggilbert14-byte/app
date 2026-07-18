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

    def test_guide_12h_default_window(self, api):
        """Iteration 6: store.tsx now uses api.guide(12, start) as the default window."""
        _wait_for_load(api)
        r = api.get(f"{BASE_URL}/api/guide?hours=12", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "channels" in d and "start" in d and "end" in d and "now" in d
        assert len(d["channels"]) > 500
        # window should be exactly 12h
        from datetime import datetime
        start = datetime.fromisoformat(d["start"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(d["end"].replace("Z", "+00:00"))
        delta_h = (end - start).total_seconds() / 3600
        assert 11.9 <= delta_h <= 12.1, f"Expected 12h window, got {delta_h}h"
        with_progs = [c for c in d["channels"] if c["programs"]]
        assert len(with_progs) > 100


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

    def test_refresh_updates_timestamp_and_status_reflects_it(self, api):
        """Iteration 3: verify POST /api/refresh actually re-imports the source
        and that GET /api/status/source reflects the new last_refresh.
        This is what the store's on-launch auto-refresh depends on."""
        _wait_for_load(api)
        before = api.get(f"{BASE_URL}/api/status/source", timeout=30).json()
        ts_before = before["last_refresh"]
        # small sleep to ensure the isoformat string will differ
        time.sleep(2)
        r = api.post(f"{BASE_URL}/api/refresh", timeout=180)
        assert r.status_code == 200
        refresh_body = r.json()
        assert refresh_body["last_refresh"] is not None
        assert refresh_body["last_refresh"] != ts_before, \
            "POST /api/refresh did not advance last_refresh"
        assert 500 < refresh_body["channel_count"] < 5000
        # status/source must now mirror the refreshed timestamp
        after = api.get(f"{BASE_URL}/api/status/source", timeout=30).json()
        assert after["last_refresh"] == refresh_body["last_refresh"]
        assert after["channel_count"] == refresh_body["channel_count"]
        assert after["refreshing"] is False
        assert after["error"] is None


# ---- settings ----
class TestSettings:
    def test_get_settings(self, api):
        r = api.get(f"{BASE_URL}/api/settings", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "m3u_url" in d and "epg_url" in d
        assert d["m3u_url"]


# ---- Iteration 8: Web-preview CORS proxy ----
class TestProxy:
    """GET /api/proxy?url=... is used ONLY by the web preview to bypass CORS
    when fetching m3u4u playlist/xml. Native app fetches m3u4u directly."""

    def test_proxy_fetches_m3u(self, api):
        m3u_url = "https://m3u4u.com/m3u/jwmzn1grpmu99585n721"
        r = api.get(f"{BASE_URL}/api/proxy", params={"url": m3u_url}, timeout=90)
        assert r.status_code == 200, f"proxy returned {r.status_code}: {r.text[:200]}"
        text = r.text
        assert "#EXTM3U" in text, "response is not an M3U playlist"
        # Should contain many #EXTINF entries (688 channels)
        assert text.count("#EXTINF") > 500, f"only {text.count('#EXTINF')} EXTINF lines"

    def test_proxy_fetches_epg_xml(self, api):
        epg_url = "https://m3u4u.com/xml/jwmzn1grpmu99585n721"
        r = api.get(f"{BASE_URL}/api/proxy", params={"url": epg_url}, timeout=120)
        assert r.status_code == 200, f"proxy returned {r.status_code}: {r.text[:200]}"
        text = r.text
        assert "<tv" in text and "<channel" in text, "response is not XMLTV"

    def test_proxy_rejects_invalid_scheme(self, api):
        r = api.get(f"{BASE_URL}/api/proxy", params={"url": "ftp://foo/bar"}, timeout=30)
        assert r.status_code == 400

    def test_proxy_rejects_relative_url(self, api):
        r = api.get(f"{BASE_URL}/api/proxy", params={"url": "/local/file"}, timeout=30)
        assert r.status_code == 400



# ---- Iteration 4: Admin Auth (case sensitive) ----
ADMIN_USER = "CharmCity"
ADMIN_PASS = "CharmCityExotics"
DEFAULT_M3U = "http://m3u4u.com/m3u/jwmzn1grpmu99585n721"
DEFAULT_EPG = "http://m3u4u.com/xml/jwmzn1grpmu99585n721"


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


class TestAuthLogin:
    def test_login_success(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_USER, "password": ADMIN_PASS},
            timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body and body["access_token"]
        assert body.get("token_type") == "bearer"

    def test_login_wrong_case_username(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "charmcity", "password": ADMIN_PASS},
            timeout=30,
        )
        assert r.status_code == 401

    def test_login_wrong_case_password(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_USER, "password": "charmcityexotics"},
            timeout=30,
        )
        assert r.status_code == 401

    def test_login_wrong_password(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": ADMIN_USER, "password": "wrong"},
            timeout=30,
        )
        assert r.status_code == 401

    def test_login_blank(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "", "password": ""},
            timeout=30,
        )
        assert r.status_code == 401


class TestAuthVerify:
    def test_verify_valid(self, api, admin_token):
        r = api.get(
            f"{BASE_URL}/api/auth/verify",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_verify_missing(self, api):
        s = requests.Session()  # no default content-type body
        r = s.get(f"{BASE_URL}/api/auth/verify", timeout=30)
        assert r.status_code == 401

    def test_verify_invalid(self, api):
        r = api.get(
            f"{BASE_URL}/api/auth/verify",
            headers={"Authorization": "Bearer not.a.jwt"},
            timeout=30,
        )
        assert r.status_code == 401


class TestProtectedSettings:
    def test_settings_post_requires_auth(self, api):
        r = api.post(
            f"{BASE_URL}/api/settings",
            json={"m3u_url": DEFAULT_M3U, "epg_url": DEFAULT_EPG},
            timeout=30,
        )
        assert r.status_code == 401

    def test_settings_post_updates_and_status_reflects(self, api, admin_token):
        _wait_for_load(api)
        before = api.get(f"{BASE_URL}/api/status/source", timeout=30).json()
        ts_before = before["last_refresh"]
        time.sleep(2)
        # Post default m3u4u URLs so we don't break the live guide.
        r = api.post(
            f"{BASE_URL}/api/settings",
            json={"m3u_url": DEFAULT_M3U, "epg_url": DEFAULT_EPG},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=180,
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        body = r.json()
        assert body["m3u_url"] == DEFAULT_M3U
        assert body["epg_url"] == DEFAULT_EPG
        assert body["last_refresh"] is not None
        assert body["last_refresh"] != ts_before

        # GET /api/status/source should mirror new last_refresh & URLs.
        after = api.get(f"{BASE_URL}/api/status/source", timeout=30).json()
        assert after["m3u_url"] == DEFAULT_M3U
        assert after["epg_url"] == DEFAULT_EPG
        assert after["last_refresh"] == body["last_refresh"]
        assert after["channel_count"] > 500

        # Confirm GET /api/settings also returns them (used by admin UI prefill).
        got = api.get(f"{BASE_URL}/api/settings", timeout=30).json()
        assert got["m3u_url"] == DEFAULT_M3U
        assert got["epg_url"] == DEFAULT_EPG
