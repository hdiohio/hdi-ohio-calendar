const SOURCE_ORIGIN = "https://www.hdiohio.com";
const DEFAULT_TIME_ZONE = "America/New_York";

export async function onRequestGet(context) {
  const slug = String(context.params.slug || "").trim().toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return renderError(400, "Invalid event link", "This event link is not valid.");
  }

  const sourceUrl = `${SOURCE_ORIGIN}/events/${slug}`;
  const icsUrl = `${sourceUrl}/invite_ics.ics`;

  try {
    const response = await fetch(icsUrl, {
      headers: {
        "Accept": "text/calendar,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "HDI-Ohio-Calendar-Helper/1.0"
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 300
      }
    });

    if (!response.ok) {
      const status = response.status === 404 ? 404 : 502;
      const message = status === 404
        ? "We could not find that event on HDI Ohio."
        : "SilkStart did not return the event details. Please try again shortly.";

      return renderError(status, "Event unavailable", message, sourceUrl);
    }

    const event = parseCalendarEvent(await response.text(), sourceUrl, icsUrl);

    if (!event.title || !event.start || !event.end) {
      return renderError(
        502,
        "Event details unavailable",
        "The event was found, but its date and time could not be read.",
        sourceUrl
      );
    }

    return new Response(renderEventPage(event), {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (error) {
    console.error("Unable to load SilkStart event", error);
    return renderError(
      502,
      "Event temporarily unavailable",
      "We could not load this event from HDI Ohio. Please try again shortly.",
      sourceUrl
    );
  }
}

function parseCalendarEvent(calendarText, fallbackUrl, icsUrl) {
  const lines = unfoldCalendarLines(calendarText);
  const eventLines = [];
  let insideEvent = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      insideEvent = true;
      continue;
    }
    if (line === "END:VEVENT") break;
    if (insideEvent) eventLines.push(line);
  }

  const summary = getProperty(eventLines, "SUMMARY");
  const description = getProperty(eventLines, "DESCRIPTION");
  const location = getProperty(eventLines, "LOCATION");
  const url = getProperty(eventLines, "URL");
  const startProperty = getProperty(eventLines, "DTSTART");
  const endProperty = getProperty(eventLines, "DTEND");
  const timeZone = startProperty?.params.TZID || DEFAULT_TIME_ZONE;

  return {
    title: cleanText(summary?.value || "HDI Ohio Event"),
    description: cleanDescription(description?.value || ""),
    location: cleanText(location?.value || ""),
    sourceUrl: normalizeEventUrl(url?.value || fallbackUrl),
    icsUrl,
    start: parseCalendarDate(startProperty, timeZone),
    end: parseCalendarDate(endProperty, timeZone),
    timeZone,
    allDay: Boolean(startProperty?.params.VALUE === "DATE" || /^\d{8}$/.test(startProperty?.value || ""))
  };
}

function unfoldCalendarLines(calendarText) {
  const unfolded = [];

  for (const line of calendarText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function getProperty(lines, propertyName) {
  const prefix = propertyName.toUpperCase();

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) continue;

    const descriptor = line.slice(0, colonIndex);
    const [name, ...parameterParts] = descriptor.split(";");
    if (name.toUpperCase() !== prefix) continue;

    const params = {};
    for (const parameter of parameterParts) {
      const equalsIndex = parameter.indexOf("=");
      if (equalsIndex > 0) {
        params[parameter.slice(0, equalsIndex).toUpperCase()] = parameter.slice(equalsIndex + 1);
      }
    }

    return {
      params,
      value: unescapeCalendarText(line.slice(colonIndex + 1))
    };
  }

  return null;
}

function unescapeCalendarText(value) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function cleanText(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function cleanDescription(value) {
  return cleanText(value)
    .replace(/Registering on your phone\?.*?choose your quantity\./i, "")
    .replace(/@media only screen.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  const entities = {
    "&amp;": "&",
    "&apos;": "'",
    "&#39;": "'",
    "&quot;": "\"",
    "&lt;": "<",
    "&gt;": ">",
    "&ndash;": "–",
    "&mdash;": "—",
    "&bull;": "•",
    "&nbsp;": " "
  };

  return value.replace(/&(amp|apos|#39|quot|lt|gt|ndash|mdash|bull|nbsp);/gi, (match) => {
    return entities[match.toLowerCase()] || match;
  });
}

function parseCalendarDate(property, timeZone) {
  if (!property?.value) return null;

  const match = property.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0)
  };

  if (match[7] || property.params.TZID === "UTC" || property.params.VALUE === "DATE") {
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  }

  return zonedTimeToUtc(parts, timeZone);
}

function zonedTimeToUtc(parts, timeZone) {
  let utcTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = Object.fromEntries(
      formatter.formatToParts(new Date(utcTime))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
    const renderedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    utcTime += targetAsUtc - renderedAsUtc;
  }

  return new Date(utcTime);
}

function normalizeEventUrl(value) {
  try {
    const url = new URL(value);
    url.protocol = "https:";
    url.port = "";
    if (url.hostname === "hdiohio.com") url.hostname = "www.hdiohio.com";
    return url.toString();
  } catch {
    return value;
  }
}

function renderEventPage(event) {
  const googleUrl = buildGoogleCalendarUrl(event);
  const outlookUrl = buildOutlookCalendarUrl(event);
  const description = event.description || "View the HDI Ohio event page for full details and registration.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Add ${escapeHtml(event.title)} to your calendar.">
  <title>${escapeHtml(event.title)} | HDI Ohio Calendar</title>
  <style>
    :root { color-scheme:light; --navy:#15324b; --blue:#1778b5; --blue-dark:#0f5f91; --pale:#eef6fb; --text:#25313b; --muted:#65737e; --line:#d9e4eb; --white:#fff; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; padding:28px 18px; background:linear-gradient(145deg,var(--pale),var(--white) 65%); color:var(--text); font-family:Arial,Helvetica,sans-serif; }
    main { width:100%; max-width:760px; margin:0 auto; overflow:hidden; border-top:6px solid var(--blue); border-radius:9px; background:var(--white); box-shadow:0 18px 45px rgba(21,50,75,.13); }
    header { padding:42px 42px 30px; text-align:center; }
    .eyebrow { margin:0 0 12px; color:var(--blue); font-size:13px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    h1 { margin:0; color:var(--navy); font-size:clamp(30px,6vw,46px); line-height:1.1; }
    .details { margin:26px 0 0; padding:24px; border:1px solid var(--line); border-radius:8px; background:#fbfdfe; text-align:left; }
    .detail { display:grid; grid-template-columns:92px 1fr; gap:12px; padding:8px 0; }
    .label { color:var(--muted); font-size:13px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .value { color:var(--navy); font-size:16px; font-weight:700; line-height:1.45; }
    .description { margin:24px 0 0; color:var(--muted); font-size:16px; line-height:1.6; text-align:left; }
    .actions { padding:30px 42px 42px; background:var(--pale); text-align:center; }
    .actions h2 { margin:0 0 20px; color:var(--navy); font-size:24px; }
    .button { display:block; width:100%; margin:12px 0 0; padding:15px 18px; border:2px solid var(--blue); border-radius:6px; background:var(--blue); color:var(--white); font-size:16px; font-weight:700; line-height:1.2; text-decoration:none; }
    .button:hover, .button:focus { border-color:var(--blue-dark); background:var(--blue-dark); }
    .button.secondary { background:var(--white); color:var(--blue); }
    .button.secondary:hover, .button.secondary:focus { background:#f7fbfe; color:var(--blue-dark); }
    .source { margin:24px 0 0; color:var(--muted); font-size:14px; }
    .source a { color:var(--blue-dark); font-weight:700; }
    @media (max-width:560px) { body{padding:16px 10px;} header{padding:34px 22px 24px;} .actions{padding:26px 22px 32px;} .details{padding:18px;} .detail{grid-template-columns:1fr;gap:4px;} }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">HDI Ohio Event</p>
      <h1>${escapeHtml(event.title)}</h1>
      <div class="details">
        <div class="detail"><div class="label">Date</div><div class="value">${escapeHtml(formatDateLabel(event))}</div></div>
        <div class="detail"><div class="label">Time</div><div class="value">${escapeHtml(formatTimeLabel(event))}</div></div>
        ${event.location ? `<div class="detail"><div class="label">Location</div><div class="value">${escapeHtml(event.location)}</div></div>` : ""}
      </div>
      <p class="description">${escapeHtml(description)}</p>
    </header>
    <section class="actions" aria-labelledby="calendar-options">
      <h2 id="calendar-options">Add to your calendar</h2>
      <a class="button" href="${escapeAttribute(googleUrl)}" target="_blank" rel="noopener">Google Calendar</a>
      <a class="button" href="${escapeAttribute(outlookUrl)}" target="_blank" rel="noopener">Microsoft 365 / Outlook</a>
      <a class="button secondary" href="${escapeAttribute(event.icsUrl)}">Apple / Other Calendar (.ics)</a>
      <p class="source">Need more information? <a href="${escapeAttribute(event.sourceUrl)}">View event details and registration</a>.</p>
    </section>
  </main>
</body>
</html>`;
}

function buildGoogleCalendarUrl(event) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: event.allDay
      ? `${formatCompactDate(event.start)}/${formatCompactDate(event.end)}`
      : `${formatGoogleDate(event.start)}/${formatGoogleDate(event.end)}`,
    details: buildCalendarDescription(event),
    location: event.location
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookCalendarUrl(event) {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    body: buildCalendarDescription(event),
    location: event.location
  });
  if (event.allDay) params.set("allday", "true");
  return `https://outlook.office.com/calendar/action/compose?${params.toString()}`;
}

function buildCalendarDescription(event) {
  const detail = event.description ? `${event.description}\n\n` : "";
  return `${detail}Event details and registration: ${event.sourceUrl}`;
}

function formatDateLabel(event) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: event.timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(event.start);
}

function formatTimeLabel(event) {
  if (event.allDay) return "All day";
  const start = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timeZone,
    hour: "numeric",
    minute: "2-digit"
  }).format(event.start);
  const end = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(event.end);
  return `${start}–${end}`;
}

function formatGoogleDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatCompactDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function renderError(status, title, message, sourceUrl = SOURCE_ORIGIN) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | HDI Ohio Calendar</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#eef6fb;color:#25313b;font-family:Arial,Helvetica,sans-serif;">
  <main style="width:100%;max-width:640px;padding:42px;border-top:6px solid #1778b5;border-radius:8px;background:#fff;box-shadow:0 18px 45px rgba(21,50,75,.13);text-align:center;">
    <div style="color:#1778b5;font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">HDI Ohio</div>
    <h1 style="margin:14px 0 0;color:#15324b;font-size:36px;line-height:1.15;">${escapeHtml(title)}</h1>
    <p style="margin:20px 0 0;color:#65737e;font-size:17px;line-height:1.6;">${escapeHtml(message)}</p>
    <p style="margin:28px 0 0;"><a href="${escapeAttribute(sourceUrl)}" style="color:#1778b5;font-weight:bold;">View HDI Ohio events</a></p>
  </main>
</body>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
