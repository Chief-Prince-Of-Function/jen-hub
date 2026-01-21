const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isAllowedIcsUrl(url) {
  return url.startsWith(
    "https://rest.cozi.com/api/ext/1103/8df50700-4210-4b27-9d16-bacc9b9468a7/icalendar/feed/feed.ics",
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ics") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const target = url.searchParams.get("url");
      if (!target) {
        return new Response("Missing url parameter.", {
          status: 400,
          headers: corsHeaders,
        });
      }

      if (!isAllowedIcsUrl(target)) {
        return new Response("URL not allowed.", {
          status: 403,
          headers: corsHeaders,
        });
      }

      const upstream = await fetch(target, {
        cf: { cacheEverything: true, cacheTtl: 300 },
      });
      const contentType =
        upstream.headers.get("content-type") || "text/calendar; charset=utf-8";

      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": contentType,
          ...corsHeaders,
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
