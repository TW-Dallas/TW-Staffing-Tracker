// Cloudflare Pages Function: /api/staffing
// Handles sub-millisecond D1 SQLite reads & atomic writes for Team Wow Staffing Tracker & Admin Hub

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxQVuU0uQ3TdkfsBwJpZ-K1iUDXTuLgvqEayPeqZgSRLDNxHOEUsOrjaSZAujI8p_874g/exec";

// CORS Headers Helper with optional Edge Cache-Control
function corsHeaders(cacheSecs = 0) {
    const h = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Content-Type": "application/json;charset=utf-8"
    };
    if (cacheSecs > 0) {
        h["Cache-Control"] = `public, max-age=${cacheSecs}, s-maxage=${cacheSecs}`;
    } else {
        h["Cache-Control"] = "no-store";
    }
    return h;
}

// Robust Google Apps Script Proxy Dispatcher
// Automatically attaches query authentication for redirect stability and ensures response consumption & worker lifecycle management
async function callAppsScriptProxy(payload, context = null) {
    const isDenver = (payload.market || payload.city || "").toLowerCase() === "denver";
    // Internal server-to-server microservice credentials (bypasses any invalid client localStorage credentials)
    const username = isDenver ? "denver_admin" : "dallas_admin";
    const password = isDenver ? "denver_password_123" : "dallas_password_123";
    const market = payload.market || payload.city || (isDenver ? "Denver" : "Dallas");
    const action = payload.action || "";

    const gasPayload = {
        ...payload,
        username,
        password,
        market,
        city: market
    };

    const gasQuery = new URLSearchParams({
        username,
        password,
        city: market,
        market: market,
        action: action
    }).toString();

    const gasUrl = `${APPS_SCRIPT_URL}${APPS_SCRIPT_URL.includes('?') ? '&' : '?'}${gasQuery}`;

    const fetchPromise = (async () => {
        try {
            const res = await fetch(gasUrl, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(gasPayload),
                redirect: "follow"
            });
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                return { success: res.ok, raw: text };
            }
        } catch (err) {
            console.error(`Apps Script proxy error (${action}):`, err);
            return { success: false, error: err.message };
        }
    })();

    if (context && typeof context.waitUntil === "function") {
        context.waitUntil(fetchPromise);
    }

    return fetchPromise;
}

// Current timestamp formatted for Team Wow (e.g. "9/17/2026 10:20 AM")
function getNowFormatted(timeZone = "America/Chicago") {
    const d = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
    return formatter.format(d).replace(',', '');
}

// Helper to parse dates into timestamps for chronological sorting
function parseDateForSort(dateStr) {
    if (!dateStr) return 0;
    const parts = String(dateStr).split('/');
    if (parts.length === 3) {
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        let y = parseInt(parts[2], 10);
        if (y < 100) y += 2000;
        return new Date(y, m - 1, d).getTime();
    }
    const t = Date.parse(dateStr);
    return isNaN(t) ? 0 : t;
}

// Security token generator for 1-click mobile GM approval/denial links
function generateGmDecisionToken(pulseId, pin) {
    const salt = "TwGmAccessEdgeSalt2026";
    const str = `${String(pulseId).toLowerCase().trim()}:${String(pin).trim()}:${salt}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

// HTML renderer for 1-click email actions (approval, denial, deletion)
function renderActionHtml(title, message, headerColor) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} • Team Wow Staffing Command</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #fefaf6; margin: 0; padding: 30px 16px; color: #472b10; display: flex; justify-content: center; align-items: center; min-height: 85vh; }
        .card { background: white; max-width: 480px; width: 100%; border-radius: 14px; border: 2px solid #ebd9c8; box-shadow: 0 10px 30px rgba(71, 43, 16, 0.12); overflow: hidden; text-align: center; }
        .header { background-color: ${headerColor || '#005c91'}; color: white; padding: 24px 20px; }
        .header h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
        .body { padding: 28px 24px; font-size: 15px; line-height: 1.6; color: #472b10; }
        .portal-btn { display: inline-block; margin-top: 22px; background-color: #005c91; color: #ffffff !important; text-decoration: none; padding: 11px 22px; border-radius: 25px; font-weight: bold; font-size: 13.5px; box-shadow: 0 3px 8px rgba(0, 92, 145, 0.25); }
        .portal-btn:hover { background-color: #004b75; }
        .footer { font-size: 12.5px; color: #7a5c43; border-top: 1px solid #f0decc; padding: 14px 20px; background-color: #faf2e9; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <h2>${title}</h2>
        </div>
        <div class="body">
            <div style="margin-bottom: 16px;">
                <img src="https://teamwow-assets.pages.dev/image/custom-emojis/manager_lock.png" alt="Domino's Security" style="width: 52px; height: 52px; object-fit: contain;">
            </div>
            <div>${message}</div>
            <div>
                <a href="https://tw-staffing.pages.dev" class="portal-btn">&#128274; Go to GM Staffing Command</a>
            </div>
        </div>
        <div class="footer">
            Team Wow Staffing Command &bull; Direct Cloudflare D1 Edge Authorization
        </div>
    </div>
</body>
</html>`;
}

// Domino's Fiscal Period Calendar Definitions (2025-2027)
const DOMINOS_FISCAL_CALENDARS = [
    // 2025
    { period: "P01", start: "2024-12-30", end: "2025-01-26" },
    { period: "P02", start: "2025-01-27", end: "2025-02-23" },
    { period: "P03", start: "2025-02-24", end: "2025-03-23" },
    { period: "P04", start: "2025-03-24", end: "2025-04-20" },
    { period: "P05", start: "2025-04-21", end: "2025-05-18" },
    { period: "P06", start: "2025-05-19", end: "2025-06-15" },
    { period: "P07", start: "2025-06-16", end: "2025-07-13" },
    { period: "P08", start: "2025-07-14", end: "2025-08-10" },
    { period: "P09", start: "2025-08-11", end: "2025-09-07" },
    { period: "P10", start: "2025-09-08", end: "2025-10-05" },
    { period: "P11", start: "2025-10-06", end: "2025-11-02" },
    { period: "P12", start: "2025-11-03", end: "2025-11-30" },
    { period: "P13", start: "2025-12-01", end: "2025-12-28" },
    // 2026
    { period: "P01", start: "2025-12-29", end: "2026-01-25" },
    { period: "P02", start: "2026-01-26", end: "2026-02-22" },
    { period: "P03", start: "2026-02-23", end: "2026-03-22" },
    { period: "P04", start: "2026-03-23", end: "2026-04-19" },
    { period: "P05", start: "2026-04-20", end: "2026-05-17" },
    { period: "P06", start: "2026-05-18", end: "2026-06-14" },
    { period: "P07", start: "2026-06-15", end: "2026-07-12" },
    { period: "P08", start: "2026-07-13", end: "2026-08-09" },
    { period: "P09", start: "2026-08-10", end: "2026-09-06" },
    { period: "P10", start: "2026-09-07", end: "2026-10-04" },
    { period: "P11", start: "2026-10-05", end: "2026-11-01" },
    { period: "P12", start: "2026-11-02", end: "2026-11-29" },
    { period: "P13", start: "2026-11-30", end: "2026-12-27" },
    // 2027
    { period: "P01", start: "2026-12-28", end: "2027-01-24" },
    { period: "P02", start: "2027-01-25", end: "2027-02-21" },
    { period: "P03", start: "2027-02-22", end: "2027-03-21" },
    { period: "P04", start: "2027-03-22", end: "2027-04-18" },
    { period: "P05", start: "2027-04-19", end: "2027-05-16" },
    { period: "P06", start: "2027-05-17", end: "2027-06-13" },
    { period: "P07", start: "2027-06-14", end: "2027-07-11" },
    { period: "P08", start: "2027-07-12", end: "2027-08-08" },
    { period: "P09", start: "2027-08-09", end: "2027-09-05" },
    { period: "P10", start: "2027-09-06", end: "2027-10-03" },
    { period: "P11", start: "2027-10-04", end: "2027-10-31" },
    { period: "P12", start: "2027-11-01", end: "2027-11-28" },
    { period: "P13", start: "2027-11-29", end: "2027-12-26" }
];

function calculateDominosPeriod(dateInput) {
    if (!dateInput) return "P10";
    let d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) {
        const parts = String(dateInput).split(/[-/]/);
        if (parts.length === 3) {
            let m, day, y;
            if (parts[0].length === 4) {
                y = parseInt(parts[0], 10);
                m = parseInt(parts[1], 10);
                day = parseInt(parts[2], 10);
            } else {
                m = parseInt(parts[0], 10);
                day = parseInt(parts[1], 10);
                y = parseInt(parts[2], 10);
            }
            d = new Date(y, m - 1, day);
        }
    }
    if (isNaN(d.getTime())) return "P10";

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const formatted = `${yyyy}-${mm}-${dd}`;

    for (let i = 0; i < DOMINOS_FISCAL_CALENDARS.length; i++) {
        if (formatted >= DOMINOS_FISCAL_CALENDARS[i].start && formatted <= DOMINOS_FISCAL_CALENDARS[i].end) {
            return DOMINOS_FISCAL_CALENDARS[i].period;
        }
    }
    return "P10";
}

function formatTimeDisplay(tStr) {
    if (!tStr && tStr !== 0) return '';
    let rawStr = tStr.toString().trim();
    if (rawStr.includes("1899") || rawStr.includes("GMT") || rawStr.includes("T")) {
        const tMatch = rawStr.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
        if (tMatch) {
            let h = parseInt(tMatch[1], 10);
            let m = parseInt(tMatch[2], 10);
            let period = h >= 12 ? "PM" : "AM";
            let displayH = h % 12 || 12;
            let displayM = m < 10 ? "0" + m : m;
            return `${displayH}:${displayM} ${period}`;
        }
    }
    return rawStr;
}

// Automatically syncs any candidates with hired = 1 in onboarding_candidates into staffing_records
async function syncHiredCandidatesToStaffing(db, market) {
    try {
        const missingHires = await db.prepare(`
            SELECT c.id, c.market, c.name, c.position, c.store_num, c.do_name, c.nto_date, c.created_at
            FROM onboarding_candidates c
            WHERE c.market = ? AND c.hired = 1 AND TRIM(c.name) != ''
              AND NOT EXISTS (
                SELECT 1 FROM staffing_records s
                WHERE s.market = c.market AND (
                  (s.id IS NOT NULL AND s.id != '' AND s.id = c.id)
                  OR (LOWER(TRIM(s.name)) = LOWER(TRIM(c.name)) AND s.store_num = c.store_num)
                )
              )
        `).bind(market).all();

        if (!missingHires || !missingHires.results || missingHires.results.length === 0) {
            return 0;
        }

        const stores = await db.prepare("SELECT store_number, do_name FROM stores WHERE market = ?").bind(market).all();
        const storeDoMap = new Map();
        (stores.results || []).forEach(s => {
            if (s.store_number && s.do_name) {
                storeDoMap.set(String(s.store_number).trim(), s.do_name.trim());
            }
        });

        const now = new Date();
        const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
        const dateStr = now.toLocaleDateString("en-US", { timeZone: tz });

        const statements = [];
        for (const cand of missingHires.results) {
            const rawHireDate = cand.nto_date || dateStr;
            const period = calculateDominosPeriod(rawHireDate);
            const resolvedDo = (cand.do_name || '').trim() || storeDoMap.get(String(cand.store_num || '').trim()) || '';
            const newId = cand.id || `STF-ID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            statements.push(db.prepare(`
                INSERT INTO staffing_records (
                    id, market, fiscal_year, period, store_num, do_name, gm_name, name, position,
                    hire_date, term_date, rehire_eligible, cause_of_action, reason_of_action, notes,
                    received_date, source_sheet, updated_at
                ) VALUES (?, ?, 2026, ?, ?, ?, '', ?, ?, ?, '', 'Yes', '', '', '', '', 'Auto-Hired from NTO', CURRENT_TIMESTAMP)
            `).bind(
                newId,
                cand.market || market,
                period,
                cand.store_num || '',
                resolvedDo,
                cand.name || '',
                cand.position || 'CSR',
                rawHireDate
            ));
        }

        if (statements.length > 0) {
            await db.batch(statements);
            console.log(`Auto-synced ${statements.length} hired candidates to staffing_records for ${market}`);
        }
        return statements.length;
    } catch (err) {
        console.error("Error in syncHiredCandidatesToStaffing:", err);
        return 0;
    }
}

export async function onRequestOptions() {
    return new Response(null, { headers: corsHeaders(), status: 204 });
}

// ---------------------------------------------------------------------------
// GET Handler: Hydrates Admin Hub & Store GM Dashboards
// ---------------------------------------------------------------------------
export async function onRequestGet(context) {
    const { request, env } = context;
    const db = env.DB || env.tw_team_data;

    if (!db) {
        return new Response(JSON.stringify({ error: "D1 database binding 'DB' not configured" }), {
            status: 500,
            headers: corsHeaders()
        });
    }

    const url = new URL(request.url);
    const reqAction = url.searchParams.get("action");
    let market = url.searchParams.get("market") || url.searchParams.get("city") || "Dallas";
    market = market.toLowerCase() === "denver" ? "Denver" : "Dallas";

    // Fast endpoint for Trainer / Staff PIN verification & auth check
    if (reqAction === "verifyPin" || reqAction === "checkAuth") {
        const rawPin = url.searchParams.get("pin") || "";
        const cleanPin = String(rawPin).replace(/\D/g, '').padStart(4, '0');
        if (!cleanPin || cleanPin.length !== 4) {
            return new Response(JSON.stringify({ success: false, error: "Please enter a valid 4-digit PIN." }), {
                status: 400,
                headers: corsHeaders()
            });
        }
        const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE trainer_pin = ? AND is_active = 1 LIMIT 1").bind(cleanPin).first();
        if (!trainer) {
            return new Response(JSON.stringify({ success: false, error: "Invalid or inactive PIN. Access denied." }), {
                status: 401,
                headers: corsHeaders()
            });
        }

        // Log Staffing Command access in credential_usage_logs
        try {
            await db.prepare(`
                INSERT INTO credential_usage_logs (trainer_id, trainer_name, store_num, portal, action, metadata, created_at)
                VALUES (?, ?, ?, 'Staffing Tracker', 'Staffing Command Unlock', ?, CURRENT_TIMESTAMP)
            `).bind(
                trainer.trainer_id,
                trainer.trainer_name,
                trainer.store_num,
                JSON.stringify({ role: trainer.role, market: trainer.market })
            ).run();
        } catch (_) {}

        return new Response(JSON.stringify({
            success: true,
            user: {
                trainer_id: trainer.trainer_id,
                name: trainer.trainer_name,
                pin: trainer.trainer_pin,
                store: trainer.store_num,
                market: trainer.market,
                role: trainer.role,
                is_gm: !!trainer.is_gm,
                is_do: !!trainer.is_do,
                is_admin: !!trainer.is_admin,
                is_exec: !!trainer.is_exec
            }
        }), {
            status: 200,
            headers: corsHeaders()
        });
    }

    // 1-Click Mobile Decision Endpoint for Mike Jacobs (Approve/Deny GM Access)
    if (reqAction === "decideGmAccess") {
        const pulseId = (url.searchParams.get("id") || "").trim();
        const pin = (url.searchParams.get("pin") || "").trim();
        const token = (url.searchParams.get("token") || "").trim();
        const decision = (url.searchParams.get("decision") || "").toLowerCase().trim();

        if (!pulseId || !pin || !token || !decision) {
            return new Response(renderActionHtml("Invalid Request", "Missing required authorization parameters.", "#910000"), {
                status: 400,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        const expectedToken = generateGmDecisionToken(pulseId, pin);
        if (token !== expectedToken) {
            return new Response(renderActionHtml("Security Verification Failed", "Invalid or tampered decision token. Action aborted.", "#910000"), {
                status: 403,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(pulseId).first();
        if (!trainer) {
            return new Response(renderActionHtml("Trainer Not Found", `Could not locate trainer with Pulse ID: <code>${pulseId}</code> in D1 database.`, "#910000"), {
                status: 404,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        const reqScope = (url.searchParams.get("scope") || "").toLowerCase().trim();
        const isMitScope = reqScope === "mit";

        if (isMitScope) {
            if (decision === "approve") {
                await db.prepare("UPDATE trainer_credentials SET is_mit_trainer = 1, notes = TRIM(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending Approval', ''), 'Pending Approval', ''), ' - Pending GM Access Approval', ''), '[Pending GM Access Approval]', '')), updated_at = CURRENT_TIMESTAMP WHERE LOWER(trainer_id) = LOWER(?)").bind(trainer.trainer_id).run();

                let candidateEmail = String(trainer.email || (trainer.trainer_id && trainer.trainer_id.includes('@') ? trainer.trainer_id : '')).trim();
                if (/^store\d+@team-wow\.com$/i.test(candidateEmail)) {
                    candidateEmail = candidateEmail.replace(/^store/i, '').toLowerCase();
                }

                await callAppsScriptProxy({
                    action: "sendGmApprovalNoticeToTrainer",
                    trainerName: trainer.trainer_name,
                    pulseId: trainer.trainer_id,
                    storeNum: trainer.store_num,
                    market: trainer.market,
                    pin: trainer.trainer_pin,
                    email: candidateEmail,
                    role: trainer.role || "MIT Trainer",
                    scope: "mit",
                    isMitApproval: true,
                    isDo: !!trainer.is_do,
                    isAboveStore: !!trainer.is_do
                }, context);

                return new Response(renderActionHtml(
                    "MIT Trainer Access Approved",
                    `<div style="text-align: left; background: #faf2e9; padding: 16px; border-radius: 8px; border-left: 4px solid #005c91; margin-bottom: 18px;">
                        <p style="margin: 0 0 6px 0;"><strong>Name:</strong> ${trainer.trainer_name}</p>
                        <p style="margin: 0 0 6px 0;"><strong>Store / Scope:</strong> ${trainer.store_num === 'Above-Store' ? 'Above-Store' : 'Store #' + trainer.store_num} (${trainer.market})</p>
                        <p style="margin: 0 0 6px 0;"><strong>Pulse ID:</strong> <code>${trainer.trainer_id}</code></p>
                        <p style="margin: 0;"><strong>Status:</strong> <span style="color: #005c91; font-weight: bold;">Authorized MIT Trainer</span></p>
                    </div>
                    MIT Trainer authorization has been activated in Cloudflare D1.<br><br>Their 4-digit PIN (<code>${trainer.trainer_pin}</code>) is now authorized to unlock MIT session rosters, attendance verification, and in-class QR certification codes.<br><br>A confirmation notice has been emailed to <strong>${candidateEmail || 'their registered address'}</strong>.`,
                    "#005c91"
                ), {
                    status: 200,
                    headers: { "Content-Type": "text/html;charset=utf-8" }
                });
            } else if (decision === "deny") {
                await db.prepare("UPDATE trainer_credentials SET is_mit_trainer = 0, notes = TRIM(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending Approval', ''), 'Pending Approval', 'Access Declined'), ' - Pending GM Access Approval', '')), updated_at = CURRENT_TIMESTAMP WHERE LOWER(trainer_id) = LOWER(?)").bind(trainer.trainer_id).run();

                return new Response(renderActionHtml(
                    "MIT Trainer Access Denied",
                    `MIT Trainer Portal authorization request for <strong>${trainer.trainer_name}</strong> has been denied.<br><br>Their PIN remains restricted from the MIT Trainer Portal.`,
                    "#910000"
                ), {
                    status: 200,
                    headers: { "Content-Type": "text/html;charset=utf-8" }
                });
            }
        }

        if (decision === "approve") {
            const isDoOrAboveStore = !!trainer.is_do || 
                                     trainer.role === 'Supervisor' || 
                                     trainer.role === 'Director of Operations' || 
                                     trainer.role === 'Director of Ops' || 
                                     trainer.role === 'Training Director' || 
                                     trainer.role === 'Market Leader' || 
                                     trainer.role === 'Executive' || 
                                     trainer.store_num === 'Above-Store' || 
                                     trainer.store_num === 'DO' || 
                                     trainer.store_num === 'Exec';

            if (isDoOrAboveStore) {
                await db.prepare("UPDATE trainer_credentials SET is_do = 1, is_gm = 1, is_active = 1, role = CASE WHEN role = 'General Manager' THEN 'Director of Ops' ELSE COALESCE(role, 'Director of Ops') END, notes = TRIM(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending GM Access Approval', ''), ' - Pending Approval', ''), 'Pending Approval', ''), '[Pending GM Access Approval]', '')), updated_at = CURRENT_TIMESTAMP WHERE LOWER(trainer_id) = LOWER(?)").bind(trainer.trainer_id).run();
            } else {
                await db.prepare("UPDATE trainer_credentials SET is_gm = 1, is_active = 1, role = 'General Manager', notes = TRIM(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending GM Access Approval', ''), ' - Pending Approval', ''), 'Pending Approval', ''), '[Pending GM Access Approval]', '')), updated_at = CURRENT_TIMESTAMP WHERE LOWER(trainer_id) = LOWER(?)").bind(trainer.trainer_id).run();
            }

            // Dispatch confirmation notice to the trainer (Strictly corporate email for above-store!)
            let candidateEmail = String(trainer.email || (trainer.trainer_id && trainer.trainer_id.includes('@') ? trainer.trainer_id : '')).trim();
            if (/^store\d+@team-wow\.com$/i.test(candidateEmail)) {
                candidateEmail = candidateEmail.replace(/^store/i, '').toLowerCase();
            }

            await callAppsScriptProxy({
                action: "sendGmApprovalNoticeToTrainer",
                trainerName: trainer.trainer_name,
                pulseId: trainer.trainer_id,
                storeNum: isDoOrAboveStore ? "Above-Store" : trainer.store_num,
                market: trainer.market,
                pin: trainer.trainer_pin,
                email: candidateEmail,
                role: isDoOrAboveStore ? (trainer.role === 'General Manager' ? 'Director of Ops' : (trainer.role || 'Director of Ops')) : 'General Manager',
                isDo: isDoOrAboveStore,
                isAboveStore: isDoOrAboveStore
            }, context);

            const displayScope = isDoOrAboveStore ? `Above-Store Leadership (${trainer.market})` : `#${trainer.store_num} (${trainer.market})`;
            const displayStatus = isDoOrAboveStore ? `Authorized Director of Operations` : `Authorized GM`;

            return new Response(renderActionHtml(
                isDoOrAboveStore ? "DO Access Approved" : "GM Access Approved",
                `<div style="text-align: left; background: #faf2e9; padding: 16px; border-radius: 8px; border-left: 4px solid #005c91; margin-bottom: 18px;">
                    <p style="margin: 0 0 6px 0;"><strong>Name:</strong> ${trainer.trainer_name}</p>
                    <p style="margin: 0 0 6px 0;"><strong>Scope:</strong> ${displayScope}</p>
                    <p style="margin: 0 0 6px 0;"><strong>Pulse ID:</strong> <code>${trainer.trainer_id}</code></p>
                    <p style="margin: 0;"><strong>Status:</strong> <span style="color: #005c91; font-weight: bold;">${displayStatus}</span></p>
                </div>
                ${isDoOrAboveStore ? 'Director of Operations authorization has been granted in Cloudflare D1.<br><br>Confirmation has been emailed strictly to their corporate address. Store accounts were not messaged.' : 'General Manager authorization has been granted in Cloudflare D1.<br><br>A confirmation notice has been sent to their store.'}<br><br>Their 4-digit PIN (<code>${trainer.trainer_pin}</code>) will now unlock the <strong>Staffing Command Tracker</strong> immediately.`,
                "#005c91"
            ), {
                status: 200,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        } else if (decision === "deny") {
            await db.prepare("UPDATE trainer_credentials SET is_gm = 0, is_do = 0, notes = TRIM(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending GM Access Approval', ''), ' - Pending Approval', ''), 'Pending Approval', 'Access Declined')), updated_at = CURRENT_TIMESTAMP WHERE LOWER(trainer_id) = LOWER(?)").bind(trainer.trainer_id).run();

            return new Response(renderActionHtml(
                "GM Access Denied",
                `<div style="text-align: left; background: #fff5f5; padding: 16px; border-radius: 8px; border-left: 4px solid #ff0000; margin-bottom: 18px;">
                    <p style="margin: 0 0 6px 0;"><strong>Name:</strong> ${trainer.trainer_name}</p>
                    <p style="margin: 0 0 6px 0;"><strong>Store:</strong> #${trainer.store_num} (${trainer.market})</p>
                    <p style="margin: 0;"><strong>Status:</strong> <span style="color: #ff0000; font-weight: bold;">Standard Trainer Only</span></p>
                </div>
                GM access was declined. Their PIN will remain active for Wow Way Training modules, but blocked from GM Staffing Command.`,
                "#910000"
            ), {
                status: 200,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }
    }

    // On-demand Dispatch of Credentials Email from Admin Hub (GET)
    if (reqAction === "sendCredentialsEmail" || reqAction === "resendCredentials") {
        const trainerId = String(url.searchParams.get("trainerId") || "").trim();
        if (!trainerId) {
            return new Response(JSON.stringify({ success: false, error: "Missing trainerId" }), { status: 400, headers: corsHeaders() });
        }
        const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(trainerId).first();
        if (!trainer) {
            return new Response(JSON.stringify({ success: false, error: "Trainer profile not found" }), { status: 404, headers: corsHeaders() });
        }
        if (!trainer.email) {
            return new Response(JSON.stringify({ success: false, error: "Trainer does not have an email address on file. Please edit profile and add an email." }), { status: 400, headers: corsHeaders() });
        }
        const isDo = !!trainer.is_do || !!trainer.is_exec || trainer.role === 'Supervisor' || trainer.role === 'Director of Operations' || trainer.role === 'Director of Ops' || trainer.role === 'Training Director' || trainer.role === 'Market Leader' || trainer.role === 'Executive' || trainer.store_num === 'Above-Store' || trainer.store_num === 'Exec' || trainer.store_num === 'DO';

        await callAppsScriptProxy({
            action: "sendGmApprovalNoticeToTrainer",
            trainerName: trainer.trainer_name,
            pulseId: trainer.trainer_id,
            storeNum: trainer.store_num,
            market: trainer.market,
            pin: trainer.trainer_pin,
            email: trainer.email,
            role: trainer.role || (isDo ? 'Director of Ops' : 'General Manager'),
            isDo: isDo,
            isAboveStore: isDo,
            isProvisioned: true,
            portal: "Admin Hub"
        }, context);

        return new Response(JSON.stringify({
            success: true,
            message: `Credentials email dispatched directly to ${trainer.trainer_name} (${trainer.email}).`
        }), { status: 200, headers: corsHeaders() });
    }

    // 1-Click Request GM Access from Barrier (When existing trainer enters PIN)
    if (reqAction === "requestGmAccess") {
        const trainerId = (url.searchParams.get("trainerId") || "").trim();
        const pin = (url.searchParams.get("pin") || "").trim();

        if (!trainerId || !pin) {
            return new Response(JSON.stringify({ success: false, error: "Missing trainerId or pin" }), {
                status: 400,
                headers: corsHeaders()
            });
        }

        const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(trainerId).first();
        if (!trainer) {
            return new Response(JSON.stringify({ success: false, error: "Trainer profile not found" }), {
                status: 404,
                headers: corsHeaders()
            });
        }

        if (trainer.is_gm || trainer.is_do || trainer.is_admin || trainer.is_exec) {
            return new Response(JSON.stringify({
                success: true,
                alreadyAuthorized: true,
                message: "You are already authorized for GM Staffing Command! Please unlock using your PIN."
            }), { status: 200, headers: corsHeaders() });
        }

        const token = generateGmDecisionToken(trainer.trainer_id, trainer.trainer_pin);
        const baseUrl = "https://tw-staffing.pages.dev/api/staffing";
        const approveUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(trainer.trainer_id)}&pin=${encodeURIComponent(trainer.trainer_pin)}&token=${token}&decision=approve`;
        const denyUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(trainer.trainer_id)}&pin=${encodeURIComponent(trainer.trainer_pin)}&token=${token}&decision=deny`;

        const isTrainerAboveStore = !!(trainer.is_do || trainer.role === 'Supervisor' || trainer.role === 'Director of Operations' || trainer.role === 'Executive' || trainer.store_num === 'Above-Store' || trainer.store_num === 'DO');
        await callAppsScriptProxy({
            action: "sendTrainerPinRequestEmail",
            trainerName: trainer.trainer_name,
            pulseId: trainer.trainer_id,
            storeNum: isTrainerAboveStore ? "Above-Store" : trainer.store_num,
            market: trainer.market,
            pin: trainer.trainer_pin,
            role: trainer.role,
            email: trainer.email || (trainer.trainer_id && trainer.trainer_id.includes('@') ? trainer.trainer_id : ''),
            isGm: false,
            isDo: isTrainerAboveStore,
            isAboveStore: isTrainerAboveStore,
            isExistingTrainer: true,
            approveUrl: approveUrl,
            denyUrl: denyUrl
        }, context);

        return new Response(JSON.stringify({
            success: true,
            message: `GM access request submitted for ${trainer.trainer_name}. Mike Jacobs has been emailed a 1-click authorization link.`
        }), { status: 200, headers: corsHeaders() });
    }

    // -------------------------------------------------------------
    // CREDENTIAL GOVERNANCE & AUDIT ENDPOINTS
    // -------------------------------------------------------------
    if (reqAction === "getCredentialsList") {
        const creds = await db.prepare(`
            SELECT 
                t.trainer_id,
                t.trainer_name,
                t.trainer_pin,
                t.store_num,
                t.market,
                t.email,
                t.phone,
                t.role,
                t.is_wow_way_trainer,
                t.is_mit_trainer,
                t.is_gm,
                t.is_do,
                t.is_admin,
                t.is_exec,
                t.is_active,
                t.notes,
                t.created_at,
                t.updated_at,
                s.do_name,
                s.do_email
            FROM trainer_credentials t
            LEFT JOIN stores s ON t.store_num = s.store_number
            ORDER BY t.market ASC, CAST(t.store_num AS INTEGER) ASC, t.trainer_name ASC
        `).all();

        const pendingResets = await db.prepare(`
            SELECT * FROM credential_reset_requests WHERE status = 'pending' ORDER BY created_at DESC
        `).all();

        const credList = creds.results || [];
        const resetList = pendingResets.results || [];
        const pendingApprovals = credList.filter(c => {
            const notes = (c.notes || '').toLowerCase();
            const isExplicitlyRevoked = notes.includes('revoked') || notes.includes('terminated') || notes.includes('duplicate');
            if (isExplicitlyRevoked) return false;
            // Only flag as pending if notes indicate a pending registration request or account is inactive
            const isUnapprovedAboveStore = notes.includes('pending') && (!c.is_do && !c.is_exec && !c.is_admin);
            return (c.is_active === 0 || notes.includes('pending') || notes.includes('awaiting') || isUnapprovedAboveStore);
        });

        return new Response(JSON.stringify({
            success: true,
            credentials: credList,
            pendingResets: resetList,
            pendingApprovalCount: pendingApprovals.length,
            pendingResetCount: resetList.length,
            totalPending: pendingApprovals.length + resetList.length
        }), { status: 200, headers: corsHeaders() });
    }

    if (reqAction === "getTrainerUsageLogs") {
        const trainerId = (url.searchParams.get("trainerId") || "").trim();
        let logsQuery = "SELECT * FROM credential_usage_logs";
        const binds = [];
        if (trainerId) {
            logsQuery += " WHERE LOWER(trainer_id) = LOWER(?) OR LOWER(trainer_name) = LOWER(?)";
            binds.push(trainerId, trainerId);
        }
        logsQuery += " ORDER BY id DESC LIMIT 50";
        const logs = await db.prepare(logsQuery).bind(...binds).all();
        return new Response(JSON.stringify({
            success: true,
            logs: logs.results || []
        }), { status: 200, headers: corsHeaders() });
    }

    if (reqAction === "getPendingResets") {
        const pendingResets = await db.prepare(`
            SELECT * FROM credential_reset_requests WHERE status = 'pending' ORDER BY created_at DESC
        `).all();
        return new Response(JSON.stringify({
            success: true,
            requests: pendingResets.results || []
        }), { status: 200, headers: corsHeaders() });
    }

    // Fast endpoint for candidate lookup (for personalized registration pre-fills)
    if (reqAction === "getCandidate") {
        const candId = url.searchParams.get("id") || url.searchParams.get("candId") || "";
        const candEmail = url.searchParams.get("email") || "";
        let cand = null;
        if (candId) {
            cand = await db.prepare("SELECT * FROM onboarding_candidates WHERE id = ?").bind(candId).first();
        } else if (candEmail) {
            cand = await db.prepare("SELECT * FROM onboarding_candidates WHERE LOWER(email) = LOWER(?)").bind(candEmail).first();
        }
        if (cand) {
            return new Response(JSON.stringify({
                success: true,
                candidate: {
                    id: cand.id,
                    name: cand.name,
                    email: cand.email,
                    phone: cand.phone_number,
                    storeNum: cand.store_num,
                    position: cand.position,
                    market: cand.market,
                    ntoDate: cand.nto_date,
                    ntoScheduled: Boolean(cand.nto_scheduled)
                }
            }), { status: 200, headers: corsHeaders(60) });
        }
        return new Response(JSON.stringify({ success: false, error: "Candidate not found" }), { status: 404, headers: corsHeaders() });
    }

    // 1-Click Action Routes for Pending NTO Applicants (triggered from Admin email alerts)
    if (reqAction === "approvePendingNto" || reqAction === "denyPendingNto" || reqAction === "deletePendingNto") {
        const regId = url.searchParams.get("id") || "";
        if (!regId) {
            return new Response(renderActionHtml("Missing Request ID", "Invalid request: No registration ID provided.", "#910000"), {
                status: 400,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        const reg = await db.prepare("SELECT * FROM class_registrations WHERE id = ?").bind(regId).first();
        if (!reg) {
            return new Response(renderActionHtml("Already Handled", "This request has already been processed or removed from the system.", "#005c91"), {
                status: 200,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        if (reg.status !== "Pending" && reqAction === "approvePendingNto") {
            return new Response(renderActionHtml("Already Approved", `${reg.candidate_name} is already confirmed on the orientation roster.`, "#005c91"), {
                status: 200,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        const cls = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(reg.class_id).first();

        if (reqAction === "approvePendingNto") {
            // 1. Mark registration as Confirmed
            await db.prepare("UPDATE class_registrations SET status = 'Confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(regId).run();

            // 2. Increment spots_taken on new class
            await db.prepare("UPDATE training_classes SET spots_taken = spots_taken + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(reg.class_id).run();

            // 2b. Clean up prior class registrations in older classes for this candidate & free their spots
            const cleanRegPhone = (reg.phone || "").replace(/\D/g, "").slice(-10);
            try {
                const priorRegs = await db.prepare(`
                    SELECT * FROM class_registrations 
                    WHERE id != ? AND class_id != ? AND (
                        (LOWER(email) = LOWER(?) AND email != '') OR 
                        (phone != '' AND ? != '' AND REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?)
                    )
                `).bind(regId, reg.class_id, reg.email, cleanRegPhone, '%' + cleanRegPhone).all();

                if (priorRegs && priorRegs.results && priorRegs.results.length > 0) {
                    for (const pr of priorRegs.results) {
                        await db.prepare("UPDATE training_classes SET spots_taken = MAX(0, spots_taken - 1), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(pr.class_id).run();
                        await db.prepare("DELETE FROM class_registrations WHERE id = ?").bind(pr.id).run();
                    }
                }
            } catch (cleanupErr) {
                console.warn("Prior registration cleanup error:", cleanupErr);
            }

            // 3. Update candidate profile if exists
            if (cls) {
                const nowFormatted = getNowFormatted("America/Chicago");
                const cleanRegPhone = (reg.phone || "").replace(/\D/g, "").slice(-10);
                const candId = reg.candidate_id || "";
                await db.prepare(`
                    UPDATE onboarding_candidates SET
                        nto_date = ?,
                        nto_scheduled = 1,
                        missed_nto = 0,
                        nto_attendance = '',
                        last_updated = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE (id = ? AND ? != '') OR LOWER(email) = LOWER(?) OR (phone_number != '' AND REPLACE(REPLACE(REPLACE(REPLACE(phone_number, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?)
                `).bind(cls.class_date, nowFormatted, candId, candId, reg.email, '%' + cleanRegPhone).run();
            }

            // 4. Send Confirmation & Google Meet link via Apps Script microservice
            if (cls && reg.email) {
                const isDen = (reg.market || "").toLowerCase() === "denver" || (cls && (cls.market || "").toLowerCase() === "denver");
                await callAppsScriptProxy({
                    username: isDen ? "denver_admin" : "dallas_admin",
                    password: isDen ? "denver_password_123" : "dallas_password_123",
                    action: "sendNtoMeetLinks",
                    classDate: cls.class_date,
                    classTime: cls.start_time,
                    meetLink: cls.meet_link || (isDen ? "https://meet.google.com/haf-izyt-gws" : "https://meet.google.com/zwc-afuu-hgh"),
                    trainerName: cls.trainer || (isDen ? "Richard Keske" : "Mike Jacobs"),
                    notifyAdmin: false,
                    studentPhone: reg.phone,
                    storeNum: reg.store_num,
                    market: reg.market || (cls ? cls.market : "Dallas"),
                    city: reg.market || (cls ? cls.market : "Dallas"),
                    trainees: [{ name: reg.candidate_name, email: reg.email }]
                }, context);
            }

            const classInfo = cls ? `${cls.class_date} at ${cls.start_time}` : "the scheduled session";
            return new Response(renderActionHtml(
                "Approval Confirmed",
                `Successfully <strong>APPROVED</strong> ${reg.candidate_name} for orientation on <strong>${classInfo}</strong>.<br><br>Their spot is confirmed on the class roster, and their Google Meet video link has been emailed to them.`,
                "#005c91"
            ), {
                status: 200,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        if (reqAction === "denyPendingNto") {
            // 1. Mark as Denied
            await db.prepare("UPDATE class_registrations SET status = 'Denied', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(regId).run();

            // 2. Send gentle GM reschedule notification to student via Apps Script
            if (reg.email) {
                await callAppsScriptProxy({
                    username: "dallas_admin",
                    password: "dallas_password_123",
                    action: "sendNtoStudentDenial",
                    name: reg.candidate_name,
                    email: reg.email,
                    classDate: cls ? cls.class_date : ""
                }, context);
            }

            return new Response(renderActionHtml(
                "Denial Processed",
                `Successfully <strong>DENIED</strong> ${reg.candidate_name}.<br><br>They have been sent the notification explaining that rescheduling is a store-level decision and directing them to contact their store General Manager.`,
                "#910000"
            ), {
                status: 200,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }

        if (reqAction === "deletePendingNto") {
            // Silently delete registration record
            await db.prepare("DELETE FROM class_registrations WHERE id = ?").bind(regId).run();

            return new Response(renderActionHtml(
                "Request Deleted",
                `Successfully <strong>DELETED</strong> ${reg.candidate_name}'s pending request.<br><br>No notification was sent to the candidate.`,
                "#472b10"
            ), {
                status: 200,
                headers: { "Content-Type": "text/html;charset=utf-8" }
            });
        }
    }

    // Endpoint for live NTO roster directly from Cloudflare D1 (powers morning reminders & attendance)
    if (reqAction === "getNtoRoster" || reqAction === "exportRoster") {
        const targetMarket = (url.searchParams.get("market") || market || "Dallas").toLowerCase() === "denver" ? "Denver" : "Dallas";
        const dateFilter = url.searchParams.get("date");

        let query = `
            SELECT cr.id AS reg_id, cr.class_id, cr.candidate_name, cr.email, cr.phone, cr.store_num, cr.position, cr.status,
                   tc.class_date, tc.start_time, tc.end_time, tc.trainer, tc.meet_link
            FROM class_registrations cr
            JOIN training_classes tc ON cr.class_id = tc.id
            WHERE (cr.status = 'Confirmed' OR cr.status IS NULL OR cr.status = '')
              AND tc.is_active = 1
              AND (tc.market = ? OR tc.market = 'Virtual')
        `;
        const params = [targetMarket];
        if (dateFilter) {
            query += " AND tc.class_date = ?";
            params.push(dateFilter);
        }
        query += " ORDER BY tc.class_date ASC, cr.candidate_name ASC";

        const { results } = await db.prepare(query).bind(...params).all();
        return new Response(JSON.stringify({ success: true, roster: results || [] }), {
            status: 200,
            headers: corsHeaders(0)
        });
    }

    // Endpoint for trainee identity lookup on /completion portal (by phone, email, or id)
    if (reqAction === "getNtoCompletionProfile") {
        const rawLookup = (url.searchParams.get("phone") || url.searchParams.get("email") || url.searchParams.get("lookup") || url.searchParams.get("id") || "").trim();
        const cleanPhoneDigits = rawLookup.replace(/\D/g, "");
        const isEmail = rawLookup.includes("@");
        const reqMarket = (url.searchParams.get("market") || "").trim();

        let candidate = null;

        if (url.searchParams.get("id")) {
            candidate = await db.prepare("SELECT * FROM onboarding_candidates WHERE id = ? LIMIT 1")
                .bind(url.searchParams.get("id").trim())
                .first();
        }

        if (!candidate && cleanPhoneDigits.length >= 7) {
            const last10Digits = cleanPhoneDigits.slice(-10);
            if (reqMarket) {
                const { results } = await db.prepare(`
                    SELECT * FROM onboarding_candidates 
                    WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
                      AND LOWER(market) = LOWER(?)
                    ORDER BY created_at DESC LIMIT 5
                `).bind(`%${last10Digits}%`, reqMarket).all();
                if (results && results.length > 0) {
                    candidate = results[0];
                }
            }
            if (!candidate) {
                const { results } = await db.prepare(`
                    SELECT * FROM onboarding_candidates 
                    WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone_number, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
                    ORDER BY created_at DESC LIMIT 5
                `).bind(`%${last10Digits}%`).all();
                if (results && results.length > 0) {
                    candidate = results[0];
                }
            }
        }

        if (!candidate && isEmail) {
            if (reqMarket) {
                candidate = await db.prepare("SELECT * FROM onboarding_candidates WHERE LOWER(email) = LOWER(?) AND LOWER(market) = LOWER(?) ORDER BY created_at DESC LIMIT 1")
                    .bind(rawLookup, reqMarket)
                    .first();
            }
            if (!candidate) {
                candidate = await db.prepare("SELECT * FROM onboarding_candidates WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC LIMIT 1")
                    .bind(rawLookup)
                    .first();
            }
        }

        if (!candidate && rawLookup) {
            if (reqMarket) {
                candidate = await db.prepare("SELECT * FROM onboarding_candidates WHERE (id = ? OR LOWER(email) = LOWER(?)) AND LOWER(market) = LOWER(?) LIMIT 1")
                    .bind(rawLookup, rawLookup, reqMarket)
                    .first();
            }
            if (!candidate) {
                candidate = await db.prepare("SELECT * FROM onboarding_candidates WHERE id = ? OR LOWER(email) = LOWER(?) LIMIT 1")
                    .bind(rawLookup, rawLookup)
                    .first();
            }
        }

        if (!candidate) {
            return new Response(JSON.stringify({ success: false, error: "Candidate not found. Please double-check your phone number or email." }), {
                status: 200,
                headers: corsHeaders(0)
            });
        }

        // Query GM details for their assigned store
        const store = await db.prepare("SELECT * FROM stores WHERE store_number = ? LIMIT 1")
            .bind(candidate.store_num)
            .first();

        const nameParts = (candidate.name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

        const gmName = (store && store.manager_name) ? store.manager_name : ((store && store.do_name) ? `DO ${store.do_name}` : (candidate.do_name ? `DO ${candidate.do_name}` : ""));
        const gmPhone = (store && store.gm_phone) ? store.gm_phone : ((store && store.do_cell) ? store.do_cell : "");

        return new Response(JSON.stringify({
            success: true,
            candidate: {
                id: candidate.id,
                name: candidate.name,
                firstName: firstName,
                lastName: lastName,
                email: candidate.email || "",
                phone: candidate.phone_number || "",
                storeNum: candidate.store_num,
                position: candidate.position || "Team Member",
                market: candidate.market || reqMarket || "Dallas",
                shirtSize: candidate.shirt_size || "",
                hatStyle: candidate.hat_style || "Standard Cap",
                payCard: candidate.pay_card || "",
                pulseFormComplete: Boolean(candidate.pulse_form_complete),
                ntoAttendance: candidate.nto_attendance || "",
                gmName: gmName,
                gmPhone: gmPhone,
                doName: store ? (store.do_name || "") : (candidate.do_name || ""),
                doPhone: store ? (store.do_cell || "") : "",
                storeAddress: store ? (store.address || "") : "",
                storePhone: store ? (store.store_phone || "") : ""
            }
        }), {
            status: 200,
            headers: corsHeaders(0)
        });
    }



    // Fast endpoint for NTO classes: only query active classes and active registrations (prevents full database scans!)
    if (reqAction === "getNtoClasses") {
        const [classesRes, regsRes] = await Promise.all([
            db.prepare("SELECT * FROM training_classes WHERE program = 'NTO' AND (market = ? OR market = 'Virtual') AND is_active = 1").bind(market).all(),
            db.prepare("SELECT class_id, candidate_name FROM class_registrations WHERE (status = 'Confirmed' OR status IS NULL OR status = '') AND class_id IN (SELECT id FROM training_classes WHERE program = 'NTO' AND (market = ? OR market = 'Virtual') AND is_active = 1)").bind(market).all()
        ]);

        const regMap = {};
        (regsRes.results || []).forEach(r => {
            if (!regMap[r.class_id]) regMap[r.class_id] = [];
            regMap[r.class_id].push(r.candidate_name);
        });

        const ntoClasses = (classesRes.results || []).map(cl => {
            const attendees = regMap[cl.id] || [];
            let isoDate = null;
            try {
                const parts = (cl.class_date || '').split('/');
                if (parts.length === 3) {
                    const m = parts[0].padStart(2, '0');
                    const d = parts[1].padStart(2, '0');
                    const y = parts[2];
                    isoDate = `${y}-${m}-${d}T16:00:00`;
                }
            } catch (e) {}

            return {
                id: cl.id,
                classId: cl.id,
                market: cl.market,
                name: cl.name,
                classDate: cl.class_date,
                startTime: formatTimeDisplay(cl.start_time),
                endTime: formatTimeDisplay(cl.end_time),
                trainer: cl.trainer,
                trainerName: cl.trainer,
                location: cl.location,
                meetLink: cl.meet_link,
                spotsTotal: cl.spots_total,
                capacity: cl.spots_total,
                spotsTaken: attendees.length > 0 ? attendees.length : cl.spots_taken,
                attendees: attendees,
                isoDate: isoDate
            };
        });

        ntoClasses.sort((a, b) => parseDateForSort(a.classDate) - parseDateForSort(b.classDate));

        return new Response(JSON.stringify({
            success: true,
            market,
            classes: ntoClasses
        }), {
            status: 200,
            headers: corsHeaders(60)
        });
    }

    // Fast endpoint for MIT classes: queries active MIT classes and their live registrations
    if (reqAction === "getMitClasses") {
        const [classesRes, regsRes] = await Promise.all([
            db.prepare("SELECT * FROM training_classes WHERE program = 'MIT' AND (market = ? OR market = 'Virtual') AND is_active = 1").bind(market).all(),
            db.prepare("SELECT class_id, candidate_name, store_num, position, phone, email, status FROM class_registrations WHERE class_id IN (SELECT id FROM training_classes WHERE program = 'MIT' AND (market = ? OR market = 'Virtual') AND is_active = 1)").bind(market).all()
        ]);

        const regMap = {};
        (regsRes.results || []).forEach(r => {
            if (!regMap[r.class_id]) regMap[r.class_id] = [];
            regMap[r.class_id].push(r);
        });

        const mitClasses = (classesRes.results || []).map(cl => {
            const registrations = regMap[cl.id] || [];
            const confirmedRegs = registrations.filter(r => r.status === 'Confirmed' || !r.status);
            let isoDate = null;
            try {
                const parts = (cl.class_date || '').split('/');
                if (parts.length === 3) {
                    const m = parts[0].padStart(2, '0');
                    const d = parts[1].padStart(2, '0');
                    const y = parts[2];
                    const hour = cl.start_time && cl.start_time.includes('6:00') ? '18' : (cl.start_time && cl.start_time.includes('2:00') ? '14' : '11');
                    isoDate = `${y}-${m}-${d}T${hour}:00:00`;
                }
            } catch (e) {}

            const spotsTaken = confirmedRegs.length > 0 ? confirmedRegs.length : (cl.spots_taken || 0);
            const spotsTotal = cl.spots_total || 15;

            return {
                id: cl.id,
                classId: cl.id,
                market: cl.market,
                name: cl.name,
                level: cl.level || 1,
                classDate: cl.class_date,
                startTime: cl.start_time,
                endTime: cl.end_time,
                trainer: cl.trainer,
                trainerName: cl.trainer,
                location: cl.location,
                meetLink: cl.meet_link,
                spotsTotal: spotsTotal,
                capacity: spotsTotal,
                spotsTaken: spotsTaken,
                spotsLeft: Math.max(0, spotsTotal - spotsTaken),
                openDate: cl.open_date,
                closeDate: cl.close_date,
                attendees: confirmedRegs.map(r => r.candidate_name),
                roster: registrations,
                isoDate: isoDate
            };
        });

        mitClasses.sort((a, b) => parseDateForSort(a.classDate) - parseDateForSort(b.classDate));

        return new Response(JSON.stringify({
            success: true,
            market,
            classes: mitClasses
        }), {
            status: 200,
            headers: corsHeaders(60)
        });
    }

    if (reqAction === "getMitRoster") {
        const classId = url.searchParams.get("classId");
        if (!classId) {
            return new Response(JSON.stringify({ success: false, error: "Missing classId" }), { status: 400, headers: corsHeaders() });
        }
        const [cls, regs] = await Promise.all([
            db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first(),
            db.prepare("SELECT * FROM class_registrations WHERE class_id = ? ORDER BY created_at ASC").bind(classId).all()
        ]);
        return new Response(JSON.stringify({
            success: true,
            class: cls,
            roster: regs.results || []
        }), { status: 200, headers: corsHeaders() });
    }

    const storeNum = url.searchParams.get("storeNum") || url.searchParams.get("store");

    try {
        // Auto-heal: Ensure any candidate marked hired in onboarding is present in staffing_records
        await syncHiredCandidatesToStaffing(db, market);

        // Parallel queries to D1
        const [
            candidatesRes,
            storesRes,
            adminContactsRes,
            interviewsRes,
            staffingRes,
            scratchpadRes,
            ntoClassesRes,
            classRegsRes
        ] = await Promise.all([
            // 1. Onboarding Candidates
            storeNum
                ? db.prepare("SELECT * FROM onboarding_candidates WHERE market = ? AND store_num = ? ORDER BY created_at DESC").bind(market, storeNum).all()
                : db.prepare("SELECT * FROM onboarding_candidates WHERE market = ? ORDER BY created_at DESC").bind(market).all(),

            // 2. Stores / Contacts
            storeNum
                ? db.prepare("SELECT * FROM stores WHERE market = ? AND store_number = ?").bind(market, storeNum).all()
                : db.prepare("SELECT * FROM stores WHERE market = ? ORDER BY CAST(store_number AS INTEGER) ASC").bind(market).all(),

            // 3. Admin Contacts
            db.prepare("SELECT * FROM admin_contacts WHERE market = ? ORDER BY id ASC").bind(market).all(),

            // 4. Interviews
            storeNum
                ? db.prepare("SELECT * FROM interviews WHERE market = ? AND store_num = ? ORDER BY interview_date DESC").bind(market, storeNum).all()
                : db.prepare("SELECT * FROM interviews WHERE market = ? ORDER BY interview_date DESC").bind(market).all(),

            // 5. Staffing Records
            storeNum
                ? db.prepare("SELECT * FROM staffing_records WHERE market = ? AND store_num = ? ORDER BY hire_date DESC").bind(market, storeNum).all()
                : db.prepare("SELECT * FROM staffing_records WHERE market = ? ORDER BY hire_date DESC").bind(market).all(),

            // 6. Scratchpad
            db.prepare("SELECT * FROM scratchpad WHERE market = ?").bind(market).first(),

            // 7. NTO Classes
            db.prepare("SELECT * FROM training_classes WHERE program = 'NTO' AND (market = ? OR market = 'Virtual') AND is_active = 1 ORDER BY class_date ASC").bind(market).all(),

            // 8. Class Registrations for attendee roster (filtered to active classes)
            db.prepare("SELECT class_id, candidate_name FROM class_registrations WHERE class_id IN (SELECT id FROM training_classes WHERE program = 'NTO' AND (market = ? OR market = 'Virtual') AND is_active = 1)").bind(market).all()
        ]);

        // Build store DO lookup map from stores query
        const storeDoMap = new Map();
        (storesRes.results || []).forEach(s => {
            if (s.store_number && s.do_name) {
                storeDoMap.set(String(s.store_number).trim(), s.do_name.trim());
            }
        });

        // Map candidates to frontend camelCase
        const onboarding = (candidatesRes.results || []).map(c => {
            const rawDo = (c.do_name || '').trim();
            const sNum = String(c.store_num || '').trim();
            const resolvedDo = rawDo || storeDoMap.get(sNum) || '';
            return {
                id: c.id,
                name: c.name,
                position: c.position || '',
                store: c.store_num,
                doName: resolvedDo,
                ntoDate: c.nto_date || '',
                ntoAttendance: c.nto_attendance || '',
                notes: c.notes || '',
                shirtSize: c.shirt_size || '',
                hatStyle: c.hat_style || '',
                payCard: c.pay_card || '',
                phoneNumber: c.phone_number || '',
                email: c.email || '',
                submissionReceived: Boolean(c.submission_received),
                onboardingSent: Boolean(c.onboarding_sent),
                bgcComplete: Boolean(c.bgc_complete),
                allPayCompleted: Boolean(c.allpay_completed),
                allPayError: c.allpay_error || '',
                allPayErrorText: c.allpay_error || '',
                hasAllPayError: Boolean(c.allpay_error && c.allpay_error !== 'FALSE'),
                ntoSignupLinkSent: Boolean(c.nto_signup_link_sent),
                ntoScheduled: Boolean(c.nto_scheduled),
                hired: Boolean(c.hired),
                incorrectEmail: Boolean(c.incorrect_email),
                ineligible: Boolean(c.ineligible),
                inactive: Boolean(c.inactive),
                missingDocs: c.missing_docs || '',
                missingDocsText: c.missing_docs || '',
                hasMissingDocs: Boolean(c.missing_docs && c.missing_docs !== 'FALSE'),
                pulseFormComplete: Boolean(c.pulse_form_complete),
                missedNto: Boolean(c.missed_nto),
                cardReceived: Boolean(c.card_received),
                registered: Boolean(c.registered),
                ddReceived: Boolean(c.dd_received),
                ddEntered: Boolean(c.dd_entered),
                noticeSentDate: c.notice_sent_date || '',
                withdrawn: Boolean(c.withdrawn),
                quizScore: c.quiz_score || '',
                ntoCompletedAt: c.nto_completed_at || '',
                ssnLast4: c.ssn_last_4 || '',
                lastUpdated: c.last_updated || ''
            };
        });

        // Map stores/contacts
        const contacts = (storesRes.results || []).map(s => ({
            store: s.store_number,
            doName: s.do_name || '',
            address: s.address || '',
            storePhone: s.store_phone || '',
            manager: s.manager_name || '',
            gmPhone: s.gm_phone || '',
            storeEmail: s.store_email || '',
            doEmail: s.do_email || '',
            ipAddress: s.ip_address || '',
            doCell: s.do_cell || '',
            csrStart: s.csr_start || '',
            csrMid: s.csr_mid || '',
            csrTop: s.csr_top || '',
            deBase: s.de_base || '',
            deOtr: s.de_otr || '',
            deCloserBase: s.de_closer_base || '',
            deCloserOtr: s.de_closer_otr || ''
        }));

        // Map admin contacts
        const adminContacts = (adminContactsRes.results || []).map(a => {
            const roleStr = a.role || '';
            const isExec = roleStr.toLowerCase().includes('vp') || roleStr.toLowerCase().includes('operations');
            return {
                id: a.id,
                role: roleStr,
                category: a.category || (isExec ? 'Leadership & Operations' : 'Training & HR Support'),
                title: a.title || roleStr,
                name: a.name,
                email: a.email || '',
                phone: a.phone || '',
                notes: a.notes || ''
            };
        });

        // Map interviews
        const interviews = (interviewsRes.results || []).map(i => {
            const rawDo = (i.do_name || '').trim();
            const sNum = String(i.store_num || '').trim();
            const resolvedDo = rawDo || storeDoMap.get(sNum) || '';
            return {
                id: i.id,
                store: i.store_num,
                doName: resolvedDo,
                name: i.name,
                position: i.position || '',
                phoneNumber: i.phone_number || '',
                email: i.email || '',
                date: i.interview_date || '',
                day: i.interview_day || '',
                time: i.interview_time || '',
                status: i.status || 'Scheduled',
                gmDate: i.gm_date || '',
                gmTime: i.gm_time || '',
                statusUpdates: i.status_updates || '',
                availability: i.availability || '',
                notes: i.notes || ''
            };
        });

        // Map staffing
        const staffing = (staffingRes.results || []).map(st => {
            const rawDo = (st.do_name || '').trim();
            const sNum = String(st.store_num || '').trim();
            const resolvedDo = rawDo || storeDoMap.get(sNum) || '';
            return {
                id: st.id,
                period: st.period || '',
                doName: resolvedDo,
                store: st.store_num,
                name: st.name,
                position: st.position || '',
                hireDate: st.hire_date || '',
                termDate: st.term_date || '',
                rehireEligible: st.rehire_eligible || 'Yes',
                causeOfAction: st.cause_of_action || '',
                reasonOfAction: st.reason_of_action || '',
                notes: st.notes || '',
                receivedDate: st.received_date || '',
                gmName: st.gm_name || '',
                sourceSheet: st.source_sheet || ''
            };
        });

        // Scratchpad
        let scratchpadText = "";
        let scratchpadChecklist = [];
        if (scratchpadRes) {
            scratchpadText = scratchpadRes.scratchpad_text || "";
            try {
                scratchpadChecklist = JSON.parse(scratchpadRes.checklist_json || "[]");
            } catch (e) {
                scratchpadChecklist = [];
            }
        }

        // Map class registrations into attendee roster
        const regMap = {};
        (classRegsRes.results || []).forEach(r => {
            if (!regMap[r.class_id]) regMap[r.class_id] = [];
            regMap[r.class_id].push(r.candidate_name);
        });

        // NTO Classes
        const ntoClasses = (ntoClassesRes.results || []).map(cl => {
            const attendees = regMap[cl.id] || [];
            let isoDate = null;
            try {
                const parts = (cl.class_date || '').split('/');
                if (parts.length === 3) {
                    const m = parts[0].padStart(2, '0');
                    const d = parts[1].padStart(2, '0');
                    const y = parts[2];
                    isoDate = `${y}-${m}-${d}T16:00:00`;
                }
            } catch (e) {}

            return {
                id: cl.id,
                classId: cl.id,
                market: cl.market,
                name: cl.name,
                classDate: cl.class_date,
                startTime: cl.start_time,
                endTime: cl.end_time,
                trainer: cl.trainer,
                trainerName: cl.trainer,
                location: cl.location,
                meetLink: cl.meet_link,
                spotsTotal: cl.spots_total,
                capacity: cl.spots_total,
                spotsTaken: attendees.length > 0 ? attendees.length : cl.spots_taken,
                attendees: attendees,
                isoDate: isoDate
            };
        });

        // Auto-heal empty do_name in D1 database in the background if any missing
        if (context && typeof context.waitUntil === 'function') {
            context.waitUntil((async () => {
                try {
                    await db.prepare(`
                        UPDATE onboarding_candidates
                        SET do_name = (
                            SELECT s.do_name FROM stores s
                            WHERE s.market = onboarding_candidates.market
                              AND s.store_number = onboarding_candidates.store_num
                            LIMIT 1
                        )
                        WHERE (do_name IS NULL OR do_name = '')
                          AND store_num IN (SELECT store_number FROM stores WHERE market = onboarding_candidates.market AND do_name IS NOT NULL AND do_name != '')
                    `).run();
                    await db.prepare(`
                        UPDATE interviews
                        SET do_name = (
                            SELECT s.do_name FROM stores s
                            WHERE s.market = interviews.market
                              AND s.store_number = interviews.store_num
                            LIMIT 1
                        )
                        WHERE (do_name IS NULL OR do_name = '')
                          AND store_num IN (SELECT store_number FROM stores WHERE market = interviews.market AND do_name IS NOT NULL AND do_name != '')
                    `).run();
                    await db.prepare(`
                        UPDATE staffing_records
                        SET do_name = (
                            SELECT s.do_name FROM stores s
                            WHERE s.market = staffing_records.market
                              AND s.store_number = staffing_records.store_num
                            LIMIT 1
                        )
                        WHERE (do_name IS NULL OR do_name = '')
                          AND store_num IN (SELECT store_number FROM stores WHERE market = staffing_records.market AND do_name IS NOT NULL AND do_name != '')
                    `).run();
                } catch (healErr) {
                    console.warn("Background auto-heal DO names warning:", healErr);
                }
            })());
        }

        return new Response(JSON.stringify({
            success: true,
            market,
            onboarding,
            contacts,
            adminContacts,
            interviews,
            staffing,
            scratchpadText,
            scratchpadChecklist,
            ntoClasses,
            version: "d1-v1.0"
        }), {
            status: 200,
            headers: corsHeaders(0)
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Failed to fetch staffing data" }), {
            status: 500,
            headers: corsHeaders()
        });
    }
}

// ---------------------------------------------------------------------------
// POST Handler: Updates, Batch Updates, Scratchpad Saves, and GAS Webhook Proxy
// ---------------------------------------------------------------------------
export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB || env.tw_team_data;

    if (!db) {
        return new Response(JSON.stringify({ error: "D1 database binding 'DB' not configured" }), {
            status: 500,
            headers: corsHeaders()
        });
    }

    let payload;
    try {
        const text = await request.text();
        payload = JSON.parse(text);
    } catch (e) {
        return new Response(JSON.stringify({ error: "Malformed JSON payload" }), {
            status: 400,
            headers: corsHeaders()
        });
    }

    const url = new URL(request.url);
    const action = payload.action || url.searchParams.get("action");
    let market = payload.city || payload.market || "Dallas";
    market = market.toLowerCase() === "denver" ? "Denver" : "Dallas";

    const gasUser = market.toLowerCase() === "denver" ? "denver_admin" : "dallas_admin";
    const gasPass = market.toLowerCase() === "denver" ? "denver_password_123" : "dallas_password_123";
    const gasPayload = {
        ...payload,
        username: gasUser,
        password: gasPass,
        city: market,
        market: market
    };

    try {
        // Fast endpoint for Trainer / Staff PIN verification & auth check
        if (action === "verifyPin" || action === "checkAuth") {
            const rawPin = payload.pin || url.searchParams.get("pin") || "";
            const cleanPin = String(rawPin).replace(/\D/g, '').padStart(4, '0');
            if (!cleanPin || cleanPin.length !== 4) {
                return new Response(JSON.stringify({ success: false, error: "Please enter a valid 4-digit PIN." }), {
                    status: 400,
                    headers: corsHeaders()
                });
            }
            const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE trainer_pin = ? AND is_active = 1 LIMIT 1").bind(cleanPin).first();
            if (!trainer) {
                return new Response(JSON.stringify({ success: false, error: "Invalid or inactive PIN. Access denied." }), {
                    status: 401,
                    headers: corsHeaders()
                });
            }
            return new Response(JSON.stringify({
                success: true,
                user: {
                    trainer_id: trainer.trainer_id,
                    name: trainer.trainer_name,
                    pin: trainer.trainer_pin,
                    store: trainer.store_num,
                    market: trainer.market,
                    role: trainer.role,
                    is_gm: !!trainer.is_gm,
                    is_do: !!trainer.is_do,
                    is_admin: !!trainer.is_admin,
                    is_exec: !!trainer.is_exec
                }
            }), {
                status: 200,
                headers: corsHeaders()
            });
        }

        // Register or Claim Trainer / Manager PIN
        if (action === "registerTrainerPin") {
            const trainerName = String(payload.trainerName || payload.name || "").trim();
            const pulseId = String(payload.pulseId || "").trim();
            const rawStoreNum = String(payload.storeNum || payload.store || "").trim();
            const rawPin = String(payload.pin || "").replace(/\D/g, '').trim();
            const rawMarket = String(payload.market || "").trim().toLowerCase();
            let reqMarket = "Dallas";
            if (rawMarket === "denver") reqMarket = "Denver";
            else if (rawMarket === "el paso" || rawMarket === "elpaso") reqMarket = "El Paso";
            else if (rawMarket === "la" || rawMarket === "los angeles") reqMarket = "LA";
            else if (rawMarket === "all markets" || rawMarket === "all" || rawMarket === "corporate") reqMarket = "All Markets";
            else if (rawMarket === "dallas") reqMarket = "Dallas";
            else if (payload.market) reqMarket = String(payload.market).trim();

            const isAboveStore = !!payload.isAboveStore || payload.accountType === 'above' || rawStoreNum.toLowerCase() === 'above-store' || rawStoreNum.toLowerCase() === 'do';
            const email = String(payload.email || (pulseId.includes('@') ? pulseId : '')).trim();
            const requestedRole = String(payload.role || (isAboveStore ? 'Director of Ops' : 'Trainer')).trim();

            if (!payload.market || !String(payload.market).trim()) {
                return new Response(JSON.stringify({
                    success: false,
                    error: "Please select a Market."
                }), { status: 400, headers: corsHeaders() });
            }

            if (isAboveStore) {
                if (!payload.role || !String(payload.role).trim()) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: "Please select a Leadership Role."
                    }), { status: 400, headers: corsHeaders() });
                }
                if (!trainerName || (!pulseId && !email) || !email || rawPin.length !== 4) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: "All fields are required. Please enter your Full Name, Company Email, Pulse ID / User ID, and a 4-digit PIN."
                    }), { status: 400, headers: corsHeaders() });
                }
            } else {
                const cleanStoreNum = rawStoreNum.replace(/\D/g, '').trim();
                if (!trainerName || !pulseId || !cleanStoreNum || !email || rawPin.length !== 4) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: "All fields are required. Please enter your name, Pulse ID, 4-digit store number, email address, and a 4-digit PIN."
                    }), { status: 400, headers: corsHeaders() });
                }
            }

            const cleanPin = rawPin.padStart(4, '0');
            const cleanStoreNum = isAboveStore ? 'Above-Store' : rawStoreNum.replace(/\D/g, '').trim();
            const effectiveId = pulseId || email;

            // 1. FORBIDDEN PIN BLACKLIST
            const FORBIDDEN_PINS = new Set([
                "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
                "1234", "4321", "2580", "0852", "1357", "2468", "9876", "6789"
            ]);
            if (FORBIDDEN_PINS.has(cleanPin)) {
                return new Response(JSON.stringify({
                    success: false,
                    error: "That PIN is too simple and easily guessed. Please choose a more secure 4-digit PIN."
                }), { status: 400, headers: corsHeaders() });
            }

            // 2. CHECK PIN COLLISION IN D1
            const pinCollision = await db.prepare("SELECT trainer_id, trainer_name FROM trainer_credentials WHERE trainer_pin = ? AND is_active = 1 LIMIT 1").bind(cleanPin).first();
            if (pinCollision && pinCollision.trainer_id.toLowerCase() !== effectiveId.toLowerCase() && (!email || pinCollision.trainer_id.toLowerCase() !== email.toLowerCase())) {
                return new Response(JSON.stringify({
                    success: false,
                    error: "This 4-digit PIN is already claimed by another team member. Please choose a unique 4-digit PIN."
                }), { status: 400, headers: corsHeaders() });
            }

            const requestedPortal = String(payload.portal || payload.source || "").trim();
            const isMitPortal = requestedPortal.toLowerCase().includes("mit");
            const isAdminHub = requestedPortal.toLowerCase().includes("admin");

            // 3. CHECK EXISTING TRAINER RECORD
            const existingTrainer = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) OR (email != '' AND LOWER(email) = LOWER(?)) LIMIT 1").bind(effectiveId, email).first();
            if (existingTrainer) {
                const isExistingAboveStore = isAboveStore || !!existingTrainer.is_do || existingTrainer.role === 'Supervisor' || existingTrainer.role === 'Director of Operations' || existingTrainer.role === 'Director of Ops' || existingTrainer.role === 'Training Director' || existingTrainer.role === 'Market Leader' || existingTrainer.role === 'Executive' || existingTrainer.store_num === 'Above-Store' || existingTrainer.store_num === 'Exec' || existingTrainer.store_num === 'DO';

                // ADMIN HUB DIRECT PROVISIONING: Mike is explicitly configuring or updating them!
                if (isAdminHub) {
                    const targetRole = requestedRole || existingTrainer.role || (isExistingAboveStore ? 'Director of Ops' : 'General Manager');
                    const targetIsDo = isExistingAboveStore ? 1 : (existingTrainer.is_do ? 1 : 0);
                    const targetIsGm = (isExistingAboveStore || targetRole === 'General Manager') ? 1 : (existingTrainer.is_gm ? 1 : 0);
                    const targetIsExec = targetRole === 'Executive' ? 1 : (existingTrainer.is_exec ? 1 : 0);
                    const targetIsAdmin = targetRole === 'Executive' ? 1 : (existingTrainer.is_admin ? 1 : 0);
                    const targetEmail = email || existingTrainer.email;

                    const finalPulseId = effectiveId || existingTrainer.trainer_id;

                    await db.prepare(`
                        UPDATE trainer_credentials 
                        SET trainer_id = ?, trainer_pin = ?, store_num = ?, market = ?, email = COALESCE(NULLIF(?, ''), email), role = ?, is_wow_way_trainer = 1, is_mit_trainer = 1, is_gm = ?, is_do = ?, is_exec = ?, is_admin = ?, is_active = 1, notes = 'Provisioned via Admin Hub', updated_at = CURRENT_TIMESTAMP
                        WHERE LOWER(trainer_id) = LOWER(?)
                    `).bind(finalPulseId, cleanPin, isExistingAboveStore ? 'Above-Store' : cleanStoreNum, reqMarket, email, targetRole, targetIsGm, targetIsDo, targetIsExec, targetIsAdmin, existingTrainer.trainer_id).run();

                    if (targetEmail) {
                        await callAppsScriptProxy({
                            action: "sendGmApprovalNoticeToTrainer",
                            trainerName: existingTrainer.trainer_name || trainerName,
                            pulseId: existingTrainer.trainer_id,
                            storeNum: isExistingAboveStore ? "Above-Store" : cleanStoreNum,
                            market: reqMarket,
                            pin: cleanPin,
                            email: targetEmail,
                            role: targetRole,
                            isDo: isExistingAboveStore,
                            isAboveStore: isExistingAboveStore,
                            isProvisioned: true,
                            portal: "Admin Hub"
                        }, context);
                    }

                    return new Response(JSON.stringify({
                        success: true,
                        message: `Credentials updated and emailed directly to ${existingTrainer.trainer_name || trainerName} (${targetEmail || 'on file'}).`,
                        user: {
                            trainer_id: existingTrainer.trainer_id,
                            name: existingTrainer.trainer_name || trainerName,
                            pin: cleanPin,
                            store: isExistingAboveStore ? 'Above-Store' : cleanStoreNum,
                            market: reqMarket,
                            role: targetRole,
                            is_gm: !!targetIsGm,
                            is_do: !!targetIsDo,
                            is_admin: !!targetIsAdmin,
                            is_exec: !!targetIsExec
                        }
                    }), { status: 200, headers: corsHeaders() });
                }

                if (existingTrainer.is_admin || existingTrainer.is_exec || (isExistingAboveStore && existingTrainer.is_do) || (!isExistingAboveStore && existingTrainer.is_gm)) {
                    return new Response(JSON.stringify({
                        success: true,
                        message: `Welcome back ${existingTrainer.trainer_name}! Access credentials confirmed.`,
                        user: {
                            trainer_id: existingTrainer.trainer_id,
                            name: existingTrainer.trainer_name,
                            pin: cleanPin,
                            store: isExistingAboveStore ? 'Above-Store' : cleanStoreNum,
                            market: reqMarket,
                            role: existingTrainer.role || (isExistingAboveStore ? 'Director of Ops' : 'General Manager'),
                            is_gm: !!existingTrainer.is_gm,
                            is_do: !!existingTrainer.is_do,
                            is_admin: !!existingTrainer.is_admin,
                            is_exec: !!existingTrainer.is_exec
                        }
                    }), { status: 200, headers: corsHeaders() });
                }

                // Existing trainer in Wow Way requesting GM / DO access from public portal - NEVER auto-approved!
                await db.prepare(`
                    UPDATE trainer_credentials 
                    SET trainer_pin = ?, store_num = ?, market = ?, email = COALESCE(NULLIF(?, ''), email),
                        notes = CASE WHEN notes LIKE '%Pending%' THEN notes ELSE COALESCE(notes, '') || ' - Pending GM Access Approval' END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE LOWER(trainer_id) = LOWER(?)
                `).bind(cleanPin, isExistingAboveStore ? 'Above-Store' : cleanStoreNum, reqMarket, email, existingTrainer.trainer_id).run();

                const token = generateGmDecisionToken(existingTrainer.trainer_id, cleanPin);
                const baseUrl = "https://tw-staffing.pages.dev/api/staffing";
                const approveUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(existingTrainer.trainer_id)}&pin=${encodeURIComponent(cleanPin)}&token=${token}&decision=approve`;
                const denyUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(existingTrainer.trainer_id)}&pin=${encodeURIComponent(cleanPin)}&token=${token}&decision=deny`;

                await callAppsScriptProxy({
                    action: "sendTrainerPinRequestEmail",
                    trainerName: existingTrainer.trainer_name,
                    pulseId: existingTrainer.trainer_id,
                    storeNum: isExistingAboveStore ? "Above-Store" : cleanStoreNum,
                    market: reqMarket,
                    pin: cleanPin,
                    email: email || existingTrainer.email,
                    role: isExistingAboveStore ? (requestedRole || existingTrainer.role || 'Director of Ops') : (existingTrainer.role || 'Trainer'),
                    isGm: false,
                    isDo: isExistingAboveStore,
                    isAboveStore: isExistingAboveStore,
                    isExistingTrainer: true,
                    approveUrl: approveUrl,
                    denyUrl: denyUrl
                }, context);

                return new Response(JSON.stringify({
                    success: true,
                    isExistingTrainerRequest: true,
                    message: `Profile verified! An authorization request has been sent to Mike Jacobs for Staffing Command access.`,
                    user: {
                        trainer_id: existingTrainer.trainer_id,
                        name: existingTrainer.trainer_name,
                        pin: cleanPin,
                        store: isExistingAboveStore ? 'Above-Store' : cleanStoreNum,
                        market: reqMarket,
                        role: existingTrainer.role || (isExistingAboveStore ? 'Director of Ops' : 'Trainer'),
                        is_gm: false,
                        is_do: false
                    }
                }), { status: 200, headers: corsHeaders() });
            }

            // 4. ROLE DETECTION & VALIDATION
            let detectedRole = isAboveStore ? (requestedRole || 'Director of Ops') : 'Trainer';

            if (isAboveStore) {
                // Check if email or name matches a recognized DO in stores
                const doMatch = await db.prepare("SELECT DISTINCT do_name, do_email, market FROM stores WHERE (LOWER(do_email) = LOWER(?) AND do_email != '') OR LOWER(do_name) = LOWER(?) LIMIT 1").bind(email, trainerName).first();
                if (doMatch) {
                    detectedRole = requestedRole || 'Director of Ops';
                }
            } else {
                // Store-level validation
                const storeRow = await db.prepare("SELECT store_number, market, manager_name, do_name FROM stores WHERE store_number = ? LIMIT 1").bind(cleanStoreNum).first();

                if (!storeRow) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: `Store #${cleanStoreNum} is not a recognized Team Wow store. Please check your 4-digit store number.`
                    }), { status: 400, headers: corsHeaders() });
                }

                if (storeRow.market.toLowerCase() !== reqMarket.toLowerCase()) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: `Store #${cleanStoreNum} belongs to the ${storeRow.market} market and cannot be registered under the ${reqMarket} market.`
                    }), { status: 400, headers: corsHeaders() });
                }

                const gmName = (storeRow.manager_name || '').toLowerCase().trim();
                const doName = (storeRow.do_name || '').toLowerCase().trim();
                const inputName = trainerName.toLowerCase().trim();

                if (gmName && (gmName.includes(inputName) || inputName.includes(gmName))) {
                    detectedRole = 'General Manager';
                } else if (doName && (doName.includes(inputName) || inputName.includes(doName))) {
                    detectedRole = 'Director of Ops';
                }
            }

            // ADMIN HUB PROVISIONING (Mike Jacobs creating user directly in hub)
            if (isAdminHub) {
                const finalRole = isAboveStore ? (requestedRole || 'Director of Ops') : (requestedRole || (detectedRole === 'General Manager' ? 'General Manager' : 'Trainer'));
                const isExecRole = finalRole === 'Executive';
                const isGmRole = isAboveStore || finalRole === 'General Manager';
                const isDoRole = isAboveStore || finalRole === 'Director of Ops';
                const regNote = isAboveStore ? 'Provisioned via Admin Hub (Above-Store)' : 'Provisioned via Admin Hub';

                await db.prepare(`
                    INSERT OR REPLACE INTO trainer_credentials (
                        trainer_id, trainer_name, trainer_pin, store_num, market,
                        email, role, is_wow_way_trainer, is_mit_trainer, is_gm, is_do, is_admin, is_exec, is_active, notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `).bind(
                    effectiveId, trainerName, cleanPin, cleanStoreNum, reqMarket,
                    email, finalRole, isGmRole ? 1 : 0, isDoRole ? 1 : 0, isExecRole ? 1 : 0, isExecRole ? 1 : 0, regNote
                ).run();

                // Send Credentials email directly to the recipient!
                if (email) {
                    await callAppsScriptProxy({
                        action: "sendGmApprovalNoticeToTrainer",
                        trainerName: trainerName,
                        pulseId: effectiveId,
                        storeNum: cleanStoreNum,
                        market: reqMarket,
                        pin: cleanPin,
                        email: email,
                        role: finalRole,
                        isDo: isAboveStore,
                        isAboveStore: isAboveStore,
                        isProvisioned: true,
                        portal: "Admin Hub"
                    }, context);
                }

                return new Response(JSON.stringify({
                    success: true,
                    message: `Profile registered! Credentials and login PIN have been emailed directly to ${trainerName} (${email || 'on file'}).`,
                    user: {
                        trainer_id: effectiveId,
                        name: trainerName,
                        pin: cleanPin,
                        store: cleanStoreNum,
                        market: reqMarket,
                        role: finalRole,
                        is_gm: isGmRole,
                        is_do: isDoRole,
                        is_admin: isExecRole,
                        is_exec: isExecRole,
                        is_wow_way_trainer: true,
                        is_mit_trainer: true
                    }
                }), { status: 200, headers: corsHeaders() });
            }

            // PUBLIC SELF-REGISTRATION WORKFLOW (Requires Mike's explicit approval!)
            const regNote = isMitPortal
                ? (isAboveStore ? 'Self-Registered Above-Store (MIT) - Pending Approval' : 'Self-Registered (MIT Portal) - Pending Approval')
                : (isAboveStore ? 'Self-Registered Above-Store - Pending Approval' : 'Self-Registered - Pending Approval');

            await db.prepare(`
                INSERT OR REPLACE INTO trainer_credentials (
                    trainer_id, trainer_name, trainer_pin, store_num, market,
                    email, role, is_wow_way_trainer, is_mit_trainer, is_gm, is_do, is_admin, is_exec, is_active, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, 0, 0, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).bind(
                effectiveId, trainerName, cleanPin, cleanStoreNum, reqMarket,
                email, detectedRole, isAboveStore ? 1 : 0, regNote
            ).run();

            // 5. EMAIL NOTIFICATION: Notify Mike Jacobs with 1-click mobile approval links
            const token = generateGmDecisionToken(effectiveId, cleanPin);
            const baseUrl = "https://tw-staffing.pages.dev/api/staffing";
            const scopeParam = isMitPortal ? "&scope=mit" : "";
            const approveUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(effectiveId)}&pin=${encodeURIComponent(cleanPin)}&token=${token}&decision=approve${scopeParam}`;
            const denyUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(effectiveId)}&pin=${encodeURIComponent(cleanPin)}&token=${token}&decision=deny${scopeParam}`;

            await callAppsScriptProxy({
                action: "sendTrainerPinRequestEmail",
                trainerName: trainerName,
                pulseId: effectiveId,
                storeNum: cleanStoreNum,
                market: reqMarket,
                pin: cleanPin,
                email: email,
                role: detectedRole,
                portal: isMitPortal ? "MIT Trainer Portal" : (isAboveStore ? "Above-Store Command" : "GM Staffing Command"),
                isMitRequest: isMitPortal,
                isGm: false,
                isDo: isAboveStore || detectedRole === 'Supervisor' || detectedRole === 'Director of Ops',
                isAboveStore: isAboveStore,
                isExistingTrainer: false,
                approveUrl: approveUrl,
                denyUrl: denyUrl
            }, context);

            let successNotice = `PIN registered! An authorization request has been sent to Mike Jacobs for GM Staffing Command access.`;
            if (isMitPortal) {
                successNotice = `PIN registered! An authorization request has been sent to Mike Jacobs for MIT Trainer Portal access.`;
            } else if (isAboveStore) {
                successNotice = `PIN registered! An authorization request has been sent to Mike Jacobs for Above-Store Staffing Command access.`;
            }

            return new Response(JSON.stringify({
                success: true,
                message: successNotice,
                user: {
                    trainer_id: effectiveId,
                    name: trainerName,
                    pin: cleanPin,
                    store: cleanStoreNum,
                    market: reqMarket,
                    role: detectedRole,
                    is_gm: false,
                    is_do: false,
                    is_mit_trainer: false
                }
            }), { status: 200, headers: corsHeaders() });
        }

        // On-demand Dispath of Credentials Email from Admin Hub
        if (action === "sendCredentialsEmail" || action === "resendCredentials") {
            const trainerId = String(payload.trainerId || url.searchParams.get("trainerId") || "").trim();
            if (!trainerId) {
                return new Response(JSON.stringify({ success: false, error: "Missing trainerId" }), { status: 400, headers: corsHeaders() });
            }
            const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(trainerId).first();
            if (!trainer) {
                return new Response(JSON.stringify({ success: false, error: "Trainer profile not found" }), { status: 404, headers: corsHeaders() });
            }
            if (!trainer.email) {
                return new Response(JSON.stringify({ success: false, error: "Trainer does not have an email address on file. Please edit profile and add an email." }), { status: 400, headers: corsHeaders() });
            }
            const isDo = !!trainer.is_do || !!trainer.is_exec || trainer.role === 'Supervisor' || trainer.role === 'Director of Operations' || trainer.role === 'Director of Ops' || trainer.role === 'Training Director' || trainer.role === 'Market Leader' || trainer.role === 'Executive' || trainer.store_num === 'Above-Store' || trainer.store_num === 'Exec' || trainer.store_num === 'DO';

            await callAppsScriptProxy({
                action: "sendGmApprovalNoticeToTrainer",
                trainerName: trainer.trainer_name,
                pulseId: trainer.trainer_id,
                storeNum: trainer.store_num,
                market: trainer.market,
                pin: trainer.trainer_pin,
                email: trainer.email,
                role: trainer.role || (isDo ? 'Director of Ops' : 'General Manager'),
                isDo: isDo,
                isAboveStore: isDo,
                isProvisioned: true,
                portal: "Admin Hub"
            }, context);

            return new Response(JSON.stringify({
                success: true,
                message: `Credentials email dispatched directly to ${trainer.trainer_name} (${trainer.email}).`
            }), { status: 200, headers: corsHeaders() });
        }

        // 1-Click Request GM Access from Barrier (When existing trainer enters PIN)
        if (action === "requestGmAccess") {
            const trainerId = (payload.trainerId || "").trim();
            const pin = (payload.pin || "").trim();

            if (!trainerId || !pin) {
                return new Response(JSON.stringify({ success: false, error: "Missing trainerId or pin" }), {
                    status: 400,
                    headers: corsHeaders()
                });
            }

            const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(trainerId).first();
            if (!trainer) {
                return new Response(JSON.stringify({ success: false, error: "Trainer profile not found" }), {
                    status: 404,
                    headers: corsHeaders()
                });
            }

            if (trainer.is_gm || trainer.is_do || trainer.is_admin || trainer.is_exec) {
                return new Response(JSON.stringify({
                    success: true,
                    alreadyAuthorized: true,
                    message: "You are already authorized for GM Staffing Command! Please unlock using your PIN."
                }), { status: 200, headers: corsHeaders() });
            }

            // Mark profile notes as pending GM access
            await db.prepare(`
                UPDATE trainer_credentials 
                SET notes = CASE WHEN notes LIKE '%Pending%' THEN notes ELSE COALESCE(notes, '') || ' - Pending GM Access Approval' END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE LOWER(trainer_id) = LOWER(?)
            `).bind(trainer.trainer_id).run();

            const token = generateGmDecisionToken(trainer.trainer_id, trainer.trainer_pin);
            const baseUrl = "https://tw-staffing.pages.dev/api/staffing";
            const approveUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(trainer.trainer_id)}&pin=${encodeURIComponent(trainer.trainer_pin)}&token=${token}&decision=approve`;
            const denyUrl = `${baseUrl}?action=decideGmAccess&id=${encodeURIComponent(trainer.trainer_id)}&pin=${encodeURIComponent(trainer.trainer_pin)}&token=${token}&decision=deny`;

            const isTrainerAboveStore = !!(trainer.is_do || trainer.role === 'Supervisor' || trainer.role === 'Director of Operations' || trainer.role === 'Executive' || trainer.store_num === 'Above-Store' || trainer.store_num === 'DO');
            await callAppsScriptProxy({
                action: "sendTrainerPinRequestEmail",
                trainerName: trainer.trainer_name,
                pulseId: trainer.trainer_id,
                storeNum: isTrainerAboveStore ? "Above-Store" : trainer.store_num,
                market: trainer.market,
                pin: trainer.trainer_pin,
                role: trainer.role,
                email: trainer.email || (trainer.trainer_id && trainer.trainer_id.includes('@') ? trainer.trainer_id : ''),
                isGm: false,
                isDo: isTrainerAboveStore,
                isAboveStore: isTrainerAboveStore,
                isExistingTrainer: true,
                approveUrl: approveUrl,
                denyUrl: denyUrl
            }, context);

            return new Response(JSON.stringify({
                success: true,
                message: `GM access request submitted for ${trainer.trainer_name}. Mike Jacobs has been emailed a 1-click authorization link.`
            }), { status: 200, headers: corsHeaders() });
        }

        // NTO Completion & Real-Time Credential Generation Flow
        if (action === "submitNtoCompletion") {
            const candidateId = (payload.candidateId || "").trim();
            const ssnLast4 = String(payload.ssnLast4 || "").trim();

            if (!candidateId) {
                return new Response(JSON.stringify({ success: false, error: "Missing candidateId." }), {
                    status: 400,
                    headers: corsHeaders(0)
                });
            }

            if (!/^\d{4}$/.test(ssnLast4)) {
                return new Response(JSON.stringify({ success: false, error: "Please provide a valid 4-digit SSN." }), {
                    status: 400,
                    headers: corsHeaders(0)
                });
            }

            // 1. Fetch candidate
            const candidate = await db.prepare("SELECT * FROM onboarding_candidates WHERE id = ? LIMIT 1")
                .bind(candidateId)
                .first();

            if (!candidate) {
                return new Response(JSON.stringify({ success: false, error: "Candidate record not found." }), {
                    status: 404,
                    headers: corsHeaders(0)
                });
            }

            const nameParts = (candidate.name || "").trim().split(/\s+/);
            const firstName = nameParts[0] || "Team";
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Member";
            const firstInit = firstName[0].toLowerCase();
            const cleanedLastName = lastName.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
            const baseId = (firstInit + cleanedLastName).slice(0, 15);

            // 2. Generate unique Employee ID & password (or reuse existing if already created)
            const existingEmp = await db.prepare("SELECT id, password FROM employees WHERE email = ? OR (LOWER(first_name) = ? AND LOWER(last_name) = ? AND store_num = ?) LIMIT 1")
                .bind(candidate.email, firstName.toLowerCase(), lastName.toLowerCase(), candidate.store_num)
                .first();

            let employeeId = existingEmp ? existingEmp.id : "";
            let password = existingEmp ? existingEmp.password : "";

            if (!employeeId) {
                let attempt = 0;
                let candidateEmpId = "";
                while (attempt < 20) {
                    const randNum = Math.floor(10 + Math.random() * 90);
                    candidateEmpId = `${baseId}${randNum}`;
                    const check = await db.prepare("SELECT id FROM employees WHERE id = ? LIMIT 1").bind(candidateEmpId).first();
                    if (!check) {
                        employeeId = candidateEmpId;
                        break;
                    }
                    attempt++;
                }
                if (!employeeId) {
                    employeeId = `${baseId}${Math.floor(100 + Math.random() * 900)}`;
                }

                const storeDigits = String(candidate.store_num || "0000").replace(/\D/g, "");
                const firstInitCap = (firstName[0] || "X").toUpperCase();
                const lastInitCap = (lastName[0] || "X").toUpperCase();
                password = `Dominos${storeDigits}${firstInitCap}${lastInitCap}`;

                const now = new Date();
                const hireDateStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

                // Insert into D1 employees table
                await db.prepare(`
                    INSERT INTO employees (
                        id, market, first_name, last_name, store_num, role, 
                        phone, email, password, hire_date, progress, current_level, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Day 1 Mod 1', 1, 1)
                `).bind(
                    employeeId,
                    candidate.market || "Dallas",
                    firstName,
                    lastName,
                    candidate.store_num,
                    candidate.position || "CSR",
                    candidate.phone_number || "",
                    candidate.email || "",
                    password,
                    hireDateStr
                ).run();
            }

            // 3. Update onboarding_candidates record in D1
            const now = new Date();
            const tz = (candidate.market || market || "Dallas").toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const dateStr = now.toLocaleDateString("en-US", { timeZone: tz });
            const timeStr = now.toLocaleTimeString("en-US", { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
            const timestampStr = `${dateStr} ${timeStr}`;
            const shirtSize = payload.shirtSize || candidate.shirt_size || "";
            const hatStyle = payload.hatStyle || candidate.hat_style || "Standard Cap";
            const payCard = payload.payCard || candidate.pay_card || "";

            const rawScore = payload.quizScore !== undefined && payload.quizScore !== null ? String(payload.quizScore) : '';
            let formattedScore = rawScore;
            if (/^[0-4]$/.test(rawScore)) {
                formattedScore = `${rawScore}/4 (${Math.round((parseInt(rawScore, 10) / 4) * 100)}%)`;
            }

            await db.prepare(`
                UPDATE onboarding_candidates
                SET nto_attendance = 'NTO Complete',
                    hired = 1,
                    missed_nto = 0,
                    shirt_size = ?,
                    hat_style = ?,
                    pay_card = ?,
                    quiz_score = ?,
                    nto_completed_at = ?,
                    ssn_last_4 = ?,
                    last_updated = ?
                WHERE id = ?
            `).bind(shirtSize, hatStyle, payCard, formattedScore, timestampStr, ssnLast4, timestampStr, candidateId).run();

            // Auto-sync new hire into staffing_records
            await syncHiredCandidatesToStaffing(db, candidate.market || market || "Dallas");

            // 4. Fetch store & GM details
            const store = await db.prepare("SELECT * FROM stores WHERE store_number = ? LIMIT 1")
                .bind(candidate.store_num)
                .first();

            const finalGmName = (store && store.manager_name) ? store.manager_name : ((store && store.do_name) ? `DO ${store.do_name}` : (candidate.do_name ? `DO ${candidate.do_name}` : ""));
            const finalGmPhone = (store && store.gm_phone) ? store.gm_phone : ((store && store.do_cell) ? store.do_cell : "");

            // 5. Dual-write to Apps Script (Dallas Credentials tab & Welcome Email)
            const gasUrl = "https://script.google.com/macros/s/AKfycbxQVuU0uQ3TdkfsBwJpZ-K1iUDXTuLgvqEayPeqZgSRLDNxHOEUsOrjaSZAujI8p_874g/exec";
            try {
                const gasPromise = fetch(gasUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "syncDallasCredentialsFromD1",
                        employeeId: employeeId,
                        password: password,
                        firstName: firstName,
                        lastName: lastName,
                        storeNum: candidate.store_num,
                        role: candidate.position || "CSR",
                        email: candidate.email || "",
                        phone: candidate.phone_number || "",
                        ssnLast4: ssnLast4
                    })
                });
                if (context && typeof context.waitUntil === "function") {
                    context.waitUntil(gasPromise);
                } else {
                    await gasPromise;
                }
            } catch (gasErr) {
                console.error("Failed to dispatch dual-write to Apps Script:", gasErr);
            }

            // 6. Return response to trainee (omitting password/employeeId to enforce in-store training compliance)
            return new Response(JSON.stringify({
                success: true,
                candidateName: candidate.name,
                storeNum: candidate.store_num,
                gmName: finalGmName,
                gmPhone: finalGmPhone,
                storeAddress: store ? (store.address || "") : "",
                storePhone: store ? (store.store_phone || "") : ""
            }), {
                status: 200,
                headers: corsHeaders(0)
            });
        }

        // 1. Candidate NTO Registration Flow (Phase 2 Unified Registration)
        if (action === "registerNtoClass") {
            const classId = payload.classId;
            const name = (payload.name || "").trim();
            const phone = (payload.phone || "").trim();
            const email = (payload.email || "").trim();
            const storeNum = (payload.storeNum || payload.store || "").toString().trim();
            const position = payload.position || "CSR";
            const candidateId = payload.candidateId || payload.id || "";
            const regMarket = payload.market || market || "Dallas";

            if (!classId || !name || !email) {
                return new Response(JSON.stringify({ success: false, error: "Missing required registration details (class, name, or email)" }), { status: 400, headers: corsHeaders() });
            }

            // 1a. Fetch class from D1
            const cls = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first();
            if (!cls) {
                return new Response(JSON.stringify({ success: false, error: "Orientation class session not found." }), { status: 404, headers: corsHeaders() });
            }

            if (cls.spots_taken >= cls.spots_total) {
                return new Response(JSON.stringify({ success: false, error: "This orientation class is currently full. Please select another date." }), { status: 400, headers: corsHeaders() });
            }

            // 1b. Check for duplicate registration in this exact class
            const isDenReg = regMarket.toLowerCase() === "denver";
            const existingReg = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND (LOWER(email) = LOWER(?) OR (phone != '' AND phone = ?))").bind(classId, email, phone).first();
            if (existingReg) {
                if (isDenReg) {
                    // Update any details that may have changed for Denver and resend confirmation
                    await db.prepare("UPDATE class_registrations SET candidate_name = ?, phone = ?, store_num = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                        .bind(name, phone, storeNum, position, existingReg.id).run();
                } else {
                    return new Response(JSON.stringify({
                        success: true,
                        message: "You are already registered for this session!",
                        classDate: cls.class_date,
                        startTime: cls.start_time,
                        meetLink: cls.meet_link,
                        alreadyRegistered: true
                    }), { status: 200, headers: corsHeaders() });
                }
            }

            // 1b-ii. Global Duplicate / Prior Registration Check across all historical sessions (Dallas only; Denver does not use duplicate blocker)
            if (!isDenReg) {
                const cleanDigits = phone.replace(/\D/g, '').slice(-10);
                let priorReg = null;
                if (candidateId) {
                    priorReg = await db.prepare(`
                        SELECT cr.*, tc.class_date, tc.start_time 
                        FROM class_registrations cr
                        LEFT JOIN training_classes tc ON cr.class_id = tc.id
                        WHERE cr.status = 'Confirmed' AND (cr.candidate_id = ? OR (LOWER(cr.candidate_name) = LOWER(?) AND LOWER(cr.email) = LOWER(?)))
                    `).bind(candidateId, name, email).first();
                } else if (email && cleanDigits.length === 10) {
                    priorReg = await db.prepare(`
                        SELECT cr.*, tc.class_date, tc.start_time 
                        FROM class_registrations cr
                        LEFT JOIN training_classes tc ON cr.class_id = tc.id
                        WHERE cr.status = 'Confirmed' AND LOWER(cr.candidate_name) = LOWER(?) AND (LOWER(cr.email) = LOWER(?) OR (cr.phone != '' AND REPLACE(REPLACE(REPLACE(REPLACE(cr.phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?))
                    `).bind(name, email, '%' + cleanDigits).first();
                } else if (email) {
                    priorReg = await db.prepare(`
                        SELECT cr.*, tc.class_date, tc.start_time 
                        FROM class_registrations cr
                        LEFT JOIN training_classes tc ON cr.class_id = tc.id
                        WHERE cr.status = 'Confirmed' AND LOWER(cr.candidate_name) = LOWER(?) AND LOWER(cr.email) = LOWER(?)
                    `).bind(name, email).first();
                }

                // 1b-iii. Check onboarding_candidates for prior scheduled NTO
                let candMatch = null;
                if (candidateId) {
                    const targetCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE id = ?").bind(candidateId).first();
                    if (targetCand && (targetCand.nto_scheduled === 1 || targetCand.nto_scheduled === "1" || (targetCand.nto_date && targetCand.nto_date.trim() !== ''))) {
                        candMatch = targetCand;
                    }
                } else {
                    if (email && cleanDigits.length === 10) {
                        candMatch = await db.prepare(`
                            SELECT * FROM onboarding_candidates 
                            WHERE (nto_scheduled = 1 OR (nto_date IS NOT NULL AND nto_date != '')) 
                              AND LOWER(name) = LOWER(?)
                              AND (LOWER(email) = LOWER(?) OR (phone_number != '' AND REPLACE(REPLACE(REPLACE(REPLACE(phone_number, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?))
                        `).bind(name, email, '%' + cleanDigits).first();
                    } else if (email) {
                        candMatch = await db.prepare(`
                            SELECT * FROM onboarding_candidates 
                            WHERE (nto_scheduled = 1 OR (nto_date IS NOT NULL AND nto_date != '')) 
                              AND LOWER(name) = LOWER(?)
                              AND LOWER(email) = LOWER(?)
                        `).bind(name, email).first();
                    }
                }

                if (priorReg || candMatch) {
                    const regId = "REG-PEND-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
                    await db.prepare("INSERT INTO class_registrations (id, class_id, candidate_id, candidate_name, store_num, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')").bind(regId, classId, candidateId, name, storeNum, position, phone, email).run();

                    await callAppsScriptProxy({
                        username: "dallas_admin",
                        password: "dallas_password_123",
                        action: "sendNtoDuplicateAlert",
                        name: name,
                        email: email,
                        phone: phone,
                        storeNum: storeNum,
                        classId: classId,
                        classDate: cls.class_date,
                        classTime: cls.start_time,
                        requestId: regId
                    }, context);

                    return new Response(JSON.stringify({
                        success: true,
                        pending: true,
                        message: "Request received and pending review.",
                        name: name,
                        email: email,
                        classDate: cls.class_date,
                        classTime: cls.start_time
                    }), { status: 200, headers: corsHeaders() });
                }
            }

            // 1c. Insert class registration
            if (!existingReg) {
                const regId = "REG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
                await db.prepare("INSERT INTO class_registrations (id, class_id, candidate_id, candidate_name, store_num, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed')").bind(regId, classId, candidateId, name, storeNum, position, phone, email).run();

                // 1d. Update spots_taken in training_classes
                await db.prepare("UPDATE training_classes SET spots_taken = spots_taken + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(classId).run();
            }

            // 1e. Update onboarding_candidates in D1
            const tz = regMarket.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = getNowFormatted(tz);

            let matchedCand = null;
            if (candidateId) {
                matchedCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE id = ?").bind(candidateId).first();
            }
            if (!matchedCand && email) {
                matchedCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE LOWER(email) = LOWER(?)").bind(email).first();
            }
            if (!matchedCand && phone) {
                const cleanP = phone.replace(/\D/g, '').slice(-10);
                if (cleanP.length === 10) {
                    matchedCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE REPLACE(REPLACE(phone_number, '-', ''), ' ', '') LIKE ?").bind('%' + cleanP).first();
                }
            }
            if (!matchedCand && name) {
                matchedCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE LOWER(name) = LOWER(?)").bind(name).first();
            }

            if (matchedCand) {
                await db.prepare(`
                    UPDATE onboarding_candidates SET
                        nto_date = ?,
                        nto_scheduled = 1,
                        missed_nto = 0,
                        nto_attendance = '',
                        phone_number = CASE WHEN (phone_number IS NULL OR phone_number = '') AND ? != '' THEN ? ELSE phone_number END,
                        email = CASE WHEN (email IS NULL OR email = '') AND ? != '' THEN ? ELSE email END,
                        store_num = CASE WHEN (store_num IS NULL OR store_num = '') AND ? != '' THEN ? ELSE store_num END,
                        market = CASE WHEN (market IS NULL OR market = '') THEN ? ELSE market END,
                        last_updated = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(cls.class_date, phone, phone, email, email, storeNum, storeNum, regMarket, nowFormatted, matchedCand.id).run();
            } else {
                // If candidate did not exist in onboarding_candidates yet, insert them!
                const newCandId = candidateId || `cand-${regMarket}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                let doName = '';
                if (storeNum) {
                    try {
                        const st = await db.prepare("SELECT do_name FROM stores WHERE store_number = ? AND market = ?").bind(storeNum, regMarket).first();
                        if (st && st.do_name) doName = st.do_name;
                    } catch (storeErr) {}
                }
                await db.prepare(`
                    INSERT INTO onboarding_candidates (
                        id, market, name, position, store_num, do_name, nto_date, nto_attendance,
                        nto_scheduled, phone_number, email, submission_received, onboarding_sent,
                        created_at, last_updated, updated_at
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?, 1, 1, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP
                    )
                `).bind(newCandId, regMarket, name, position || 'CSR', storeNum, doName, cls.class_date, phone, email, nowFormatted).run();
            }

            // 1f. Trigger confirmation email & admin alert via Google Apps Script microservice
            const isDen = regMarket.toLowerCase() === "denver";
            await callAppsScriptProxy({
                username: isDen ? "denver_admin" : "dallas_admin",
                password: isDen ? "denver_password_123" : "dallas_password_123",
                action: "sendNtoMeetLinks",
                classDate: cls.class_date,
                classTime: formatTimeDisplay(cls.start_time),
                meetLink: cls.meet_link || (isDen ? "https://meet.google.com/haf-izyt-gws" : "https://meet.google.com/zwc-afuu-hgh"),
                trainerName: cls.trainer || (isDen ? "Richard Keske" : "Mike Jacobs"),
                notifyAdmin: true,
                studentPhone: phone,
                storeNum: storeNum,
                market: regMarket,
                city: regMarket,
                trainees: [{ name: name, email: email }]
            }, context);

            return new Response(JSON.stringify({
                success: true,
                message: "Registration confirmed!",
                classDate: cls.class_date,
                startTime: formatTimeDisplay(cls.start_time),
                endTime: formatTimeDisplay(cls.end_time),
                meetLink: cls.meet_link,
                trainer: cls.trainer
            }), { status: 200, headers: corsHeaders() });
        }

        // 1b. Reschedule / Move NTO Candidate to a Different Class
        if (action === "rescheduleNtoCandidate") {
            const candidateId = payload.candidateId || "";
            const candidateName = (payload.name || payload.candidateName || "").trim();
            const candidateEmail = (payload.email || "").trim();
            const targetClassId = payload.targetClassId || payload.newClassId || "";
            const targetClassDate = payload.targetClassDate || payload.classDate || "";
            const sendEmailNotification = payload.sendEmail !== false;
            const regMarket = payload.market || market || "Dallas";

            if (!targetClassId && !targetClassDate) {
                return new Response(JSON.stringify({ success: false, error: "Missing target class ID or date." }), { status: 400, headers: corsHeaders() });
            }

            // 1. Fetch target class from D1
            let targetClass = null;
            if (targetClassId) {
                targetClass = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(targetClassId).first();
            }
            if (!targetClass && targetClassDate) {
                targetClass = await db.prepare("SELECT * FROM training_classes WHERE (class_date = ? OR REPLACE(class_date, ' ', '') = ?) AND (market = ? OR market = 'Virtual') AND is_active = 1 LIMIT 1")
                    .bind(targetClassDate, targetClassDate.replace(/\s/g, ''), regMarket).first();
            }

            if (!targetClass) {
                return new Response(JSON.stringify({ success: false, error: "Target orientation class session not found." }), { status: 404, headers: corsHeaders() });
            }

            // 2. Locate existing registration in class_registrations
            let currentReg = null;
            if (candidateId) {
                currentReg = await db.prepare("SELECT * FROM class_registrations WHERE candidate_id = ? ORDER BY created_at DESC").bind(candidateId).first();
            }
            if (!currentReg && candidateEmail) {
                currentReg = await db.prepare("SELECT * FROM class_registrations WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC").bind(candidateEmail).first();
            }
            if (!currentReg && candidateName) {
                currentReg = await db.prepare("SELECT * FROM class_registrations WHERE LOWER(candidate_name) = LOWER(?) ORDER BY created_at DESC").bind(candidateName).first();
            }

            const oldClassId = currentReg ? currentReg.class_id : null;

            // 3. Move registration or insert new if missing
            if (currentReg) {
                if (oldClassId && oldClassId !== targetClass.id) {
                    await db.prepare("UPDATE training_classes SET spots_taken = MAX(0, spots_taken - 1), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(oldClassId).run();
                }
                await db.prepare("UPDATE class_registrations SET class_id = ?, status = 'Confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(targetClass.id, currentReg.id).run();
            } else {
                const regId = "REG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
                await db.prepare("INSERT INTO class_registrations (id, class_id, candidate_id, candidate_name, store_num, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed')")
                    .bind(regId, targetClass.id, candidateId, candidateName, payload.storeNum || "", payload.position || "CSR", payload.phone || "", candidateEmail).run();
            }

            // 4. Increment spots on new class if different
            if (oldClassId !== targetClass.id) {
                await db.prepare("UPDATE training_classes SET spots_taken = spots_taken + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(targetClass.id).run();
            }

            // 5. Update onboarding_candidates record
            const tz = regMarket.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = getNowFormatted(tz);

            let matchedCand = null;
            if (candidateId) {
                matchedCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE id = ?").bind(candidateId).first();
            }
            if (!matchedCand && candidateEmail) {
                matchedCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE LOWER(email) = LOWER(?)").bind(candidateEmail).first();
            }
            if (!matchedCand && candidateName) {
                matchedCand = await db.prepare("SELECT * FROM onboarding_candidates WHERE LOWER(name) = LOWER(?)").bind(candidateName).first();
            }

            if (matchedCand) {
                await db.prepare(`
                    UPDATE onboarding_candidates SET
                        nto_date = ?,
                        nto_scheduled = 1,
                        last_updated = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(targetClass.class_date, nowFormatted, matchedCand.id).run();
            }

            // 6. Send updated Google Meet link & notification email
            let emailSent = false;
            const recipientEmail = candidateEmail || (matchedCand ? matchedCand.email : (currentReg ? currentReg.email : ""));
            const recipientName = candidateName || (matchedCand ? matchedCand.name : (currentReg ? currentReg.candidate_name : ""));

            if (sendEmailNotification && recipientEmail && recipientEmail.includes("@")) {
                const isDen = (targetClass.market || "").toLowerCase() === "denver";
                await callAppsScriptProxy({
                    username: isDen ? "denver_admin" : "dallas_admin",
                    password: isDen ? "denver_password_123" : "dallas_password_123",
                    action: "sendNtoMeetLinks",
                    classDate: targetClass.class_date,
                    classTime: targetClass.start_time,
                    meetLink: targetClass.meet_link || (isDen ? "https://meet.google.com/haf-izyt-gws" : "https://meet.google.com/zwc-afuu-hgh"),
                    trainerName: targetClass.trainer || (isDen ? "Richard Keske" : "Mike Jacobs"),
                    market: targetClass.market || "Dallas",
                    city: targetClass.market || "Dallas",
                    trainees: [{ name: recipientName, email: recipientEmail }]
                }, context);
                emailSent = true;
            }

            return new Response(JSON.stringify({
                success: true,
                message: `Successfully moved ${recipientName} to class on ${targetClass.class_date}!`,
                classDate: targetClass.class_date,
                startTime: targetClass.start_time,
                endTime: targetClass.end_time,
                meetLink: targetClass.meet_link,
                emailSent: emailSent
            }), { status: 200, headers: corsHeaders() });
        }

        // 2. Add NTO Class directly to D1 (with GAS backup)
        if (action === "addNtoClass") {
            const classDate = payload.classDate || "";
            const startTime = payload.startTime || "6:00 PM";
            const endTime = payload.endTime || "7:15 PM";
            const trainer = payload.trainerName || payload.trainer || (market === "Denver" ? "Richard" : "Mike");
            const capacity = parseInt(payload.capacity || 15, 10);
            const meetLink = payload.meetLink || (market === "Denver" ? "https://meet.google.com/haf-izyt-gws" : "https://meet.google.com/zwc-afuu-hgh");

            // Duplicate guard: prevent multiple sessions on the same date for this market
            const existing = await db.prepare("SELECT id FROM training_classes WHERE class_date = ? AND market = ? AND is_active = 1").bind(classDate, market).first();
            if (existing) {
                return new Response(JSON.stringify({ error: `A session is already scheduled on ${classDate}. Duplicate sessions on the same date are not allowed.` }), {
                    status: 400,
                    headers: corsHeaders()
                });
            }

            let idDatePart = "";
            const parts = classDate.split('/');
            if (parts.length === 3) {
                idDatePart = parts[2] + parts[0].padStart(2, '0') + parts[1].padStart(2, '0');
            } else {
                idDatePart = classDate.replace(/[^0-9]/g, '');
            }
            const trainerCode = market === "Denver" ? "Ric" : "Mik";
            const classId = payload.classId || `${idDatePart}-00-${trainerCode}`;

            await db.prepare(`
                INSERT INTO training_classes (
                    id, market, program, name, level, class_date, start_time, end_time, trainer, location, meet_link, spots_total, spots_taken, is_active
                ) VALUES (?, ?, 'NTO', 'New Team Member Orientation', 1, ?, ?, ?, ?, 'Virtual', ?, ?, 0, 1)
            `).bind(classId, market, classDate, startTime, endTime, trainer, meetLink, capacity).run();

            try {
                fetch(APPS_SCRIPT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(gasPayload)
                }).catch(() => {});
            } catch(e) {}

            return new Response(JSON.stringify({ success: true, message: "New orientation session added!", id: classId }), {
                status: 200,
                headers: corsHeaders()
            });
        }

        // 2b. Reschedule NTO Class in D1 (with automatic candidate roster migration & notifications)
        if (action === "rescheduleNtoClass") {
            const classId = payload.classId;
            const newClassDate = payload.newClassDate;
            const newStartTime = payload.newStartTime || payload.startTime || "6:00 PM";
            const newEndTime = payload.newEndTime || payload.endTime || "7:15 PM";
            const trainer = payload.trainerName || payload.trainer;
            const notifyAttendees = payload.notifyAttendees !== false;

            if (!classId || !newClassDate) {
                return new Response(JSON.stringify({ error: "Missing required classId or newClassDate." }), {
                    status: 400,
                    headers: corsHeaders()
                });
            }

            const currentClass = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first();
            if (!currentClass) {
                return new Response(JSON.stringify({ error: "Original class session not found." }), {
                    status: 404,
                    headers: corsHeaders()
                });
            }

            const oldClassDate = currentClass.class_date;

            // Generate new class ID based on new date
            let idDatePart = "";
            const parts = newClassDate.split('/');
            if (parts.length === 3) {
                idDatePart = parts[2] + parts[0].padStart(2, '0') + parts[1].padStart(2, '0');
            } else {
                idDatePart = newClassDate.replace(/[^0-9]/g, '');
            }
            const trainerCode = (currentClass.market || market) === "Denver" ? "Ric" : "Mik";
            const newClassId = `${idDatePart}-00-${trainerCode}`;

            // Check if a class already exists on the new date
            const existingOnNewDate = await db.prepare("SELECT id FROM training_classes WHERE class_date = ? AND market = ? AND is_active = 1 AND id != ?").bind(newClassDate, currentClass.market, classId).first();
            if (existingOnNewDate) {
                return new Response(JSON.stringify({ error: `A session is already scheduled on ${newClassDate}. Please select another date.` }), {
                    status: 400,
                    headers: corsHeaders()
                });
            }

            // Update training_classes record
            await db.prepare(`
                UPDATE training_classes 
                SET id = ?,
                    class_date = ?,
                    start_time = COALESCE(?, start_time),
                    end_time = COALESCE(?, end_time),
                    trainer = COALESCE(?, trainer),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(newClassId, newClassDate, newStartTime, newEndTime, trainer, classId).run();

            // Migrate all registered candidates from old classId to newClassId
            await db.prepare("UPDATE class_registrations SET class_id = ?, updated_at = CURRENT_TIMESTAMP WHERE class_id = ?").bind(newClassId, classId).run();

            // Also update onboarding_candidates whose nto_date was the old date
            await db.prepare("UPDATE onboarding_candidates SET nto_date = ?, updated_at = CURRENT_TIMESTAMP WHERE nto_date = ? AND market = ?").bind(newClassDate, oldClassDate, currentClass.market).run();

            // Fetch all confirmed attendees to notify them
            const attendeesRes = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND (status = 'Confirmed' OR status IS NULL OR status = '')").bind(newClassId).all();
            const attendees = attendeesRes.results || [];

            if (notifyAttendees && attendees.length > 0) {
                try {
                    const isDen = (currentClass.market || market).toLowerCase() === "denver";
                    fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            username: isDen ? "denver_admin" : "dallas_admin",
                            password: isDen ? "denver_password_123" : "dallas_password_123",
                            action: "sendClassRescheduledNotice",
                            program: "NTO",
                            market: currentClass.market,
                            oldClassDate: oldClassDate,
                            newClassDate: newClassDate,
                            newStartTime: newStartTime,
                            newEndTime: newEndTime,
                            meetLink: currentClass.meet_link || (isDen ? "https://meet.google.com/haf-izyt-gws" : "https://meet.google.com/zwc-afuu-hgh"),
                            trainerName: trainer || currentClass.trainer || (isDen ? "Richard Keske" : "Mike Jacobs"),
                            trainees: attendees.map(a => ({ name: a.candidate_name, email: a.email, storeNum: a.store_num, phone: a.phone }))
                        })
                    }).catch(() => {});
                } catch(e) {}
            }

            return new Response(JSON.stringify({
                success: true,
                message: `Class successfully rescheduled to ${newClassDate}. Migrated ${attendees.length} registered candidate(s).`,
                newClassId: newClassId,
                attendeesNotified: attendees.length
            }), {
                status: 200,
                headers: corsHeaders()
            });
        }

        // 3. Delete NTO Class directly from D1 (with GAS backup)
        if (action === "deleteNtoClass") {
            const classId = payload.classId;
            if (classId) {
                await db.prepare("UPDATE training_classes SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(classId).run();
            } else if (payload.classDate) {
                await db.prepare("UPDATE training_classes SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE class_date = ? AND market = ?").bind(payload.classDate, market).run();
            }

            try {
                fetch(APPS_SCRIPT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(gasPayload)
                }).catch(() => {});
            } catch(e) {}

            return new Response(JSON.stringify({ success: true, message: "Orientation session removed." }), {
                status: 200,
                headers: corsHeaders()
            });
        }

        // 3b. Fetch NTO Classes directly from D1 with live attendee rosters and accurate counts
        if (action === "getNtoClasses") {
            const [classesRes, regsRes] = await Promise.all([
                db.prepare("SELECT * FROM training_classes WHERE program = 'NTO' AND (market = ? OR market = 'Virtual') AND is_active = 1 ORDER BY class_date ASC").bind(market).all(),
                db.prepare("SELECT class_id, candidate_name FROM class_registrations").all()
            ]);

            const regMap = {};
            (regsRes.results || []).forEach(r => {
                if (!regMap[r.class_id]) regMap[r.class_id] = [];
                regMap[r.class_id].push(r.candidate_name);
            });

            const classes = (classesRes.results || []).map(cl => {
                const attendees = regMap[cl.id] || [];
                return {
                    id: cl.id,
                    classId: cl.id,
                    market: cl.market,
                    name: cl.name,
                    classDate: cl.class_date,
                    startTime: cl.start_time,
                    endTime: cl.end_time,
                    trainer: cl.trainer,
                    trainerName: cl.trainer,
                    location: cl.location,
                    meetLink: cl.meet_link,
                    spotsTotal: cl.spots_total,
                    capacity: cl.spots_total,
                    spotsTaken: attendees.length > 0 ? attendees.length : cl.spots_taken,
                    attendees: attendees
                };
            });

            classes.sort((a, b) => parseDateForSort(a.classDate) - parseDateForSort(b.classDate));

            return new Response(JSON.stringify({
                success: true,
                market,
                classes: classes
            }), { status: 200, headers: corsHeaders() });
        }

        // 3c. MIT Class Operations (D1 Native)
        if (action === "getMitClasses") {
            const [classesRes, regsRes] = await Promise.all([
                db.prepare("SELECT * FROM training_classes WHERE program = 'MIT' AND (market = ? OR market = 'Virtual') AND is_active = 1").bind(market).all(),
                db.prepare("SELECT class_id, candidate_name, store_num, position, phone, email, status FROM class_registrations WHERE class_id IN (SELECT id FROM training_classes WHERE program = 'MIT' AND (market = ? OR market = 'Virtual') AND is_active = 1)").bind(market).all()
            ]);

            const regMap = {};
            (regsRes.results || []).forEach(r => {
                if (!regMap[r.class_id]) regMap[r.class_id] = [];
                regMap[r.class_id].push(r);
            });

            const mitClasses = (classesRes.results || []).map(cl => {
                const registrations = regMap[cl.id] || [];
                const confirmedRegs = registrations.filter(r => r.status === 'Confirmed' || !r.status);
                let isoDate = null;
                try {
                    const parts = (cl.class_date || '').split('/');
                    if (parts.length === 3) {
                        const m = parts[0].padStart(2, '0');
                        const d = parts[1].padStart(2, '0');
                        const y = parts[2];
                        const hour = cl.start_time && cl.start_time.includes('6:00') ? '18' : (cl.start_time && cl.start_time.includes('2:00') ? '14' : '11');
                        isoDate = `${y}-${m}-${d}T${hour}:00:00`;
                    }
                } catch (e) {}

                const spotsTaken = confirmedRegs.length > 0 ? confirmedRegs.length : (cl.spots_taken || 0);
                const spotsTotal = cl.spots_total || 15;

                return {
                    id: cl.id,
                    classId: cl.id,
                    market: cl.market,
                    name: cl.name,
                    level: cl.level || 1,
                    classDate: cl.class_date,
                    startTime: cl.start_time,
                    endTime: cl.end_time,
                    trainer: cl.trainer,
                    trainerName: cl.trainer,
                    location: cl.location,
                    meetLink: cl.meet_link,
                    spotsTotal: spotsTotal,
                    capacity: spotsTotal,
                    spotsTaken: spotsTaken,
                    spotsLeft: Math.max(0, spotsTotal - spotsTaken),
                    openDate: cl.open_date,
                    closeDate: cl.close_date,
                    attendees: confirmedRegs.map(r => r.candidate_name),
                    roster: registrations,
                    isoDate: isoDate
                };
            });

            mitClasses.sort((a, b) => parseDateForSort(a.classDate) - parseDateForSort(b.classDate));

            return new Response(JSON.stringify({
                success: true,
                market,
                classes: mitClasses
            }), { status: 200, headers: corsHeaders() });
        }

        if (action === "getMitRoster") {
            const classId = payload.classId;
            if (!classId) {
                return new Response(JSON.stringify({ success: false, error: "Missing classId" }), { status: 400, headers: corsHeaders() });
            }
            const [cls, regs] = await Promise.all([
                db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first(),
                db.prepare("SELECT * FROM class_registrations WHERE class_id = ? ORDER BY created_at ASC").bind(classId).all()
            ]);
            return new Response(JSON.stringify({
                success: true,
                class: cls,
                roster: regs.results || []
            }), { status: 200, headers: corsHeaders() });
        }

        if (action === "addMitClass") {
            const classDate = payload.classDate || "";
            const startTime = payload.startTime || "11:00 AM";
            const endTime = payload.endTime || "1:00 PM";
            const name = payload.name || payload.className || "Operations Assessment";
            const level = parseInt(payload.level || 1, 10);
            const location = payload.location || "McKinney";
            const trainer = payload.trainer || payload.trainerName || "";
            const capacity = parseInt(payload.capacity || payload.spotsTotal || 15, 10);
            const meetLink = payload.meetLink || "";
            const openDate = payload.openDate || "";
            const closeDate = payload.closeDate || "";

            let idDatePart = "";
            const parts = classDate.split('/');
            if (parts.length === 3) {
                idDatePart = parts[2] + parts[0].padStart(2, '0') + parts[1].padStart(2, '0');
            } else {
                idDatePart = classDate.replace(/[^0-9]/g, '');
            }
            const nameAbbr = (name || "Cls").substring(0, 3);
            const hourNum = startTime.includes("11") ? "11" : (startTime.includes("2:") || startTime.includes("14") ? "14" : (startTime.includes("6:") || startTime.includes("18") ? "18" : "00"));
            const classId = payload.classId || `${idDatePart}-${hourNum}-${nameAbbr}`;

            await db.prepare(`
                INSERT INTO training_classes (
                    id, market, program, name, level, class_date, start_time, end_time, trainer, location, meet_link, spots_total, spots_taken, open_date, close_date, is_active
                ) VALUES (?, ?, 'MIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
            `).bind(classId, market, name, level, classDate, startTime, endTime, trainer, location, meetLink, capacity, openDate, closeDate).run();

            return new Response(JSON.stringify({ success: true, message: "MIT class added!", id: classId }), { status: 200, headers: corsHeaders() });
        }

        if (action === "deleteMitClass") {
            const classId = payload.classId;
            if (classId) {
                await db.prepare("UPDATE training_classes SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(classId).run();
            }
            return new Response(JSON.stringify({ success: true, message: "MIT class deactivated." }), { status: 200, headers: corsHeaders() });
        }

        if (action === "removeMitAttendee" || action === "deleteMitRegistration") {
            const regId = payload.registrationId || payload.id;
            const classId = payload.classId;
            if (regId) {
                await db.prepare("DELETE FROM class_registrations WHERE id = ?").bind(regId).run();
                if (classId) {
                    await db.prepare("UPDATE training_classes SET spots_taken = MAX(0, spots_taken - 1), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(classId).run();
                }
                return new Response(JSON.stringify({ success: true, message: "Attendee removed from session." }), { status: 200, headers: corsHeaders() });
            }
            return new Response(JSON.stringify({ success: false, error: "Missing registrationId" }), { status: 400, headers: corsHeaders() });
        }

        if (action === "updateMitClass") {
            const classId = payload.classId;
            if (!classId) {
                return new Response(JSON.stringify({ success: false, error: "Missing classId" }), { status: 400, headers: corsHeaders() });
            }

            const currentClass = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first();
            if (!currentClass) {
                return new Response(JSON.stringify({ success: false, error: "MIT class session not found." }), { status: 404, headers: corsHeaders() });
            }

            const oldClassDate = currentClass.class_date;
            const newClassDate = payload.classDate || oldClassDate;
            const dateChanged = Boolean(newClassDate && newClassDate !== oldClassDate);

            // Automatically recalculate close_date when classDate changes (default 4:00 PM UTC / 10:00 AM MT on session day)
            let newCloseDate = payload.closeDate || null;
            if (!newCloseDate && dateChanged && newClassDate) {
                const parts = newClassDate.split('/');
                if (parts.length === 3) {
                    const m = parts[0].padStart(2, '0');
                    const d = parts[1].padStart(2, '0');
                    const y = parts[2];
                    newCloseDate = `${y}-${m}-${d}T16:00:00.000Z`;
                }
            }

            const name = payload.name || currentClass.name;
            const level = payload.level || currentClass.level;
            const trainer = payload.trainer || payload.trainerName || currentClass.trainer;
            const location = payload.location || currentClass.location;
            const startTime = payload.startTime || currentClass.start_time;
            const endTime = payload.endTime || currentClass.end_time;
            const capacity = payload.capacity || payload.spotsTotal || currentClass.spots_total;
            const meetLink = payload.meetLink !== undefined ? payload.meetLink : currentClass.meet_link;
            const notifyAttendees = payload.notifyAttendees !== false;

            await db.prepare(`
                UPDATE training_classes 
                SET class_date = COALESCE(?, class_date),
                    close_date = COALESCE(?, close_date),
                    name = COALESCE(?, name),
                    level = COALESCE(?, level),
                    trainer = COALESCE(?, trainer),
                    location = COALESCE(?, location),
                    start_time = COALESCE(?, start_time),
                    end_time = COALESCE(?, end_time),
                    spots_total = COALESCE(?, spots_total),
                    meet_link = COALESCE(?, meet_link),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(newClassDate, newCloseDate, name, level, trainer, location, startTime, endTime, capacity, meetLink, classId).run();

            // Safety cascade: If the class ID is being re-keyed to a new ID, cascade update to all enrollees
            const newClassId = payload.newClassId;
            if (newClassId && newClassId !== classId) {
                await db.prepare("UPDATE training_classes SET id = ? WHERE id = ?").bind(newClassId, classId).run();
                await db.prepare("UPDATE class_registrations SET class_id = ? WHERE class_id = ?").bind(newClassId, classId).run();
            }

            // If date changed, notify all confirmed registered attendees!
            let attendeesNotified = 0;
            if (dateChanged && notifyAttendees) {
                const attendeesRes = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND (status = 'Confirmed' OR status IS NULL OR status = '')").bind(classId).all();
                const attendees = attendeesRes.results || [];
                attendeesNotified = attendees.length;

                if (attendees.length > 0) {
                    try {
                        const isDen = (currentClass.market || market).toLowerCase() === "denver";
                        fetch(APPS_SCRIPT_URL, {
                            method: "POST",
                            headers: { "Content-Type": "text/plain;charset=utf-8" },
                            body: JSON.stringify({
                                username: isDen ? "denver_admin" : "dallas_admin",
                                password: isDen ? "denver_password_123" : "dallas_password_123",
                                action: "sendClassRescheduledNotice",
                                program: "MIT",
                                className: name,
                                level: level,
                                market: currentClass.market,
                                oldClassDate: oldClassDate,
                                newClassDate: newClassDate,
                                newStartTime: startTime,
                                newEndTime: endTime,
                                location: location,
                                trainerName: trainer,
                                trainees: attendees.map(a => ({ 
                                    name: a.candidate_name, 
                                    email: a.email, 
                                    storeNum: a.store_num, 
                                    phone: a.phone, 
                                    position: a.position 
                                }))
                            })
                        }).catch(() => {});
                    } catch(e) {}
                }
            }

            return new Response(JSON.stringify({ 
                success: true, 
                message: dateChanged ? `MIT class rescheduled to ${newClassDate}. Notified ${attendeesNotified} attendee(s).` : "MIT class updated.", 
                dateChanged: dateChanged,
                attendeesNotified: attendeesNotified
            }), { status: 200, headers: corsHeaders() });
        }

        if (action === "registerMitClass" || action === "registerMitCandidate") {
            const classId = payload.classId;
            const name = (payload.name || payload.candidateName || "").trim();
            const phone = (payload.phone || "").trim();
            const email = (payload.email || "").trim();
            const storeNum = (payload.storeNum || payload.store || "").toString().trim();
            const position = payload.position || "MIT 1";
            const candidateId = payload.candidateId || payload.employeeId || "";

            if (!classId || !name) {
                return new Response(JSON.stringify({ success: false, error: "Missing required registration details (class or name)" }), { status: 400, headers: corsHeaders() });
            }

            const cls = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first();
            if (!cls) {
                return new Response(JSON.stringify({ success: false, error: "MIT class session not found." }), { status: 404, headers: corsHeaders() });
            }

            if (cls.spots_taken >= cls.spots_total) {
                return new Response(JSON.stringify({ success: false, error: "This class is currently full. Please select another date." }), { status: 400, headers: corsHeaders() });
            }

            // Check for duplicate in this exact class
            const existingReg = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND (LOWER(candidate_name) = LOWER(?) OR (phone != '' AND phone = ?))").bind(classId, name, phone).first();
            if (existingReg) {
                return new Response(JSON.stringify({
                    success: true,
                    message: "You are already registered for this session!",
                    classDate: cls.class_date,
                    startTime: cls.start_time,
                    alreadyRegistered: true
                }), { status: 200, headers: corsHeaders() });
            }

            const regId = `REG-MIT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

            await db.prepare(`
                INSERT INTO class_registrations (
                    id, class_id, candidate_id, candidate_name, store_num, position, phone, email, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).bind(regId, classId, candidateId, name, storeNum, position, phone, email).run();

            // Increment spots_taken
            await db.prepare("UPDATE training_classes SET spots_taken = spots_taken + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(classId).run();

            // Trainer Contacts Map
            const TRAINER_PHONES = {
                "bobby": "(214) 609-4715",
                "chris": "(469) 674-8855",
                "paul": "(469) 450-9169",
                "phu": "(214) 404-6535",
                "rebecca": "(469) 390-8012",
                "amanda": "(972) 802-4392",
                "beans": "(214) 244-2599",
                "kevin": "(469) 515-5957",
                "melissa": "(972) 246-7668",
                "stephanie": "(817) 521-1016"
            };
            const trainerKey = (cls.trainer || "").toString().toLowerCase().trim().split(/\s+/)[0];
            const resolvedTrainerPhone = TRAINER_PHONES[trainerKey] || "(214) 609-4715";

            // Fire automated confirmation email via Google Apps Script microservice
            if (email && email.includes("@")) {
                try {
                    await fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            username: "dallas_admin",
                            password: "dallas_password_123",
                            action: "sendMitConfirmationEmail",
                            candidateName: name,
                            candidateEmail: email,
                            storeNum: storeNum,
                            position: position,
                            className: cls.name,
                            level: cls.level,
                            classDate: cls.class_date,
                            startTime: cls.start_time,
                            endTime: cls.end_time,
                            location: cls.location,
                            trainerName: cls.trainer,
                            trainerPhone: resolvedTrainerPhone,
                            bobbyPhone: "(214) 609-4715"
                        })
                    });
                } catch (emailErr) {
                    console.warn("MIT confirmation email dispatch failed:", emailErr);
                }
            }

            return new Response(JSON.stringify({
                success: true,
                message: "Successfully registered for MIT class!",
                registrationId: regId,
                classId: classId,
                className: cls.name,
                classDate: cls.class_date,
                startTime: cls.start_time,
                location: cls.location,
                spotsTaken: cls.spots_taken + 1,
                spotsTotal: cls.spots_total
            }), { status: 200, headers: corsHeaders() });
        }

        // --- MIT AUTOMATION: SEND MORNING-OF REMINDERS ---
        if (action === "sendMitMorningReminders") {
            const todayMdy = payload.date || getNowFormatted().split(' ')[0]; // e.g. "9/23/2026"
            const TRAINER_PHONES = {
                "bobby": "(214) 609-4715",
                "chris": "(469) 674-8855",
                "paul": "(469) 450-9169",
                "phu": "(214) 404-6535",
                "rebecca": "(469) 390-8012",
                "amanda": "(972) 802-4392",
                "beans": "(214) 244-2599",
                "kevin": "(469) 515-5957",
                "melissa": "(972) 246-7668",
                "stephanie": "(817) 521-1016"
            };

            const classesToday = await db.prepare("SELECT * FROM training_classes WHERE program = 'MIT' AND (class_date = ? OR REPLACE(class_date, ' ', '') = ?) AND is_active = 1").bind(todayMdy, todayMdy).all();
            const classesList = classesToday.results || [];
            let totalRemindersSent = 0;

            for (const c of classesList) {
                const regs = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND (status = 'Confirmed' OR status IS NULL OR status = '')").bind(c.id).all();
                const trainerKey = (c.trainer || "").toString().toLowerCase().trim().split(/\s+/)[0];
                const resolvedTrainerPhone = TRAINER_PHONES[trainerKey] || "(214) 609-4715";

                for (const reg of (regs.results || [])) {
                    if (reg.email && reg.email.includes("@")) {
                        try {
                            await fetch(APPS_SCRIPT_URL, {
                                method: "POST",
                                headers: { "Content-Type": "text/plain;charset=utf-8" },
                                body: JSON.stringify({
                                    username: "dallas_admin",
                                    password: "dallas_password_123",
                                    action: "sendMitMorningReminder",
                                    candidateName: reg.candidate_name,
                                    candidateEmail: reg.email,
                                    className: c.name,
                                    level: c.level,
                                    classDate: c.class_date,
                                    startTime: c.start_time,
                                    endTime: c.end_time,
                                    location: c.location,
                                    trainerName: c.trainer,
                                    trainerPhone: resolvedTrainerPhone,
                                    bobbyPhone: "(214) 609-4715"
                                })
                            });
                            totalRemindersSent++;
                        } catch (err) {
                            console.warn("Failed sending MIT morning reminder to:", reg.email, err);
                        }
                    }
                }
            }

            return new Response(JSON.stringify({ success: true, count: totalRemindersSent, classesCount: classesList.length }), { status: 200, headers: corsHeaders() });
        }

        // --- MIT AUTOMATION: SEND FINAL ROSTER TO TRAINER AFTER CUTOFF ---
        if (action === "sendMitTrainerRosters") {
            const classId = payload.classId;
            const TRAINER_EMAILS = {
                "bobby": "Bobby@team-wow.com",
                "chris": "chris@team-wow.com",
                "paul": "paul@team-wow.com",
                "phu": "phu@team-wow.com",
                "rebecca": "rebecca@team-wow.com",
                "amanda": "amanda@team-wow.com",
                "beans": "beans@team-wow.com",
                "kevin": "kevin@team-wow.com",
                "melissa": "melissa@team-wow.com",
                "stephanie": "stephanie@team-wow.com"
            };

            let classesToProcess = [];
            if (classId) {
                const c = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first();
                if (c) classesToProcess.push(c);
            } else {
                const todayMdy = payload.date || getNowFormatted().split(' ')[0];
                const closing = await db.prepare("SELECT * FROM training_classes WHERE program = 'MIT' AND (close_date = ? OR class_date = ?) AND is_active = 1").bind(todayMdy, todayMdy).all();
                classesToProcess = closing.results || [];
            }

            let rostersSent = 0;
            for (const c of classesToProcess) {
                const regs = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND (status = 'Confirmed' OR status IS NULL OR status = '')").bind(c.id).all();
                const attendees = regs.results || [];
                const trainerKey = (c.trainer || "").toString().toLowerCase().trim().split(/\s+/)[0];
                const trainerEmail = TRAINER_EMAILS[trainerKey] || "Bobby@team-wow.com";

                try {
                    await fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            username: "dallas_admin",
                            password: "dallas_password_123",
                            action: "sendMitTrainerRoster",
                            trainerEmail: trainerEmail,
                            trainerName: c.trainer || "Trainer",
                            className: c.name,
                            level: c.level,
                            classDate: c.class_date,
                            startTime: c.start_time,
                            endTime: c.end_time,
                            location: c.location,
                            attendees: attendees
                        })
                    });
                    rostersSent++;
                } catch (err) {
                    console.warn("Failed sending trainer roster for:", c.id, err);
                }
            }

            return new Response(JSON.stringify({ success: true, count: rostersSent }), { status: 200, headers: corsHeaders() });
        }

        if (action === "saveMitAttendance" || action === "updateMitAttendance") {
            const registrations = payload.registrations || (payload.registrationId ? [payload] : []);
            const trainerName = payload.trainerName || payload.trainer || "";

            for (const r of registrations) {
                const regId = r.id || r.registrationId;
                const status = r.status || "Attended"; // 'Attended', 'Absent', 'Completed'
                const notes = r.notes || r.attendanceNotes || "";

                if (regId) {
                    await db.prepare(`
                        UPDATE class_registrations 
                        SET status = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).bind(status, regId).run();

                    // If Completed, log to mit_attendance_records for permanent promotion ledger
                    if (status === "Completed") {
                        const reg = await db.prepare("SELECT cr.*, tc.name as class_name, tc.level, tc.class_date, tc.market, tc.location FROM class_registrations cr JOIN training_classes tc ON cr.class_id = tc.id WHERE cr.id = ?").bind(regId).first();
                        if (reg) {
                            await db.prepare(`
                                INSERT INTO mit_attendance_records (
                                    candidate_name, candidate_id, do_name, store_num, attendance_date, class_name, level, market, delivery_mode, trainer_name, source_tab, is_active_employee
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'D1_Live', 1)
                            `).bind(
                                reg.candidate_name,
                                reg.candidate_id || '',
                                reg.do_name || '',
                                reg.store_num,
                                reg.class_date,
                                reg.class_name,
                                reg.level || 1,
                                reg.market || 'Dallas',
                                reg.location === 'Virtual' ? 'Virtual' : 'In-Person',
                                trainerName || ''
                            ).run();
                        }
                    }
                }
            }

            return new Response(JSON.stringify({ success: true, message: "Attendance saved." }), { status: 200, headers: corsHeaders() });
        }

        // --- MIT ATTENDANCE GROUND TRUTH: OFFICIAL COMPLETION SUBMISSION ---
        if (action === "submitMitCompletion") {
            const classId = payload.classId || "";
            const candidateName = (payload.candidateName || payload.name || "").trim();
            const storeNum = (payload.storeNum || payload.store || "").toString().trim();
            const position = payload.position || "MIT 1";
            const phone = (payload.phone || "").trim();
            const email = (payload.email || "").trim();
            const takeaway = payload.takeaway || "";
            const rating = payload.rating || "";

            if (!candidateName || !storeNum) {
                return new Response(JSON.stringify({ success: false, error: "Missing candidate name or store number" }), { status: 400, headers: corsHeaders() });
            }

            // Fetch class details if classId provided
            let cls = null;
            if (classId) {
                cls = await db.prepare("SELECT * FROM training_classes WHERE id = ?").bind(classId).first();
            }

            const className = cls ? cls.name : (payload.className || "MIT Leadership");
            const level = cls ? (cls.level || 1) : parseInt(payload.level || 1, 10);
            const classDate = cls ? cls.class_date : (payload.classDate || getNowFormatted().split(' ')[0]);
            const trainerName = cls ? (cls.trainer || "") : (payload.trainerName || "");
            const deliveryMode = cls && cls.location === 'Virtual' ? 'Virtual' : 'In-Person';

            // 1. Insert into mit_attendance_records (Ground truth)
            await db.prepare(`
                INSERT INTO mit_attendance_records (
                    candidate_name, do_name, store_num, attendance_date, class_name, level, market, delivery_mode, trainer_name, source_tab, is_active_employee
                ) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, 'D1_Live', 1)
            `).bind(candidateName, storeNum, classDate, className, level, market, deliveryMode, trainerName).run();

            // 2. Mark matching registration as Completed in class_registrations (if exists)
            if (classId) {
                const updated = await db.prepare(`
                    UPDATE class_registrations 
                    SET status = 'Completed', updated_at = CURRENT_TIMESTAMP 
                    WHERE class_id = ? AND (LOWER(candidate_name) = LOWER(?) OR (phone != '' AND phone = ?))
                `).bind(classId, candidateName, phone).run();

                // If not pre-registered (walk-in), insert as Completed registration
                if (!updated.meta?.changes || updated.meta.changes === 0) {
                    const regId = `REG-WALKIN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
                    await db.prepare(`
                        INSERT INTO class_registrations (
                            id, class_id, candidate_name, store_num, position, phone, email, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `).bind(regId, classId, candidateName, storeNum, position, phone, email).run();
                }
            }

            return new Response(JSON.stringify({ 
                success: true, 
                message: "MIT Class Completion recorded successfully!",
                candidateName,
                className,
                level,
                classDate,
                storeNum
            }), { status: 200, headers: corsHeaders() });
        }

        // 3d. Direct D1 NTO Payroll Data Provider (Bypasses Google Sheets completely)
        if (action === "getNtoPayrollReportData" || action === "getNtoPayrollData") {
            const startDateStr = payload.startDate || url.searchParams.get("startDate") || "";
            const endDateStr = payload.endDate || url.searchParams.get("endDate") || "";
            const targetMarket = payload.market || url.searchParams.get("market") || market || "Dallas";

            const parseDateLocal = (dStr) => {
                if (!dStr) return null;
                const str = String(dStr).trim();
                const parts = str.includes("-") ? str.split("-") : str.split("/");
                if (parts.length === 3) {
                    if (parts[0].length === 4) { // YYYY-MM-DD
                        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                    } else { // M/D/YYYY
                        return new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));
                    }
                }
                const d = new Date(str);
                return isNaN(d.getTime()) ? null : d;
            };

            const startObj = parseDateLocal(startDateStr);
            const endObj = parseDateLocal(endDateStr);
            if (startObj) startObj.setHours(0, 0, 0, 0);
            if (endObj) endObj.setHours(23, 59, 59, 999);

            const { results: candidates } = await db.prepare(`
                SELECT id, name, store_num, position, nto_date, nto_attendance, ssn_last_4, phone_number, email
                FROM onboarding_candidates
                WHERE LOWER(market) = LOWER(?)
                  AND nto_attendance IN ('NTO Complete', 'Attended')
                  AND (ineligible = 0 OR ineligible IS NULL)
                  AND (inactive = 0 OR inactive IS NULL)
                  AND (withdrawn = 0 OR withdrawn IS NULL)
            `).bind(targetMarket).all();

            const { results: classes } = await db.prepare(`
                SELECT class_date, start_time, end_time
                FROM training_classes
                WHERE LOWER(market) = LOWER(?)
            `).bind(targetMarket).all();

            const classHoursByDate = {};
            (classes || []).forEach(cls => {
                if (cls.class_date) {
                    const parsedClsDate = parseDateLocal(cls.class_date);
                    if (parsedClsDate && cls.start_time && cls.end_time) {
                        const dateKey = `${parsedClsDate.getMonth() + 1}/${parsedClsDate.getDate()}/${parsedClsDate.getFullYear()}`;
                        try {
                            const parseMins = (tStr) => {
                                const m = (tStr || "").trim().match(/(\d+):(\d+)\s*(AM|PM)?/i);
                                if (!m) return 0;
                                let h = parseInt(m[1], 10);
                                const mn = parseInt(m[2], 10);
                                const meridiem = (m[3] || "").toUpperCase();
                                if (meridiem === "PM" && h < 12) h += 12;
                                if (meridiem === "AM" && h === 12) h = 0;
                                return h * 60 + mn;
                            };
                            let sM = parseMins(cls.start_time);
                            let eM = parseMins(cls.end_time);
                            if (sM === 0 && eM > 720) sM = 18 * 60;
                            if (sM < 720 && eM >= 720 && (sM + 720) <= eM) sM += 720;
                            let diff = eM - sM;
                            if (diff < 0 && (diff + 12 * 60) > 0) diff += 12 * 60;
                            else if (diff < 0) diff += 24 * 60;
                            while (diff > 5 * 60) diff -= 12 * 60;
                            if (diff > 0) {
                                classHoursByDate[dateKey] = (diff / 60).toFixed(2);
                            }
                        } catch (e) {}
                    }
                }
            });

            const matchedRows = [];
            const seenKeys = new Set();

            (candidates || []).forEach(c => {
                if (!c.nto_date) return;
                const candDate = parseDateLocal(c.nto_date);
                if (!candDate) return;

                if (startObj && candDate < startObj) return;
                if (endObj && candDate > endObj) return;

                const formattedDate = `${candDate.getMonth() + 1}/${candDate.getDate()}/${candDate.getFullYear()}`;
                const nameClean = (c.name || '').trim();
                const nameKey = nameClean.toLowerCase().replace(/[^a-z]/g, '');
                const dedupKey = `${nameKey}@${formattedDate}`;
                if (seenKeys.has(dedupKey)) return;
                seenKeys.add(dedupKey);

                const rawSsn = String(c.ssn_last_4 || '').replace(/\D/g, '');
                const ssnVal = rawSsn.length >= 4 ? rawSsn.slice(-4) : (rawSsn ? rawSsn.padStart(4, '0') : '');
                const pos = (c.position || 'CSR').trim();
                const totalHours = classHoursByDate[formattedDate] || "1.33";

                matchedRows.push({
                    location: (c.store_num || '').replace(/\D/g, ''),
                    last4Ssn: ssnVal,
                    position: pos,
                    totalHours: totalHours,
                    systemDate: formattedDate,
                    name: nameClean,
                    job: pos,
                    trainingType: "NTO Training"
                });
            });

            matchedRows.sort((a, b) => {
                const timeA = new Date(a.systemDate).getTime();
                const timeB = new Date(b.systemDate).getTime();
                if (timeA !== timeB) return timeA - timeB;
                const storeA = parseInt(a.location, 10) || 0;
                const storeB = parseInt(b.location, 10) || 0;
                if (storeA !== storeB) return storeA - storeB;
                return a.name.localeCompare(b.name);
            });

            return new Response(JSON.stringify({
                success: true,
                market: targetMarket,
                count: matchedRows.length,
                rows: matchedRows
            }), { status: 200, headers: corsHeaders() });
        }

        // 4. Email & NTO Automation Actions: Proxy to Google Apps Script Gmail microservice
        if (action === "sendEmail" || action === "sendNtoMeetLinks" || action === "sendWelcomeLetter" || action === "concludeNtoClass" || action === "resendBonnieNtoEmail" || action === "testNtoPayrollReport" || action === "sendNtoPayrollReport" || action === "setupNtoPayrollTrigger" || action === "disableNtoPayrollTrigger") {
            try {
                // If concluding NTO class, update trainee records and sync them into staffing_records in D1
                if (action === "concludeNtoClass") {
                    const roster = payload.roster || [];
                    if (Array.isArray(roster) && roster.length > 0) {
                        const concludeStatements = [];
                        const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
                        const nowFormatted = getNowFormatted(tz);

                        for (const item of roster) {
                            const attVal = (item.attendance || item.ntoAttendance || item.finalAttendance || '').trim();
                            let hiredVal = null;
                            let missedNtoVal = null;
                            if (attVal === "NTO Complete" || attVal === "Attended") {
                                hiredVal = 1;
                                missedNtoVal = 0;
                            } else if (attVal === "Not in NTO") {
                                hiredVal = 0;
                                missedNtoVal = 1;
                            }
                            const shirtVal = item.shirtSize || item.shirt || '';
                            const hatVal = item.hatStyle || item.hat || '';
                            const payCardVal = item.payCard || item.paycard || '';
                            const ssnVal = String(item.ssnLast4 || item.ssn || item.ssn_last_4 || '').trim();
                            const ntoCompVal = item.ntoCompletedAt || item.nto_completed_at || (attVal === "NTO Complete" ? nowFormatted : '');

                            if (item.id) {
                                concludeStatements.push(db.prepare(`
                                    UPDATE onboarding_candidates SET
                                        nto_attendance = COALESCE(NULLIF(?, ''), nto_attendance),
                                        hired = COALESCE(?, hired),
                                        missed_nto = COALESCE(?, missed_nto),
                                        shirt_size = CASE WHEN ? != '' THEN ? ELSE shirt_size END,
                                        hat_style = CASE WHEN ? != '' THEN ? ELSE hat_style END,
                                        pay_card = CASE WHEN ? != '' THEN ? ELSE pay_card END,
                                        ssn_last_4 = CASE WHEN ? != '' THEN ? ELSE ssn_last_4 END,
                                        nto_completed_at = CASE WHEN ? != '' THEN ? ELSE nto_completed_at END,
                                        last_updated = ?,
                                        updated_at = CURRENT_TIMESTAMP
                                    WHERE id = ?
                                `).bind(
                                    attVal,
                                    hiredVal,
                                    missedNtoVal,
                                    shirtVal, shirtVal,
                                    hatVal, hatVal,
                                    payCardVal, payCardVal,
                                    ssnVal, ssnVal,
                                    ntoCompVal, ntoCompVal,
                                    nowFormatted,
                                    item.id
                                ));
                            }
                        }
                        if (concludeStatements.length > 0) {
                            try {
                                await db.batch(concludeStatements);
                            } catch (dbErr) {
                                console.error("Failed to update roster on concludeNtoClass in D1:", dbErr);
                            }
                        }
                        await syncHiredCandidatesToStaffing(db, market);
                    }
                }

                // If resending Bonnie's email and SSNs are supplied in the roster, persist them to D1
                if (action === "resendBonnieNtoEmail") {
                    const roster = payload.roster || payload.customRoster || [];
                    if (Array.isArray(roster) && roster.length > 0) {
                        const ssnStatements = [];
                        for (const item of roster) {
                            const candId = item.id || item.candidateId;
                            const ssnVal = String(item.ssnLast4 || item.ssn || item.ssn_last_4 || "").trim();
                            if (candId && /^\d{4}$/.test(ssnVal)) {
                                ssnStatements.push(db.prepare(`
                                    UPDATE onboarding_candidates
                                    SET ssn_last_4 = ?,
                                        updated_at = CURRENT_TIMESTAMP
                                    WHERE id = ?
                                `).bind(ssnVal, candId));
                            }
                        }
                        if (ssnStatements.length > 0) {
                            try {
                                await db.batch(ssnStatements);
                            } catch (dbErr) {
                                console.error("Failed to update SSNs in D1:", dbErr);
                            }
                        }
                    }
                }
                let enrichedPayload = { ...payload };
                const storeNumTarget = String(payload.store || payload.storeNum || '').trim();
                if ((action === "sendEmail" || action === "sendWelcomeLetter") && storeNumTarget) {
                    try {
                        const cleanStore = storeNumTarget.replace(/\D/g, '');
                        const storeRecord = await db.prepare("SELECT * FROM stores WHERE store_number = ? OR store_number = ? LIMIT 1")
                            .bind(storeNumTarget, cleanStore)
                            .first();
                        if (storeRecord) {
                            if (!enrichedPayload.gmName && storeRecord.manager_name) enrichedPayload.gmName = storeRecord.manager_name;
                            if (!enrichedPayload.gmPhone && (storeRecord.gm_phone || storeRecord.do_cell)) enrichedPayload.gmPhone = storeRecord.gm_phone || storeRecord.do_cell;
                            if (!enrichedPayload.storePhone && storeRecord.store_phone) enrichedPayload.storePhone = storeRecord.store_phone;
                            if (!enrichedPayload.storeAddress && storeRecord.address) enrichedPayload.storeAddress = storeRecord.address;
                            if (!enrichedPayload.storeEmail && storeRecord.store_email) enrichedPayload.storeEmail = storeRecord.store_email;
                            if (!enrichedPayload.doEmail && storeRecord.do_email) enrichedPayload.doEmail = storeRecord.do_email;
                            if (!enrichedPayload.doName && storeRecord.do_name) enrichedPayload.doName = storeRecord.do_name;
                        }
                    } catch (storeLookupErr) {
                        console.warn("Failed to lookup store in D1 for sendEmail:", storeLookupErr);
                    }
                }

                if (action === "sendNtoMeetLinks") {
                    const isDen = (market || payload.market || '').toLowerCase() === "denver";
                    if (isDen) {
                        if (!enrichedPayload.meetLink) enrichedPayload.meetLink = "https://meet.google.com/haf-izyt-gws";
                        if (!enrichedPayload.trainerName) enrichedPayload.trainerName = "Richard Keske";
                    }
                    if (!enrichedPayload.classTime && enrichedPayload.classDate) {
                        try {
                            const cl = await db.prepare("SELECT start_time, trainer, meet_link FROM training_classes WHERE (class_date = ? OR REPLACE(class_date, ' ', '') = ?) AND (market = ? OR market = 'Virtual') AND is_active = 1 LIMIT 1")
                                .bind(enrichedPayload.classDate, enrichedPayload.classDate, market)
                                .first();
                            if (cl) {
                                if (!enrichedPayload.classTime && cl.start_time) enrichedPayload.classTime = formatTimeDisplay(cl.start_time);
                                if (!enrichedPayload.trainerName && cl.trainer) enrichedPayload.trainerName = cl.trainer;
                                if (!enrichedPayload.meetLink && cl.meet_link) enrichedPayload.meetLink = cl.meet_link;
                            }
                        } catch (clErr) {}
                    }
                }

                const gasJson = await callAppsScriptProxy({
                    ...enrichedPayload,
                    market: market,
                    city: market,
                    action: action
                }, context);
                return new Response(JSON.stringify(gasJson), { status: 200, headers: corsHeaders() });
            } catch (err) {
                return new Response(JSON.stringify({ error: `GAS proxy failed: ${err.message}` }), {
                    status: 502,
                    headers: corsHeaders()
                });
            }
        }

        // 1b. Live NTO Attendance Save
        if (action === "saveNtoAttendance") {
            const roster = payload.roster || [];
            const statements = [];
            const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = getNowFormatted(tz);

            for (const item of roster) {
                const attVal = item.attendance !== undefined ? item.attendance : (item.ntoAttendance !== undefined ? item.ntoAttendance : (item.ntoStatus || ''));
                let hiredVal = null;
                let missedNtoVal = null;
                if (attVal === "NTO Complete" || attVal === "Attended") {
                    hiredVal = 1;
                    missedNtoVal = 0;
                } else if (attVal === "Not in NTO") {
                    hiredVal = 0;
                    missedNtoVal = 1;
                } else if (!attVal) {
                    hiredVal = 0;
                    missedNtoVal = 0;
                }

                const shirtVal = item.shirtSize || item.shirt || '';
                const hatVal = item.hatStyle || item.hat || '';
                const payCardVal = item.payCard || item.paycard || '';
                const itemTime = item.lastUpdated || nowFormatted;

                const candName = (item.name || '').trim();
                if (item.id) {
                    statements.push(db.prepare(`
                        UPDATE onboarding_candidates SET
                            nto_attendance = ?,
                            hired = COALESCE(?, hired),
                            missed_nto = COALESCE(?, missed_nto),
                            shirt_size = CASE WHEN ? != '' THEN ? ELSE shirt_size END,
                            hat_style = CASE WHEN ? != '' THEN ? ELSE hat_style END,
                            pay_card = CASE WHEN ? != '' THEN ? ELSE pay_card END,
                            last_updated = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? OR (LOWER(TRIM(name)) = LOWER(?) AND ? != '' AND market = ?)
                    `).bind(
                        attVal,
                        hiredVal,
                        missedNtoVal,
                        shirtVal, shirtVal,
                        hatVal, hatVal,
                        payCardVal, payCardVal,
                        itemTime,
                        item.id,
                        candName, candName, market
                    ));
                } else if (item.email) {
                    statements.push(db.prepare(`
                        UPDATE onboarding_candidates SET
                            nto_attendance = ?,
                            hired = COALESCE(?, hired),
                            missed_nto = COALESCE(?, missed_nto),
                            shirt_size = CASE WHEN ? != '' THEN ? ELSE shirt_size END,
                            hat_style = CASE WHEN ? != '' THEN ? ELSE hat_style END,
                            pay_card = CASE WHEN ? != '' THEN ? ELSE pay_card END,
                            last_updated = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE LOWER(email) = LOWER(?) AND market = ?
                    `).bind(
                        attVal,
                        hiredVal,
                        missedNtoVal,
                        shirtVal, shirtVal,
                        hatVal, hatVal,
                        payCardVal, payCardVal,
                        itemTime,
                        item.email.trim(),
                        market
                    ));
                }
            }

            if (statements.length > 0) {
                await db.batch(statements);
            }

            // Ensure any trainees marked NTO Complete / Attended are synced to staffing_records
            await syncHiredCandidatesToStaffing(db, market);

            return new Response(JSON.stringify({ success: true, message: `Live attendance updated for ${roster.length} trainees!` }), {
                status: 200,
                headers: corsHeaders()
            });
        }

        // 2. Log GM Tracker usage
        if (action === "logUsage") {
            await db.prepare(`INSERT INTO usage_logs (store_num, do_name, action_view, device_type) VALUES (?, ?, ?, ?)`).bind(
                payload.storeNum || payload.store || '',
                payload.doName || '',
                payload.actionView || 'Store View',
                payload.deviceType || ''
            ).run();
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders() });
        }

        // 3. Save Scratchpad & Checklist
        if (action === "saveScratchpad") {
            const mode = payload.scratchpadMode || (payload.scratchpadText !== undefined ? "text" : "list");
            const content = payload.scratchpadContent !== undefined ? payload.scratchpadContent : (mode === "text" ? payload.scratchpadText : payload.scratchpadChecklist);

            if (mode === "text") {
                const textVal = (typeof content === "string") ? content : (payload.scratchpadText || "");
                await db.prepare(`
                    INSERT INTO scratchpad (market, scratchpad_text, checklist_json, updated_at)
                    VALUES (?, ?, '[]', CURRENT_TIMESTAMP)
                    ON CONFLICT(market) DO UPDATE SET
                        scratchpad_text = excluded.scratchpad_text,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(market, textVal).run();
            } else {
                let checklistJson = "[]";
                if (typeof content === "string") {
                    checklistJson = content;
                } else if (Array.isArray(content)) {
                    checklistJson = JSON.stringify(content);
                } else if (payload.scratchpadChecklist) {
                    checklistJson = typeof payload.scratchpadChecklist === "string" ? payload.scratchpadChecklist : JSON.stringify(payload.scratchpadChecklist);
                }
                await db.prepare(`
                    INSERT INTO scratchpad (market, scratchpad_text, checklist_json, updated_at)
                    VALUES (?, '', ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(market) DO UPDATE SET
                        checklist_json = excluded.checklist_json,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(market, checklistJson).run();
            }
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders() });
        }

        // 3b. Sync Hired Candidates from Onboarding to Staffing Records
        if (action === "syncHiredToStaffing") {
            const count = await syncHiredCandidatesToStaffing(db, market);
            return new Response(JSON.stringify({ success: true, syncedCount: count }), { status: 200, headers: corsHeaders() });
        }

        // 4. Handle ADD Operations (Interviews, Staffing, Onboarding)
        if (action === "add") {
            const target = payload.target || "onboarding";

            if (target === "interviews") {
                const newId = payload.id || `INT-ID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                let resolvedDoName = (payload.doName || '').trim();
                const targetStore = String(payload.store || payload.store_num || '').trim();
                if (!resolvedDoName && targetStore) {
                    const stRow = await db.prepare("SELECT do_name FROM stores WHERE market = ? AND store_number = ? LIMIT 1").bind(market, targetStore).first();
                    if (stRow && stRow.do_name) resolvedDoName = stRow.do_name.trim();
                }

                await db.prepare(`
                    INSERT INTO interviews (
                        id, market, store_num, do_name, name, position, phone_number, email,
                        interview_date, interview_day, interview_time, status, gm_date, gm_time,
                        status_updates, availability, notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `).bind(
                    newId,
                    market,
                    payload.store || payload.store_num || '',
                    resolvedDoName,
                    payload.name || '',
                    payload.position || '',
                    payload.phoneNumber || '',
                    payload.email || '',
                    payload.date || '',
                    payload.day || '',
                    payload.time || '',
                    payload.status || 'Scheduled',
                    payload.gmDate || '',
                    payload.gmTime || '',
                    payload.statusUpdates || '',
                    payload.availability || '',
                    payload.notes || ''
                ).run();

                return new Response(JSON.stringify({ success: true, id: newId }), { status: 200, headers: corsHeaders() });
            }

            if (target === "staffing") {
                const newId = payload.id || `STF-ID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                let resolvedDoName = (payload.doName || '').trim();
                const targetStore = String(payload.store || payload.store_num || '').trim();
                if (!resolvedDoName && targetStore) {
                    const stRow = await db.prepare("SELECT do_name FROM stores WHERE market = ? AND store_number = ? LIMIT 1").bind(market, targetStore).first();
                    if (stRow && stRow.do_name) resolvedDoName = stRow.do_name.trim();
                }

                await db.prepare(`
                    INSERT INTO staffing_records (
                        id, market, fiscal_year, period, store_num, do_name, gm_name, name, position,
                        hire_date, term_date, rehire_eligible, cause_of_action, reason_of_action, notes,
                        received_date, source_sheet, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `).bind(
                    newId,
                    market,
                    2026,
                    payload.period || '',
                    payload.store || payload.store_num || '',
                    resolvedDoName,
                    payload.gmName || '',
                    payload.name || '',
                    payload.position || '',
                    payload.hireDate || '',
                    payload.termDate || '',
                    payload.rehireEligible || 'Yes',
                    payload.causeOfAction || '',
                    payload.reasonOfAction || '',
                    payload.notes || '',
                    payload.receivedDate || '',
                    'Hiring Data (2026)'
                ).run();

                const savedStints = [];
                if (Array.isArray(payload.priorStints) && payload.priorStints.length > 0) {
                    for (let sIdx = 0; sIdx < payload.priorStints.length; sIdx++) {
                        const stint = payload.priorStints[sIdx];
                        const sStore = (stint.store || payload.store || payload.store_num || '').toString().trim();
                        const sHire = stint.hireDate || '';
                        const sTerm = stint.termDate || '';
                        const sRehire = stint.rehireEligible || 'Yes';
                        const sCause = stint.causeOfAction || '';
                        const sReason = stint.reasonOfAction || '';
                        const sNotes = stint.notes || '';
                        const sGm = stint.gmName || '';
                        const sPos = stint.position || payload.position || 'CSR';
                        const sRecDate = stint.receivedDate || sTerm || '';
                        const sPeriod = stint.period || payload.period || '';

                        if (stint.id) {
                            await db.prepare(`
                                UPDATE staffing_records SET
                                    store_num = COALESCE(?, store_num),
                                    hire_date = COALESCE(?, hire_date),
                                    term_date = COALESCE(?, term_date),
                                    position = COALESCE(?, position),
                                    rehire_eligible = COALESCE(?, rehire_eligible),
                                    cause_of_action = COALESCE(?, cause_of_action),
                                    reason_of_action = COALESCE(?, reason_of_action),
                                    notes = COALESCE(?, notes),
                                    gm_name = COALESCE(?, gm_name),
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE id = ?
                            `).bind(
                                sStore || null,
                                sHire || null,
                                sTerm || null,
                                sPos || null,
                                sRehire || null,
                                sCause || null,
                                sReason || null,
                                sNotes || null,
                                sGm || null,
                                stint.id
                            ).run();
                            savedStints.push({ ...stint, id: stint.id });
                        } else if (sHire || sTerm || sNotes) {
                            const newStintId = `STF-ID-${Date.now() + sIdx + 1}-${Math.floor(Math.random() * 1000)}`;
                            await db.prepare(`
                                INSERT INTO staffing_records (
                                    id, market, fiscal_year, period, store_num, do_name, gm_name, name, position,
                                    hire_date, term_date, rehire_eligible, cause_of_action, reason_of_action, notes,
                                    received_date, source_sheet, updated_at
                                ) VALUES (?, ?, 2026, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Staffing Prior Stint', CURRENT_TIMESTAMP)
                            `).bind(
                                newStintId,
                                market,
                                sPeriod,
                                sStore,
                                payload.doName || '',
                                sGm,
                                payload.name || '',
                                sPos,
                                sHire,
                                sTerm,
                                sRehire,
                                sCause,
                                sReason,
                                sNotes,
                                sRecDate
                            ).run();
                            savedStints.push({
                                ...stint,
                                id: newStintId,
                                store: sStore,
                                hireDate: sHire,
                                termDate: sTerm,
                                position: sPos,
                                rehireEligible: sRehire,
                                causeOfAction: sCause,
                                reasonOfAction: sReason,
                                notes: sNotes,
                                gmName: sGm,
                                name: payload.name
                            });
                        }
                    }
                }

                return new Response(JSON.stringify({ success: true, id: newId, savedStints: savedStints }), { status: 200, headers: corsHeaders() });
            }

            // Default target: Onboarding candidate
            const cand = payload.candidate || payload.record || payload;
            const newId = cand.id || `ID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const boolToInt = v => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
            const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = cand.lastUpdated || getNowFormatted(tz);

            let resolvedDoName = (cand.doName || '').trim();
            const targetStore = String(cand.store || cand.store_num || '').trim();
            if (!resolvedDoName && targetStore) {
                const stRow = await db.prepare("SELECT do_name FROM stores WHERE market = ? AND store_number = ? LIMIT 1").bind(market, targetStore).first();
                if (stRow && stRow.do_name) resolvedDoName = stRow.do_name.trim();
            }

            await db.prepare(`
                INSERT INTO onboarding_candidates (
                    id, market, name, position, store_num, do_name, nto_date, nto_attendance, notes,
                    shirt_size, hat_style, pay_card, phone_number, email, submission_received, onboarding_sent,
                    bgc_complete, allpay_completed, allpay_error, nto_signup_link_sent, nto_scheduled,
                    hired, incorrect_email, ineligible, inactive, missing_docs, pulse_form_complete,
                    missed_nto, card_received, registered, dd_received, dd_entered, notice_sent_date,
                    withdrawn, last_updated, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).bind(
                newId,
                market,
                cand.name || '',
                cand.position || '',
                cand.store || cand.store_num || '',
                resolvedDoName,
                cand.ntoDate || '',
                cand.ntoAttendance || '',
                cand.notes || '',
                cand.shirtSize || '',
                cand.hatStyle || '',
                cand.payCard || '',
                cand.phoneNumber || '',
                cand.email || '',
                boolToInt(cand.submissionReceived),
                boolToInt(cand.onboardingSent),
                boolToInt(cand.bgcComplete),
                boolToInt(cand.allPayCompleted),
                cand.allPayError || cand.allPayErrorText || '',
                boolToInt(cand.ntoSignupLinkSent),
                boolToInt(cand.ntoScheduled),
                boolToInt(cand.hired),
                boolToInt(cand.incorrectEmail),
                boolToInt(cand.ineligible),
                boolToInt(cand.inactive),
                cand.missingDocs || cand.missingDocsText || '',
                boolToInt(cand.pulseFormComplete),
                boolToInt(cand.missedNto),
                boolToInt(cand.cardReceived),
                boolToInt(cand.registered),
                boolToInt(cand.ddReceived),
                boolToInt(cand.ddEntered),
                cand.noticeSentDate || '',
                boolToInt(cand.withdrawn),
                nowFormatted
            ).run();

            if (cand.hired || (cand.ntoAttendance && (cand.ntoAttendance === "NTO Complete" || cand.ntoAttendance === "Attended"))) {
                await syncHiredCandidatesToStaffing(db, market);
            }

            return new Response(JSON.stringify({ success: true, id: newId }), { status: 200, headers: corsHeaders() });
        }

        // 5. Handle UPDATE Operations (Interviews, Staffing, Onboarding)
        if (action === "updateCandidate" || action === "update") {
            const target = payload.target || "onboarding";

            if (target === "interviews") {
                if (!payload.id) {
                    return new Response(JSON.stringify({ error: "Missing interview ID" }), { status: 400, headers: corsHeaders() });
                }

                let updateDoName = payload.doName !== undefined && payload.doName !== '' ? String(payload.doName).trim() : null;
                const updateStore = payload.store !== undefined ? payload.store : (payload.store_num !== undefined ? payload.store_num : null);
                if (!updateDoName && updateStore) {
                    const stRow = await db.prepare("SELECT do_name FROM stores WHERE market = ? AND store_number = ? LIMIT 1").bind(market, String(updateStore).trim()).first();
                    if (stRow && stRow.do_name) updateDoName = stRow.do_name.trim();
                }

                await db.prepare(`
                    UPDATE interviews SET
                        store_num = COALESCE(?, store_num),
                        do_name = COALESCE(?, do_name),
                        name = COALESCE(?, name),
                        position = COALESCE(?, position),
                        phone_number = COALESCE(?, phone_number),
                        email = COALESCE(?, email),
                        interview_date = COALESCE(?, interview_date),
                        interview_day = COALESCE(?, interview_day),
                        interview_time = COALESCE(?, interview_time),
                        status = COALESCE(?, status),
                        gm_date = COALESCE(?, gm_date),
                        gm_time = COALESCE(?, gm_time),
                        status_updates = COALESCE(?, status_updates),
                        availability = COALESCE(?, availability),
                        notes = COALESCE(?, notes),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    payload.store !== undefined ? payload.store : (payload.store_num !== undefined ? payload.store_num : null),
                    updateDoName,
                    payload.name !== undefined ? payload.name : null,
                    payload.position !== undefined ? payload.position : null,
                    payload.phoneNumber !== undefined ? payload.phoneNumber : null,
                    payload.email !== undefined ? payload.email : null,
                    payload.date !== undefined ? payload.date : null,
                    payload.day !== undefined ? payload.day : null,
                    payload.time !== undefined ? payload.time : null,
                    payload.status !== undefined ? payload.status : null,
                    payload.gmDate !== undefined ? payload.gmDate : null,
                    payload.gmTime !== undefined ? payload.gmTime : null,
                    payload.statusUpdates !== undefined ? payload.statusUpdates : null,
                    payload.availability !== undefined ? payload.availability : null,
                    payload.notes !== undefined ? payload.notes : null,
                    payload.id
                ).run();

                return new Response(JSON.stringify({ success: true, id: payload.id }), { status: 200, headers: corsHeaders() });
            }

            if (target === "staffing") {
                if (!payload.id) {
                    return new Response(JSON.stringify({ error: "Missing staffing record ID" }), { status: 400, headers: corsHeaders() });
                }

                let updateDoName = payload.doName !== undefined && payload.doName !== '' ? String(payload.doName).trim() : null;
                const updateStore = payload.store !== undefined ? payload.store : (payload.store_num !== undefined ? payload.store_num : null);
                if (!updateDoName && updateStore) {
                    const stRow = await db.prepare("SELECT do_name FROM stores WHERE market = ? AND store_number = ? LIMIT 1").bind(market, String(updateStore).trim()).first();
                    if (stRow && stRow.do_name) updateDoName = stRow.do_name.trim();
                }

                await db.prepare(`
                    UPDATE staffing_records SET
                        store_num = COALESCE(?, store_num),
                        do_name = COALESCE(?, do_name),
                        gm_name = COALESCE(?, gm_name),
                        name = COALESCE(?, name),
                        position = COALESCE(?, position),
                        period = COALESCE(?, period),
                        hire_date = COALESCE(?, hire_date),
                        term_date = COALESCE(?, term_date),
                        rehire_eligible = COALESCE(?, rehire_eligible),
                        cause_of_action = COALESCE(?, cause_of_action),
                        reason_of_action = COALESCE(?, reason_of_action),
                        notes = COALESCE(?, notes),
                        received_date = COALESCE(?, received_date),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    payload.store !== undefined ? payload.store : (payload.store_num !== undefined ? payload.store_num : null),
                    updateDoName,
                    payload.gmName !== undefined ? payload.gmName : null,
                    payload.name !== undefined ? payload.name : null,
                    payload.position !== undefined ? payload.position : null,
                    payload.period !== undefined ? payload.period : null,
                    payload.hireDate !== undefined ? payload.hireDate : null,
                    payload.termDate !== undefined ? payload.termDate : null,
                    payload.rehireEligible !== undefined ? payload.rehireEligible : null,
                    payload.causeOfAction !== undefined ? payload.causeOfAction : null,
                    payload.reasonOfAction !== undefined ? payload.reasonOfAction : null,
                    payload.notes !== undefined ? payload.notes : null,
                    payload.receivedDate !== undefined ? payload.receivedDate : null,
                    payload.id
                ).run();

                const savedStints = [];
                if (Array.isArray(payload.priorStints) && payload.priorStints.length > 0) {
                    for (let sIdx = 0; sIdx < payload.priorStints.length; sIdx++) {
                        const stint = payload.priorStints[sIdx];
                        const sStore = (stint.store || payload.store || payload.store_num || '').toString().trim();
                        const sHire = stint.hireDate || '';
                        const sTerm = stint.termDate || '';
                        const sRehire = stint.rehireEligible || 'Yes';
                        const sCause = stint.causeOfAction || '';
                        const sReason = stint.reasonOfAction || '';
                        const sNotes = stint.notes || '';
                        const sGm = stint.gmName || '';
                        const sPos = stint.position || payload.position || 'CSR';
                        const sRecDate = stint.receivedDate || sTerm || '';
                        const sPeriod = stint.period || payload.period || '';

                        if (stint.id) {
                            await db.prepare(`
                                UPDATE staffing_records SET
                                    store_num = COALESCE(?, store_num),
                                    hire_date = COALESCE(?, hire_date),
                                    term_date = COALESCE(?, term_date),
                                    position = COALESCE(?, position),
                                    rehire_eligible = COALESCE(?, rehire_eligible),
                                    cause_of_action = COALESCE(?, cause_of_action),
                                    reason_of_action = COALESCE(?, reason_of_action),
                                    notes = COALESCE(?, notes),
                                    gm_name = COALESCE(?, gm_name),
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE id = ?
                            `).bind(
                                sStore || null,
                                sHire || null,
                                sTerm || null,
                                sPos || null,
                                sRehire || null,
                                sCause || null,
                                sReason || null,
                                sNotes || null,
                                sGm || null,
                                stint.id
                            ).run();
                            savedStints.push({ ...stint, id: stint.id });
                        } else if (sHire || sTerm || sNotes) {
                            const newStintId = `STF-ID-${Date.now() + sIdx + 1}-${Math.floor(Math.random() * 1000)}`;
                            await db.prepare(`
                                INSERT INTO staffing_records (
                                    id, market, fiscal_year, period, store_num, do_name, gm_name, name, position,
                                    hire_date, term_date, rehire_eligible, cause_of_action, reason_of_action, notes,
                                    received_date, source_sheet, updated_at
                                ) VALUES (?, ?, 2026, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Staffing Prior Stint', CURRENT_TIMESTAMP)
                            `).bind(
                                newStintId,
                                market,
                                sPeriod,
                                sStore,
                                payload.doName || '',
                                sGm,
                                payload.name || '',
                                sPos,
                                sHire,
                                sTerm,
                                sRehire,
                                sCause,
                                sReason,
                                sNotes,
                                sRecDate
                            ).run();
                            savedStints.push({
                                ...stint,
                                id: newStintId,
                                store: sStore,
                                hireDate: sHire,
                                termDate: sTerm,
                                position: sPos,
                                rehireEligible: sRehire,
                                causeOfAction: sCause,
                                reasonOfAction: sReason,
                                notes: sNotes,
                                gmName: sGm,
                                name: payload.name
                            });
                        }
                    }
                }

                return new Response(JSON.stringify({ success: true, id: payload.id, savedStints: savedStints }), { status: 200, headers: corsHeaders() });
            }

            // Default target: Onboarding candidate
            const cand = payload.candidate || payload.record || payload;
            if (!cand || !cand.id) {
                return new Response(JSON.stringify({ error: "Missing candidate ID" }), { status: 400, headers: corsHeaders() });
            }

            const boolToInt = v => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
            const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = cand.lastUpdated || getNowFormatted(tz);

            let updateDoName = cand.doName !== undefined && cand.doName !== '' ? String(cand.doName).trim() : null;
            const updateStore = cand.store !== undefined ? cand.store : (cand.store_num !== undefined ? cand.store_num : null);
            if (!updateDoName && updateStore) {
                const stRow = await db.prepare("SELECT do_name FROM stores WHERE market = ? AND store_number = ? LIMIT 1").bind(market, String(updateStore).trim()).first();
                if (stRow && stRow.do_name) updateDoName = stRow.do_name.trim();
            }

            await db.prepare(`
                UPDATE onboarding_candidates SET
                    name = COALESCE(NULLIF(?, ''), name),
                    position = COALESCE(NULLIF(?, ''), position),
                    store_num = COALESCE(NULLIF(?, ''), store_num),
                    do_name = COALESCE(NULLIF(?, ''), do_name),
                    nto_date = COALESCE(NULLIF(?, ''), nto_date),
                    nto_attendance = COALESCE(NULLIF(?, ''), nto_attendance),
                    notes = COALESCE(?, notes),
                    shirt_size = COALESCE(?, shirt_size),
                    hat_style = COALESCE(?, hat_style),
                    pay_card = COALESCE(?, pay_card),
                    phone_number = COALESCE(NULLIF(?, ''), phone_number),
                    email = COALESCE(NULLIF(?, ''), email),
                    submission_received = COALESCE(?, submission_received),
                    onboarding_sent = COALESCE(?, onboarding_sent),
                    bgc_complete = COALESCE(?, bgc_complete),
                    allpay_completed = COALESCE(?, allpay_completed),
                    allpay_error = COALESCE(?, allpay_error),
                    nto_signup_link_sent = COALESCE(?, nto_signup_link_sent),
                    nto_scheduled = COALESCE(?, nto_scheduled),
                    hired = COALESCE(?, hired),
                    incorrect_email = COALESCE(?, incorrect_email),
                    ineligible = COALESCE(?, ineligible),
                    inactive = COALESCE(?, inactive),
                    missing_docs = COALESCE(?, missing_docs),
                    pulse_form_complete = COALESCE(?, pulse_form_complete),
                    missed_nto = COALESCE(?, missed_nto),
                    card_received = COALESCE(?, card_received),
                    registered = COALESCE(?, registered),
                    dd_received = COALESCE(?, dd_received),
                    dd_entered = COALESCE(?, dd_entered),
                    notice_sent_date = COALESCE(?, notice_sent_date),
                    withdrawn = COALESCE(?, withdrawn),
                    last_updated = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(
                cand.name !== undefined ? cand.name : null,
                cand.position !== undefined ? cand.position : null,
                cand.store !== undefined ? cand.store : (cand.store_num !== undefined ? cand.store_num : null),
                updateDoName,
                cand.ntoDate !== undefined ? cand.ntoDate : null,
                cand.ntoAttendance !== undefined ? cand.ntoAttendance : null,
                cand.notes !== undefined ? cand.notes : null,
                cand.shirtSize !== undefined ? cand.shirtSize : null,
                cand.hatStyle !== undefined ? cand.hatStyle : null,
                cand.payCard !== undefined ? cand.payCard : null,
                cand.phoneNumber !== undefined ? cand.phoneNumber : null,
                cand.email !== undefined ? cand.email : null,
                cand.submissionReceived !== undefined ? boolToInt(cand.submissionReceived) : null,
                cand.onboardingSent !== undefined ? boolToInt(cand.onboardingSent) : null,
                cand.bgcComplete !== undefined ? boolToInt(cand.bgcComplete) : null,
                cand.allPayCompleted !== undefined ? boolToInt(cand.allPayCompleted) : null,
                cand.allPayError !== undefined ? cand.allPayError : (cand.allPayErrorText !== undefined ? cand.allPayErrorText : (cand.allpay_error !== undefined ? cand.allpay_error : null)),
                cand.ntoSignupLinkSent !== undefined ? boolToInt(cand.ntoSignupLinkSent) : null,
                cand.ntoScheduled !== undefined ? boolToInt(cand.ntoScheduled) : null,
                cand.hired !== undefined ? boolToInt(cand.hired) : null,
                cand.incorrectEmail !== undefined ? boolToInt(cand.incorrectEmail) : null,
                cand.ineligible !== undefined ? boolToInt(cand.ineligible) : null,
                cand.inactive !== undefined ? boolToInt(cand.inactive) : null,
                cand.missingDocs !== undefined ? cand.missingDocs : (cand.missingDocsText !== undefined ? cand.missingDocsText : (cand.missing_docs !== undefined ? cand.missing_docs : null)),
                cand.pulseFormComplete !== undefined ? boolToInt(cand.pulseFormComplete) : null,
                cand.missedNto !== undefined ? boolToInt(cand.missedNto) : null,
                cand.cardReceived !== undefined ? boolToInt(cand.cardReceived) : null,
                cand.registered !== undefined ? boolToInt(cand.registered) : null,
                cand.ddReceived !== undefined ? boolToInt(cand.ddReceived) : null,
                cand.ddEntered !== undefined ? boolToInt(cand.ddEntered) : null,
                cand.noticeSentDate !== undefined ? cand.noticeSentDate : null,
                cand.withdrawn !== undefined ? boolToInt(cand.withdrawn) : null,
                nowFormatted,
                cand.id
            ).run();

            if (cand.hired || (cand.ntoAttendance && (cand.ntoAttendance === "NTO Complete" || cand.ntoAttendance === "Attended"))) {
                await syncHiredCandidatesToStaffing(db, market);
            }

            return new Response(JSON.stringify({ success: true, id: cand.id }), { status: 200, headers: corsHeaders() });
        }

        // 5. Batch Update (atomic D1 batch)
        if (action === "batchUpdate") {
            const updates = payload.updates || [];
            if (!Array.isArray(updates) || updates.length === 0) {
                return new Response(JSON.stringify({ success: true, count: 0 }), { status: 200, headers: corsHeaders() });
            }

            const statements = [];
            const boolToInt = v => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
            const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = getNowFormatted(tz);

            for (const item of updates) {
                if (!item.id) continue;
                statements.push(db.prepare(`
                    UPDATE onboarding_candidates SET
                        name = COALESCE(NULLIF(?, ''), name),
                        phone_number = COALESCE(NULLIF(?, ''), phone_number),
                        email = COALESCE(NULLIF(?, ''), email),
                        store_num = COALESCE(NULLIF(?, ''), store_num),
                        position = COALESCE(NULLIF(?, ''), position),
                        shirt_size = COALESCE(?, shirt_size),
                        hat_style = COALESCE(?, hat_style),
                        pay_card = COALESCE(?, pay_card),
                        submission_received = COALESCE(?, submission_received),
                        onboarding_sent = COALESCE(?, onboarding_sent),
                        bgc_complete = COALESCE(?, bgc_complete),
                        allpay_completed = COALESCE(?, allpay_completed),
                        allpay_error = COALESCE(?, allpay_error),
                        nto_signup_link_sent = COALESCE(?, nto_signup_link_sent),
                        nto_scheduled = COALESCE(?, nto_scheduled),
                        hired = COALESCE(?, hired),
                        inactive = COALESCE(?, inactive),
                        ineligible = COALESCE(?, ineligible),
                        withdrawn = COALESCE(?, withdrawn),
                        missing_docs = COALESCE(?, missing_docs),
                        pulse_form_complete = COALESCE(?, pulse_form_complete),
                        notes = COALESCE(?, notes),
                        nto_date = COALESCE(NULLIF(?, ''), nto_date),
                        nto_attendance = COALESCE(NULLIF(?, ''), nto_attendance),
                        last_updated = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    item.name !== undefined ? item.name : null,
                    item.phoneNumber !== undefined ? item.phoneNumber : (item.phone !== undefined ? item.phone : null),
                    item.email !== undefined ? item.email : null,
                    item.store !== undefined ? item.store : (item.store_num !== undefined ? item.store_num : null),
                    item.position !== undefined ? item.position : null,
                    item.shirtSize !== undefined ? item.shirtSize : null,
                    item.hatStyle !== undefined ? item.hatStyle : null,
                    item.payCard !== undefined ? item.payCard : null,
                    item.submissionReceived !== undefined ? boolToInt(item.submissionReceived) : null,
                    item.onboardingSent !== undefined ? boolToInt(item.onboardingSent) : null,
                    item.bgcComplete !== undefined ? boolToInt(item.bgcComplete) : null,
                    item.allPayCompleted !== undefined ? boolToInt(item.allPayCompleted) : null,
                    item.allPayError !== undefined ? item.allPayError : null,
                    item.ntoSignupLinkSent !== undefined ? boolToInt(item.ntoSignupLinkSent) : null,
                    item.ntoScheduled !== undefined ? boolToInt(item.ntoScheduled) : null,
                    item.hired !== undefined ? boolToInt(item.hired) : null,
                    item.inactive !== undefined ? boolToInt(item.inactive) : null,
                    item.ineligible !== undefined ? boolToInt(item.ineligible) : null,
                    item.withdrawn !== undefined ? boolToInt(item.withdrawn) : null,
                    item.missingDocs !== undefined ? item.missingDocs : null,
                    item.pulseFormComplete !== undefined ? boolToInt(item.pulseFormComplete) : null,
                    item.notes !== undefined ? item.notes : null,
                    item.ntoDate !== undefined ? item.ntoDate : null,
                    item.ntoAttendance !== undefined ? item.ntoAttendance : null,
                    item.lastUpdated || nowFormatted,
                    item.id
                ));
            }

            if (statements.length > 0) {
                await db.batch(statements);
                await syncHiredCandidatesToStaffing(db, market);
            }

            return new Response(JSON.stringify({ success: true, count: statements.length }), { status: 200, headers: corsHeaders() });
        }

        // 6. Delete Record
        if (action === "delete") {
            const id = payload.id;
            const target = payload.target || "onboarding";
            if (!id) {
                return new Response(JSON.stringify({ error: "Missing ID to delete" }), { status: 400, headers: corsHeaders() });
            }

            if (target === "onboarding") {
                await db.prepare("DELETE FROM onboarding_candidates WHERE id = ?").bind(id).run();
            } else if (target === "staffing") {
                await db.prepare("DELETE FROM staffing_records WHERE id = ?").bind(id).run();
            } else if (target === "interviews") {
                await db.prepare("DELETE FROM interviews WHERE id = ?").bind(id).run();
            } else if (target === "paycards") {
                const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
                const nowFormatted = getNowFormatted(tz);
                const candName = (payload.name || '').trim();
                if (candName) {
                    await db.prepare(`
                        UPDATE onboarding_candidates SET
                            pay_card = '',
                            card_received = 0,
                            registered = 0,
                            dd_received = 0,
                            dd_entered = 0,
                            notice_sent_date = '',
                            last_updated = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? OR LOWER(TRIM(name)) = LOWER(?)
                    `).bind(nowFormatted, id, candName).run();
                } else {
                    await db.prepare(`
                        UPDATE onboarding_candidates SET
                            pay_card = '',
                            card_received = 0,
                            registered = 0,
                            dd_received = 0,
                            dd_entered = 0,
                            notice_sent_date = '',
                            last_updated = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).bind(nowFormatted, id).run();
                }
            }

            return new Response(JSON.stringify({ success: true, deletedId: id }), { status: 200, headers: corsHeaders() });
        }

        // 7. Update Store Contact
        if (action === "updateContact") {
            const c = payload.contact || payload;
            if (!c.storeNumber && !c.store) {
                return new Response(JSON.stringify({ error: "Missing store number" }), { status: 400, headers: corsHeaders() });
            }
            const storeNum = c.storeNumber || c.store;

            await db.prepare(`
                UPDATE stores SET
                    address = COALESCE(?, address),
                    store_phone = COALESCE(?, store_phone),
                    manager_name = COALESCE(?, manager_name),
                    gm_phone = COALESCE(?, gm_phone),
                    store_email = COALESCE(?, store_email),
                    do_name = COALESCE(?, do_name),
                    do_email = COALESCE(?, do_email),
                    do_cell = COALESCE(?, do_cell),
                    ip_address = COALESCE(?, ip_address),
                    csr_start = COALESCE(?, csr_start),
                    csr_mid = COALESCE(?, csr_mid),
                    csr_top = COALESCE(?, csr_top),
                    de_base = COALESCE(?, de_base),
                    de_otr = COALESCE(?, de_otr),
                    de_closer_base = COALESCE(?, de_closer_base),
                    de_closer_otr = COALESCE(?, de_closer_otr),
                    updated_at = CURRENT_TIMESTAMP
                WHERE store_number = ?
            `).bind(
                c.address !== undefined ? c.address : null,
                c.storePhone !== undefined ? c.storePhone : null,
                c.manager !== undefined ? c.manager : null,
                c.gmPhone !== undefined ? c.gmPhone : null,
                c.storeEmail !== undefined ? c.storeEmail : null,
                c.doName !== undefined ? c.doName : null,
                c.doEmail !== undefined ? c.doEmail : null,
                c.doCell !== undefined ? c.doCell : null,
                c.ipAddress !== undefined ? c.ipAddress : null,
                c.csrStart !== undefined ? c.csrStart : null,
                c.csrMid !== undefined ? c.csrMid : null,
                c.csrTop !== undefined ? c.csrTop : null,
                c.deBase !== undefined ? c.deBase : null,
                c.deOtr !== undefined ? c.deOtr : null,
                c.deCloserBase !== undefined ? c.deCloserBase : null,
                c.deCloserOtr !== undefined ? c.deCloserOtr : null,
                storeNum
            ).run();

            return new Response(JSON.stringify({ success: true, store: storeNum }), { status: 200, headers: corsHeaders() });
        }

        // 8. Save / Sync Admin Contacts
        if (action === "saveAdminContacts" || action === "syncAdminContacts") {
            const list = payload.contacts || payload.adminContacts || [];
            if (Array.isArray(list)) {
                try {
                    await db.prepare("ALTER TABLE admin_contacts ADD COLUMN category TEXT DEFAULT ''").run();
                } catch (e) {}
                try {
                    await db.prepare("ALTER TABLE admin_contacts ADD COLUMN title TEXT DEFAULT ''").run();
                } catch (e) {}
                try {
                    await db.prepare("ALTER TABLE admin_contacts ADD COLUMN notes TEXT DEFAULT ''").run();
                } catch (e) {}

                if (payload.replace !== false) {
                    await db.prepare("DELETE FROM admin_contacts WHERE market = ?").bind(market).run();
                }

                for (const ac of list) {
                    await db.prepare(`
                        INSERT INTO admin_contacts (market, role, name, email, phone, category, title, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).bind(
                        market,
                        ac.role || ac.title || 'Admin',
                        ac.name || '',
                        ac.email || '',
                        ac.phone || '',
                        ac.category || '',
                        ac.title || ac.role || '',
                        ac.notes || ''
                    ).run();
                }

                return new Response(JSON.stringify({ success: true, count: list.length }), { status: 200, headers: corsHeaders() });
            }
            return new Response(JSON.stringify({ error: "Invalid contacts list" }), { status: 400, headers: corsHeaders() });
        }

        // 9. Update Trainer / Manager Access Permissions (and ID/Profile Changes)
        if (action === "updateTrainerAccess") {
            const originalId = String(payload.originalTrainerId || payload.trainerId || payload.trainer_id || "").trim();
            const newTrainerId = String(payload.newTrainerId || payload.trainer_id || payload.trainerId || "").trim();
            if (!originalId) {
                return new Response(JSON.stringify({ success: false, error: "Missing trainerId" }), { status: 400, headers: corsHeaders() });
            }

            // If ID is being changed, verify the new ID isn't already taken by another account
            if (newTrainerId && newTrainerId.toLowerCase() !== originalId.toLowerCase()) {
                const existingWithNewId = await db.prepare("SELECT trainer_id, trainer_name FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(newTrainerId).first();
                if (existingWithNewId) {
                    return new Response(JSON.stringify({ 
                        success: false, 
                        error: `The ID '${newTrainerId}' is already claimed by ${existingWithNewId.trainer_name}. Please choose a unique ID.` 
                    }), { status: 409, headers: corsHeaders() });
                }
            }

            // CANONICAL TEAM WOW ROSTER (Dallas: 29 stores, Denver: 40 stores, El Paso: 12 stores, LA: 9 stores)
            const CANONICAL_TEAM_WOW_STORES = {
                // Dallas
                '6579': { market: 'Dallas', do_name: 'Bobby' },
                '6814': { market: 'Dallas', do_name: 'Bobby' },
                '6910': { market: 'Dallas', do_name: 'Kevin' },
                '6974': { market: 'Dallas', do_name: 'Kevin' },
                '6977': { market: 'Dallas', do_name: 'Kevin' },
                '6984': { market: 'Dallas', do_name: 'Kevin' },
                '8071': { market: 'Dallas', do_name: 'Kevin' },
                '6386': { market: 'Dallas', do_name: 'Paul' },
                '6806': { market: 'Dallas', do_name: 'Paul' },
                '6876': { market: 'Dallas', do_name: 'Paul' },
                '6923': { market: 'Dallas', do_name: 'Paul' },
                '6928': { market: 'Dallas', do_name: 'Paul' },
                '6987': { market: 'Dallas', do_name: 'Paul' },
                '8791': { market: 'Dallas', do_name: 'Paul' },
                '9290': { market: 'Dallas', do_name: 'Paul' },
                '6816': { market: 'Dallas', do_name: 'Stephanie' },
                '6819': { market: 'Dallas', do_name: 'Stephanie' },
                '6988': { market: 'Dallas', do_name: 'Stephanie' },
                '8068': { market: 'Dallas', do_name: 'Stephanie' },
                '8078': { market: 'Dallas', do_name: 'Stephanie' },
                '8149': { market: 'Dallas', do_name: 'Stephanie' },
                '6836': { market: 'Dallas', do_name: 'Vicente' },
                '6900': { market: 'Dallas', do_name: 'Vicente' },
                '6913': { market: 'Dallas', do_name: 'Vicente' },
                '6916': { market: 'Dallas', do_name: 'Vicente' },
                '6917': { market: 'Dallas', do_name: 'Vicente' },
                '6994': { market: 'Dallas', do_name: 'Vicente' },
                '8023': { market: 'Dallas', do_name: 'Vicente' },
                '9442': { market: 'Dallas', do_name: 'Vicente' },
                // Denver
                '6200': { market: 'Denver', do_name: 'Aaron' },
                '6201': { market: 'Denver', do_name: 'Aaron' },
                '6206': { market: 'Denver', do_name: 'Aaron' },
                '6209': { market: 'Denver', do_name: 'Aaron' },
                '6243': { market: 'Denver', do_name: 'Aaron' },
                '6248': { market: 'Denver', do_name: 'Aaron' },
                '6354': { market: 'Denver', do_name: 'Aaron' },
                '6195': { market: 'Denver', do_name: 'Jake' },
                '6239': { market: 'Denver', do_name: 'Jake' },
                '6240': { market: 'Denver', do_name: 'Jake' },
                '6349': { market: 'Denver', do_name: 'Jake' },
                '6357': { market: 'Denver', do_name: 'Jake' },
                '8667': { market: 'Denver', do_name: 'Jake' },
                '6210': { market: 'Denver', do_name: 'Jeff' },
                '6227': { market: 'Denver', do_name: 'Jeff' },
                '6233': { market: 'Denver', do_name: 'Jeff' },
                '6268': { market: 'Denver', do_name: 'Jeff' },
                '6292': { market: 'Denver', do_name: 'Jeff' },
                '6356': { market: 'Denver', do_name: 'Jeff' },
                '6367': { market: 'Denver', do_name: 'Jeff' },
                '8655': { market: 'Denver', do_name: 'Jeff' },
                '6208': { market: 'Denver', do_name: 'Jeremy' },
                '6228': { market: 'Denver', do_name: 'Jeremy' },
                '6245': { market: 'Denver', do_name: 'Jeremy' },
                '6281': { market: 'Denver', do_name: 'Jeremy' },
                '6297': { market: 'Denver', do_name: 'Jeremy' },
                '6342': { market: 'Denver', do_name: 'Jeremy' },
                '8661': { market: 'Denver', do_name: 'Jeremy' },
                '6231': { market: 'Denver', do_name: 'Nick' },
                '6232': { market: 'Denver', do_name: 'Nick' },
                '6241': { market: 'Denver', do_name: 'Nick' },
                '6242': { market: 'Denver', do_name: 'Nick' },
                '6247': { market: 'Denver', do_name: 'Nick' },
                '6286': { market: 'Denver', do_name: 'Nick' },
                '6371': { market: 'Denver', do_name: 'Nick' },
                '6202': { market: 'Denver', do_name: 'Nolan' },
                '6204': { market: 'Denver', do_name: 'Nolan' },
                '6207': { market: 'Denver', do_name: 'Nolan' },
                '6236': { market: 'Denver', do_name: 'Nolan' },
                '6299': { market: 'Denver', do_name: 'Nolan' },
                // El Paso
                '6880': { market: 'El Paso', do_name: 'Claudia' },
                '6884': { market: 'El Paso', do_name: 'Claudia' },
                '6886': { market: 'El Paso', do_name: 'Claudia' },
                '6887': { market: 'El Paso', do_name: 'Claudia' },
                '6888': { market: 'El Paso', do_name: 'Claudia' },
                '6889': { market: 'El Paso', do_name: 'Claudia' },
                '6890': { market: 'El Paso', do_name: 'Claudia' },
                '6892': { market: 'El Paso', do_name: 'Claudia' },
                '9240': { market: 'El Paso', do_name: 'Claudia' },
                '9247': { market: 'El Paso', do_name: 'Claudia' },
                '9342': { market: 'El Paso', do_name: 'Claudia' },
                '9343': { market: 'El Paso', do_name: 'Claudia' },
                // LA
                '7809': { market: 'LA', do_name: 'Victor' },
                '8109': { market: 'LA', do_name: 'Victor' },
                '8112': { market: 'LA', do_name: 'Victor' },
                '8129': { market: 'LA', do_name: 'Victor' },
                '8227': { market: 'LA', do_name: 'Victor' },
                '8282': { market: 'LA', do_name: 'Victor' },
                '8303': { market: 'LA', do_name: 'Victor' },
                '8370': { market: 'LA', do_name: 'Victor' },
                '8385': { market: 'LA', do_name: 'Victor' }
            };

            // Validate store number if provided
            if (payload.store_num !== undefined) {
                const sVal = String(payload.store_num).trim();
                const isAbove = sVal.toLowerCase().includes('above') || sVal.toLowerCase() === 'exec' || sVal.toLowerCase() === 'do';
                if (!isAbove && sVal) {
                    const cleanNum = sVal.replace(/\D/g, '');
                    const matchedStore = CANONICAL_TEAM_WOW_STORES[cleanNum];
                    if (!matchedStore) {
                        return new Response(JSON.stringify({ 
                            success: false, 
                            error: `Store #${cleanNum} is not a valid Team Wow store. Please select a recognized store from the company roster.` 
                        }), { status: 400, headers: corsHeaders() });
                    }
                    payload.store_num = cleanNum;
                    if (!payload.market) {
                        payload.market = matchedStore.market;
                    }
                }
            }

            // If PIN is being updated, verify it is not claimed by another user
            if (payload.trainer_pin) {
                const cleanPin = String(payload.trainer_pin).replace(/\D/g, '').trim();
                if (cleanPin.length === 4) {
                    const pinCollision = await db.prepare("SELECT trainer_id, trainer_name FROM trainer_credentials WHERE trainer_pin = ? AND LOWER(trainer_id) != LOWER(?) LIMIT 1").bind(cleanPin, originalId).first();
                    if (pinCollision) {
                        return new Response(JSON.stringify({ 
                            success: false, 
                            error: `PIN ${cleanPin} is already assigned to ${pinCollision.trainer_name}. Please choose a unique 4-digit PIN.` 
                        }), { status: 409, headers: corsHeaders() });
                    }
                }
            }

            const updates = [];
            const binds = [];

            // If ID changed, include trainer_id in updates
            if (newTrainerId && newTrainerId.toLowerCase() !== originalId.toLowerCase()) {
                updates.push("trainer_id = ?");
                binds.push(newTrainerId);
            }

            const allowedFields = [
                'trainer_name', 'is_wow_way_trainer', 'is_mit_trainer', 'is_gm', 'is_do', 'is_admin', 'is_exec', 'is_active',
                'role', 'market', 'store_num', 'email', 'phone', 'trainer_pin', 'notes'
            ];

            for (const field of allowedFields) {
                if (payload[field] !== undefined) {
                    updates.push(`${field} = ?`);
                    binds.push(payload[field]);
                }
            }

            // If leadership permissions are being granted, also auto-clear any "Pending" status notes and ensure active
            const isGrantingScope = (payload.is_exec == 1 || payload.is_do == 1 || payload.is_admin == 1 || payload.is_gm == 1);
            if (isGrantingScope && payload.notes === undefined) {
                updates.push("notes = TRIM(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending GM Access Approval', ''), ' - Pending Approval', ''), 'Pending Approval', ''), '[Pending GM Access Approval]', ''))");
                if (payload.is_active === undefined) {
                    updates.push("is_active = 1");
                }
            }

            if (updates.length === 0) {
                return new Response(JSON.stringify({ success: false, error: "No fields to update" }), { status: 400, headers: corsHeaders() });
            }

            updates.push("updated_at = CURRENT_TIMESTAMP");
            binds.push(originalId);

            await db.prepare(`
                UPDATE trainer_credentials 
                SET ${updates.join(', ')} 
                WHERE LOWER(trainer_id) = LOWER(?)
            `).bind(...binds).run();

            const finalId = newTrainerId || originalId;

            // If ID changed, cascade ID to usage logs and reset requests
            if (newTrainerId && newTrainerId.toLowerCase() !== originalId.toLowerCase()) {
                try {
                    await db.prepare("UPDATE credential_usage_logs SET trainer_id = ? WHERE LOWER(trainer_id) = LOWER(?)").bind(newTrainerId, originalId).run();
                    await db.prepare("UPDATE credential_reset_requests SET trainer_id = ? WHERE LOWER(trainer_id) = LOWER(?)").bind(newTrainerId, originalId).run();
                } catch (_) {}
            }

            // Log admin audit event
            try {
                await db.prepare(`
                    INSERT INTO credential_usage_logs (trainer_id, trainer_name, store_num, portal, action, metadata, created_at)
                    VALUES (?, ?, '', 'Admin Hub', 'Profile Updated', ?, CURRENT_TIMESTAMP)
                `).bind(finalId, payload.trainer_name || payload.trainerName || finalId, JSON.stringify(payload)).run();
            } catch (_) {}

            const updated = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(finalId).first();
            return new Response(JSON.stringify({ success: true, user: updated }), { status: 200, headers: corsHeaders() });
        }

        // 9b. Self-Service Pulse ID Upgrade (Convert Legacy Email ID to Pulse ID)
        if (action === "updatePulseId" || action === "setPulseId") {
            const rawPin = String(payload.pin || url.searchParams.get("pin") || "").replace(/\D/g, '').trim();
            const originalTrainerId = String(payload.originalTrainerId || payload.trainerId || "").trim();
            const newPulseId = String(payload.newPulseId || payload.pulseId || "").trim();

            if (!rawPin || rawPin.length !== 4) {
                return new Response(JSON.stringify({ success: false, error: "Valid 4-digit PIN required." }), { status: 400, headers: corsHeaders() });
            }
            if (!newPulseId || newPulseId.includes('@')) {
                return new Response(JSON.stringify({ success: false, error: "Please enter a valid Pulse ID (cannot contain @)." }), { status: 400, headers: corsHeaders() });
            }

            // Verify trainer credentials by PIN
            const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE trainer_pin = ? AND is_active = 1 LIMIT 1").bind(rawPin).first();
            if (!trainer) {
                return new Response(JSON.stringify({ success: false, error: "Account not found or inactive." }), { status: 404, headers: corsHeaders() });
            }

            // Check if new Pulse ID is already taken by another person
            const collision = await db.prepare("SELECT trainer_id, trainer_name FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) AND trainer_pin != ? LIMIT 1").bind(newPulseId, rawPin).first();
            if (collision) {
                return new Response(JSON.stringify({ success: false, error: `Pulse ID '${newPulseId}' is already in use by ${collision.trainer_name}. Please choose a unique ID.` }), { status: 409, headers: corsHeaders() });
            }

            const targetId = originalTrainerId || trainer.trainer_id;

            await db.prepare("UPDATE trainer_credentials SET trainer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE trainer_pin = ?").bind(newPulseId, rawPin).run();

            // Cascade to usage logs & reset requests
            try {
                await db.prepare("UPDATE credential_usage_logs SET trainer_id = ? WHERE LOWER(trainer_id) = LOWER(?)").bind(newPulseId, targetId).run();
                await db.prepare("UPDATE credential_reset_requests SET trainer_id = ? WHERE LOWER(trainer_id) = LOWER(?)").bind(newPulseId, targetId).run();
                await db.prepare(`
                    INSERT INTO credential_usage_logs (trainer_id, trainer_name, store_num, portal, action, metadata, created_at)
                    VALUES (?, ?, ?, 'Staffing Command', 'Pulse ID Upgrade', ?, CURRENT_TIMESTAMP)
                `).bind(newPulseId, trainer.trainer_name, trainer.store_num, JSON.stringify({ previousId: targetId })).run();
            } catch (_) {}

            return new Response(JSON.stringify({ success: true, trainer_id: newPulseId, message: "Pulse ID updated successfully." }), { status: 200, headers: corsHeaders() });
        }

        // 9c. Delete Trainer Credential Profile
        if (action === "deleteTrainerCredential") {
            const trainerId = String(payload.trainerId || payload.trainer_id || url.searchParams.get("trainerId") || "").trim();
            if (!trainerId) {
                return new Response(JSON.stringify({ success: false, error: "Trainer ID required." }), { status: 400, headers: corsHeaders() });
            }
            await db.prepare("DELETE FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?)").bind(trainerId).run();
            try {
                await db.prepare("DELETE FROM credential_reset_requests WHERE LOWER(trainer_id) = LOWER(?)").bind(trainerId).run();
                await db.prepare(`
                    INSERT INTO credential_usage_logs (trainer_id, trainer_name, store_num, portal, action, metadata, created_at)
                    VALUES (?, ?, '', 'Admin Hub', 'Profile Deleted', ?, CURRENT_TIMESTAMP)
                `).bind(trainerId, trainerId, JSON.stringify({ deletedBy: 'Admin Hub' })).run();
            } catch (_) {}
            return new Response(JSON.stringify({ success: true, message: `Profile ${trainerId} successfully deleted.` }), { status: 200, headers: corsHeaders() });
        }

        // 10. Decide / Resolve PIN Reset Request
        if (action === "decidePinReset") {
            const requestId = parseInt(payload.requestId, 10);
            const decision = String(payload.decision || "").toLowerCase().trim(); // 'approve' | 'deny'
            const newPin = String(payload.newPin || "").replace(/\D/g, '').trim();

            const resetReq = await db.prepare("SELECT * FROM credential_reset_requests WHERE id = ?").bind(requestId).first();
            if (!resetReq) {
                return new Response(JSON.stringify({ success: false, error: "Reset request not found" }), { status: 404, headers: corsHeaders() });
            }

            if (decision === 'approve') {
                const finalPin = (newPin && newPin.length === 4) ? newPin : (resetReq.requested_pin || String(Math.floor(1000 + Math.random() * 9000)));
                await db.prepare(`
                    UPDATE trainer_credentials 
                    SET trainer_pin = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP 
                    WHERE LOWER(trainer_id) = LOWER(?) OR (email != '' AND LOWER(email) = LOWER(?))
                `).bind(finalPin, resetReq.trainer_id, resetReq.email).run();

                await db.prepare(`
                    UPDATE credential_reset_requests 
                    SET status = 'approved', resolved_at = CURRENT_TIMESTAMP, resolved_by = 'Mike Jacobs' 
                    WHERE id = ?
                `).bind(requestId).run();

                // Log to credential_usage_logs
                try {
                    await db.prepare(`
                        INSERT INTO credential_usage_logs (trainer_id, trainer_name, store_num, portal, action, metadata, created_at)
                        VALUES (?, ?, ?, 'Admin Hub', 'PIN Reset Approved', ?, CURRENT_TIMESTAMP)
                    `).bind(resetReq.trainer_id, resetReq.trainer_name, resetReq.store_num, JSON.stringify({ newPin: finalPin })).run();
                } catch (_) {}

                // Send Apps Script notice to trainer
                await callAppsScriptProxy({
                    action: "sendPinResetApprovedEmail",
                    trainerName: resetReq.trainer_name,
                    email: resetReq.email,
                    pulseId: resetReq.trainer_id,
                    newPin: finalPin,
                    storeNum: resetReq.store_num
                }, context);

                return new Response(JSON.stringify({ success: true, message: `PIN reset approved. New PIN (${finalPin}) assigned.`, newPin: finalPin }), { status: 200, headers: corsHeaders() });
            } else {
                await db.prepare(`
                    UPDATE credential_reset_requests 
                    SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP, resolved_by = 'Mike Jacobs' 
                    WHERE id = ?
                `).bind(requestId).run();

                return new Response(JSON.stringify({ success: true, message: "PIN reset request dismissed." }), { status: 200, headers: corsHeaders() });
            }
        }

        // 11. Decide / Authorize Trainer Access Directly from Admin Hub
        if (action === "approveTrainerAccess" || action === "decideTrainerAccess") {
            const trainerId = String(payload.trainerId || payload.trainer_id || "").trim();
            const decision = String(payload.decision || "approve").toLowerCase().trim(); // 'approve' | 'deny'
            if (!trainerId) {
                return new Response(JSON.stringify({ success: false, error: "Missing trainerId" }), { status: 400, headers: corsHeaders() });
            }

            const trainer = await db.prepare("SELECT * FROM trainer_credentials WHERE LOWER(trainer_id) = LOWER(?) LIMIT 1").bind(trainerId).first();
            if (!trainer) {
                return new Response(JSON.stringify({ success: false, error: "Trainer profile not found" }), { status: 404, headers: corsHeaders() });
            }

            if (decision === "approve") {
                const isExecRole = trainer.role === 'Executive' || trainer.store_num === 'Exec' || !!trainer.is_exec;
                const isDoOrAboveStore = isExecRole ||
                                         !!trainer.is_do || 
                                         trainer.role === 'Supervisor' || 
                                         trainer.role === 'Director of Operations' || 
                                         trainer.role === 'Director of Ops' || 
                                         trainer.role === 'Training Director' || 
                                         trainer.role === 'Market Leader' || 
                                         trainer.store_num === 'Above-Store' || 
                                         trainer.store_num === 'DO';

                let newRole = trainer.role;
                if (!newRole || newRole === 'General Manager' || newRole === 'Trainer') {
                    if (isExecRole) newRole = 'Executive';
                    else if (isDoOrAboveStore) newRole = 'Director of Ops';
                    else newRole = 'General Manager';
                }

                await db.prepare(`
                    UPDATE trainer_credentials 
                    SET is_gm = 1,
                        is_do = ?,
                        is_exec = ?,
                        is_active = 1,
                        role = ?,
                        notes = TRIM(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending GM Access Approval', ''), ' - Pending Approval', ''), 'Pending Approval', ''), '[Pending GM Access Approval]', '')),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE LOWER(trainer_id) = LOWER(?)
                `).bind(isDoOrAboveStore ? 1 : 0, isExecRole ? 1 : 0, newRole, trainer.trainer_id).run();

                // Dispatch confirmation notice to the trainer
                let candidateEmail = String(trainer.email || (trainer.trainer_id && trainer.trainer_id.includes('@') ? trainer.trainer_id : '')).trim();
                if (/^store\d+@team-wow\.com$/i.test(candidateEmail)) {
                    candidateEmail = candidateEmail.replace(/^store/i, '').toLowerCase();
                }

                if (candidateEmail) {
                    await callAppsScriptProxy({
                        action: "sendGmApprovalNoticeToTrainer",
                        trainerName: trainer.trainer_name,
                        pulseId: trainer.trainer_id,
                        storeNum: isDoOrAboveStore ? "Above-Store" : trainer.store_num,
                        market: trainer.market,
                        pin: trainer.trainer_pin,
                        email: candidateEmail,
                        role: newRole,
                        isDo: isDoOrAboveStore,
                        isAboveStore: isDoOrAboveStore
                    }, context);
                }

                // Log to credential_usage_logs
                try {
                    await db.prepare(`
                        INSERT INTO credential_usage_logs (trainer_id, trainer_name, store_num, portal, action, metadata, created_at)
                        VALUES (?, ?, ?, 'Admin Hub', 'Access Approved', ?, CURRENT_TIMESTAMP)
                    `).bind(trainer.trainer_id, trainer.trainer_name, trainer.store_num, JSON.stringify({ role: newRole, is_do: isDoOrAboveStore ? 1 : 0 })).run();
                } catch (_) {}

                return new Response(JSON.stringify({ 
                    success: true, 
                    message: `Access approved for ${trainer.trainer_name} (${newRole}). Confirmation email dispatched.` 
                }), { status: 200, headers: corsHeaders() });
            } else {
                await db.prepare(`
                    UPDATE trainer_credentials 
                    SET is_gm = 0,
                        is_do = 0,
                        notes = TRIM(REPLACE(REPLACE(REPLACE(COALESCE(notes, ''), ' - Pending GM Access Approval', ''), ' - Pending Approval', ''), 'Pending Approval', 'Access Declined')),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE LOWER(trainer_id) = LOWER(?)
                `).bind(trainer.trainer_id).run();

                return new Response(JSON.stringify({ success: true, message: `Access request for ${trainer.trainer_name} was declined.` }), { status: 200, headers: corsHeaders() });
            }
        }

        // 12. Log Credential Activity (PIN reveals, etc.)
        if (action === "logCredentialActivity") {
            const trainerId = String(payload.trainerId || payload.trainer_id || "").trim();
            const trainerName = String(payload.trainerName || payload.trainer_name || "").trim();
            const act = String(payload.activity || payload.action || "PIN Peeked / Revealed").trim();
            try {
                await db.prepare(`
                    INSERT INTO credential_usage_logs (trainer_id, trainer_name, store_num, portal, action, created_at)
                    VALUES (?, ?, 'Admin Hub', 'Admin Hub', ?, CURRENT_TIMESTAMP)
                `).bind(trainerId, trainerName, act).run();
            } catch (_) {}
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders() });
        }

        // Fallback: action not recognized
        return new Response(JSON.stringify({ error: `Unsupported action: ${action}` }), {
            status: 400,
            headers: corsHeaders()
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message || "Failed to execute POST operation" }), {
            status: 500,
            headers: corsHeaders()
        });
    }
}
