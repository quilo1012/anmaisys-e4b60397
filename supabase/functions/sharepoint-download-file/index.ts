import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/microsoft_sharepoint';

type GatewayResult =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; status: number; body: string };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isMsaAccountError(body: string) {
  return /This API is not supported for MSA accounts|no addressUrl for Microsoft\.FileServices/i.test(body);
}

function sharePointFallback(body: string) {
  return json({
    fallback: true,
    code: 'MSA_ACCOUNT_NOT_SUPPORTED',
    error: 'This Microsoft connection is a personal Microsoft account, so Graph cannot download SharePoint/Excel files through the connector.',
    message: 'Use an organisation/work SharePoint connection, or download the Excel file and upload it manually in this dialog.',
    details: body.slice(0, 500),
  });
}

function normalizeShareUrl(input: string) {
  return input
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^<(.+)>$/, '$1')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function encodePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function getDirectSharePointParts(rawUrl: string) {
  const url = new URL(rawUrl);
  const hostname = url.hostname;
  if (!hostname.includes('sharepoint.com') && !hostname.includes('onedrive.com')) return null;

  let parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));

  // Browser/file URLs often look like /:x:/r/sites/Site/Shared Documents/File.xlsx
  if (parts[0]?.startsWith(':') && parts[1] === 'r') parts = parts.slice(2);

  const root = parts[0];
  if (!root || !['sites', 'teams', 'personal'].includes(root) || !parts[1]) return null;

  const sitePath = `${root}/${parts[1]}`;
  const remaining = parts.slice(2);
  if (!remaining.length) return null;

  return { hostname, sitePath, remaining };
}

async function gatewayFetch(path: string, lovableKey: string, connectionKey: string): Promise<GatewayResult> {
  const resp = await fetch(`${GATEWAY_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': connectionKey,
    },
    redirect: 'follow',
  });

  if (!resp.ok) return { ok: false, status: resp.status, body: await resp.text() };
  return { ok: true, buffer: await resp.arrayBuffer() };
}

async function downloadByDirectPath(rawUrl: string, lovableKey: string, connectionKey: string): Promise<GatewayResult | null> {
  const parsed = getDirectSharePointParts(rawUrl);
  if (!parsed) return null;

  const siteResp = await fetch(`${GATEWAY_URL}/sites/${parsed.hostname}:/${encodePath(parsed.sitePath)}`, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': connectionKey,
    },
  });

  if (!siteResp.ok) {
    return { ok: false, status: siteResp.status, body: await siteResp.text() };
  }

  const site = await siteResp.json();
  if (!site?.id) return { ok: false, status: 404, body: 'SharePoint site not found' };

  const [libraryName, ...fileParts] = parsed.remaining;
  const defaultLibraryNames = new Set(['shared documents', 'documents']);
  const defaultDrivePath = defaultLibraryNames.has(libraryName.toLowerCase())
    ? fileParts.join('/')
    : parsed.remaining.join('/');

  if (defaultDrivePath) {
    const defaultResp = await gatewayFetch(
      `/sites/${encodeURIComponent(site.id)}/drive/root:/${encodePath(defaultDrivePath)}:/content`,
      lovableKey,
      connectionKey,
    );
    if (defaultResp.ok) return defaultResp;
  }

  // Fallback for files stored in a non-default document library.
  const drivesResp = await fetch(`${GATEWAY_URL}/sites/${encodeURIComponent(site.id)}/drives`, {
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': connectionKey,
    },
  });

  if (!drivesResp.ok) return { ok: false, status: drivesResp.status, body: await drivesResp.text() };

  const drives = await drivesResp.json();
  const drive = Array.isArray(drives?.value)
    ? drives.value.find((d: { name?: string }) => d.name?.toLowerCase() === libraryName.toLowerCase())
    : null;

  if (!drive?.id || !fileParts.length) {
    return { ok: false, status: 404, body: 'SharePoint file path could not be resolved' };
  }

  return gatewayFetch(
    `/sites/${encodeURIComponent(site.id)}/drives/${encodeURIComponent(drive.id)}/root:/${encodePath(fileParts.join('/'))}:/content`,
    lovableKey,
    connectionKey,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const CONN_KEY = Deno.env.get('MICROSOFT_SHAREPOINT_API_KEY');
    if (!LOVABLE_API_KEY || !CONN_KEY) {
      return json({ error: 'SharePoint connection not configured' }, 500);
    }

    // Auth: any signed-in user
    const auth = req.headers.get('Authorization');
    if (!auth) {
      return json({ error: 'unauthorized' }, 401);
    }

    const { shareUrl } = await req.json();
    if (!shareUrl || typeof shareUrl !== 'string') {
      return json({ error: 'shareUrl required' }, 400);
    }

    const normalizedUrl = normalizeShareUrl(shareUrl);
    try {
      const parsedUrl = new URL(normalizedUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('invalid protocol');
    } catch (_) {
      return json({ error: 'Invalid SharePoint URL. Paste the full file link copied from SharePoint/Excel.' }, 400);
    }

    // Encode share URL per Graph spec: base64url with "u!" prefix
    const encodedId = `u!${toBase64Url(normalizedUrl)}`;
    let result = await gatewayFetch(`/shares/${encodeURIComponent(encodedId)}/driveItem/content`, LOVABLE_API_KEY, CONN_KEY);

    if (!result.ok && (isMsaAccountError(result.body) || /invalid shares key/i.test(result.body))) {
      const directResult = await downloadByDirectPath(normalizedUrl, LOVABLE_API_KEY, CONN_KEY);
      if (directResult) result = directResult;
    }

    if (!result.ok) {
      if (isMsaAccountError(result.body)) {
        return sharePointFallback(result.body);
      }

      return json({
        error: `SharePoint download failed (${result.status}). Use a direct Excel file link from SharePoint/Excel with access for this Microsoft connection.`,
        details: result.body.slice(0, 500),
      }, 502);
    }

    const buf = new Uint8Array(result.buffer);
    // base64 encode
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const base64 = btoa(bin);

    return json({ base64, size: buf.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
