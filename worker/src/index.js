export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    };

    if (url.pathname === "/") {
      return Response.json(
        {
          service: "CharmIPTV API",
          status: "online",
          endpoints: ["/config", "/channels", "/guide"],
        },
        { headers }
      );
    }

    if (url.pathname === "/config") {
      return Response.json(
        {
          service: "CharmIPTV API",
          status: "online",
          playlistConfigured: Boolean(env.M3U_URL),
          epgConfigured: Boolean(env.EPG_URL),
        },
        { headers }
      );
    }

    if (url.pathname === "/channels") {
      if (!env.M3U_URL) {
        return Response.json(
          { error: "M3U_URL secret is not configured." },
          { status: 500, headers }
        );
      }

      return Response.json(
        {
          status: "ready",
          message: "Playlist secret is connected. Channel parsing is the next stage.",
        },
        { headers }
      );
    }

    if (url.pathname === "/guide") {
      if (!env.EPG_URL) {
        return Response.json(
          { error: "EPG_URL secret is not configured." },
          { status: 500, headers }
        );
      }

      return Response.json(
        {
          status: "ready",
          message: "EPG secret is connected. Guide parsing is the next stage.",
        },
        { headers }
      );
    }

    return Response.json(
      { error: "Endpoint not found." },
      { status: 404, headers }
    );
  },
};
