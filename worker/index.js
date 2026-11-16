export default {
  async fetch(request, env) {
    // A Sites/Workers deployment must never expose database backup binaries.
    const pathname = new URL(request.url).pathname;
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (/\.(?:back|db|sqlite|sqlite3|dump|sql)(?:\.gz)?$/i.test(decodedPath)) {
      return new Response("Not found", { status: 404 });
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
