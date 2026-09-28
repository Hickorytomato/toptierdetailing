export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const { subject, text, html } = await request.json();
    try {
      await env.EMAIL.send({
        to: "landeros14@icloud.com",
        from: { email: "requests@toptierdetailingok.com", name: "Top Tier Detailing" },
        subject: String(subject).slice(0, 200),
        text,
        html,
      });
      return Response.json({ ok: true });
    } catch (e) {
      console.error("send failed", e && e.message);
      return Response.json({ ok: false, error: String(e && e.message) }, { status: 502 });
    }
  },
};
