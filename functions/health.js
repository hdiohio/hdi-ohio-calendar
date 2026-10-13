export function onRequestGet() {
  return Response.json({
    ok: true,
    service: "hdi-ohio-calendar",
    status: "ready"
  }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
