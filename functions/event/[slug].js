export function onRequestGet(context) {
  const slug = context.params.slug;
  const eventUrl = `https://www.hdiohio.com/events/${encodeURIComponent(slug)}`;

  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HDI Ohio Event Calendar</title>
</head>
<body style="margin:0;padding:40px 20px;background:#eef6fb;color:#25313b;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;background:#ffffff;border-top:6px solid #1778b5;">
        <tr><td style="padding:44px 36px;text-align:center;">
          <div style="color:#1778b5;font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">HDI Ohio</div>
          <h1 style="margin:14px 0 0;color:#15324b;font-size:36px;line-height:1.15;">Event calendar link</h1>
          <p style="margin:22px 0 0;color:#65737e;font-size:17px;line-height:1.6;">The SilkStart event reader will use this route to build calendar options for each event.</p>
          <p style="margin:24px 0 0;"><a href="${eventUrl}" style="color:#1778b5;font-weight:bold;">View the source event on HDI Ohio</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}
