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

// HTML renderer for 1-click email actions (approval, denial, deletion)
function renderActionHtml(title, message, headerColor) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} • Team Wow Orientation</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #fefaf6; margin: 0; padding: 40px 16px; color: #472b10; display: flex; justify-content: center; align-items: center; min-height: 80vh; }
        .card { background: white; max-width: 520px; width: 100%; border-radius: 12px; border: 2px solid #f0decc; box-shadow: 0 10px 25px rgba(71, 43, 16, 0.1); overflow: hidden; text-align: center; }
        .header { background-color: ${headerColor || '#005c91'}; color: white; padding: 22px 24px; }
        .header h2 { margin: 0; font-size: 21px; letter-spacing: 0.5px; }
        .body { padding: 30px 24px; font-size: 15.5px; line-height: 1.6; }
        .footer { font-size: 13px; color: #888; border-top: 1px dashed #f0decc; padding: 14px; background-color: #faf2e9; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <h2>${title}</h2>
        </div>
        <div class="body">
            <p>${message}</p>
        </div>
        <div class="footer">
            You can safely close this window now.
        </div>
    </div>
</body>
</html>`;
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

            // 2. Increment spots_taken
            await db.prepare("UPDATE training_classes SET spots_taken = spots_taken + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(reg.class_id).run();

            // 3. Update candidate profile if exists
            if (cls) {
                const nowFormatted = getNowFormatted("America/Chicago");
                await db.prepare(`
                    UPDATE onboarding_candidates SET
                        nto_date = ?,
                        nto_scheduled = 1,
                        last_updated = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE LOWER(email) = LOWER(?) OR (phone_number != '' AND phone_number = ?)
                `).bind(cls.class_date, nowFormatted, reg.email, reg.phone).run();
            }

            // 4. Send Confirmation & Google Meet link via Apps Script microservice
            try {
                if (cls && reg.email) {
                    await fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            username: "dallas_admin",
                            password: "dallas_password_123",
                            action: "sendNtoMeetLinks",
                            classDate: cls.class_date,
                            classTime: cls.start_time,
                            meetLink: cls.meet_link || "https://meet.google.com/zwc-afuu-hgh",
                            trainerName: cls.trainer || "Mike Jacobs",
                            notifyAdmin: false,
                            studentPhone: reg.phone,
                            storeNum: reg.store_num,
                            trainees: [{ name: reg.candidate_name, email: reg.email }]
                        })
                    });
                }
            } catch (mailErr) {
                console.warn("Apps Script confirmation email proxy failed:", mailErr);
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
            try {
                if (reg.email) {
                    await fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            username: "dallas_admin",
                            password: "dallas_password_123",
                            action: "sendNtoStudentDenial",
                            name: reg.candidate_name,
                            email: reg.email,
                            classDate: cls ? cls.class_date : ""
                        })
                    });
                }
            } catch (mailErr) {
                console.warn("Apps Script denial email proxy failed:", mailErr);
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

    const storeNum = url.searchParams.get("storeNum") || url.searchParams.get("store");

    try {
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

        // Map candidates to frontend camelCase
        const onboarding = (candidatesRes.results || []).map(c => ({
            id: c.id,
            name: c.name,
            position: c.position || '',
            store: c.store_num,
            doName: c.do_name || '',
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
            lastUpdated: c.last_updated || ''
        }));

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
        const adminContacts = (adminContactsRes.results || []).map(a => ({
            role: a.role,
            name: a.name,
            email: a.email || '',
            phone: a.phone || ''
        }));

        // Map interviews
        const interviews = (interviewsRes.results || []).map(i => ({
            id: i.id,
            store: i.store_num,
            doName: i.do_name || '',
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
        }));

        // Map staffing
        const staffing = (staffingRes.results || []).map(st => ({
            id: st.id,
            period: st.period || '',
            doName: st.do_name || '',
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
        }));

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

    const action = payload.action;
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
            const existingReg = await db.prepare("SELECT * FROM class_registrations WHERE class_id = ? AND (LOWER(email) = LOWER(?) OR (phone != '' AND phone = ?))").bind(classId, email, phone).first();
            if (existingReg) {
                return new Response(JSON.stringify({
                    success: true,
                    message: "You are already registered for this session!",
                    classDate: cls.class_date,
                    startTime: cls.start_time,
                    meetLink: cls.meet_link,
                    alreadyRegistered: true
                }), { status: 200, headers: corsHeaders() });
            }

            // 1b-ii. Global Duplicate / Prior Registration Check across all historical sessions
            const cleanDigits = phone.replace(/\D/g, '').slice(-10);
            let priorReg = null;
            if (email && cleanDigits.length === 10) {
                priorReg = await db.prepare(`
                    SELECT cr.*, tc.class_date, tc.start_time 
                    FROM class_registrations cr
                    LEFT JOIN training_classes tc ON cr.class_id = tc.id
                    WHERE LOWER(cr.email) = LOWER(?) OR (cr.phone != '' AND REPLACE(REPLACE(REPLACE(REPLACE(cr.phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?)
                `).bind(email, '%' + cleanDigits).first();
            } else if (email) {
                priorReg = await db.prepare(`
                    SELECT cr.*, tc.class_date, tc.start_time 
                    FROM class_registrations cr
                    LEFT JOIN training_classes tc ON cr.class_id = tc.id
                    WHERE LOWER(cr.email) = LOWER(?)
                `).bind(email).first();
            } else if (cleanDigits.length === 10) {
                priorReg = await db.prepare(`
                    SELECT cr.*, tc.class_date, tc.start_time 
                    FROM class_registrations cr
                    LEFT JOIN training_classes tc ON cr.class_id = tc.id
                    WHERE cr.phone != '' AND REPLACE(REPLACE(REPLACE(REPLACE(cr.phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?
                `).bind('%' + cleanDigits).first();
            }

            // 1b-iii. Check onboarding_candidates for prior scheduled NTO
            let candMatch = null;
            if (email && cleanDigits.length === 10) {
                candMatch = await db.prepare("SELECT * FROM onboarding_candidates WHERE (nto_scheduled = 1 OR (nto_date IS NOT NULL AND nto_date != '')) AND (LOWER(email) = LOWER(?) OR (phone_number != '' AND REPLACE(REPLACE(REPLACE(REPLACE(phone_number, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?))").bind(email, '%' + cleanDigits).first();
            } else if (email) {
                candMatch = await db.prepare("SELECT * FROM onboarding_candidates WHERE (nto_scheduled = 1 OR (nto_date IS NOT NULL AND nto_date != '')) AND LOWER(email) = LOWER(?)").bind(email).first();
            }

            if (priorReg || candMatch) {
                const regId = "REG-PEND-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
                await db.prepare("INSERT INTO class_registrations (id, class_id, candidate_id, candidate_name, store_num, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')").bind(regId, classId, candidateId, name, storeNum, position, phone, email).run();

                try {
                    await fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
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
                        })
                    });
                } catch (dupMailErr) {
                    console.warn("Duplicate alert proxy failed:", dupMailErr);
                }

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

            // 1c. Insert class registration
            const regId = "REG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
            await db.prepare("INSERT INTO class_registrations (id, class_id, candidate_id, candidate_name, store_num, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed')").bind(regId, classId, candidateId, name, storeNum, position, phone, email).run();

            // 1d. Update spots_taken in training_classes
            await db.prepare("UPDATE training_classes SET spots_taken = spots_taken + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(classId).run();

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
                        phone_number = CASE WHEN (phone_number IS NULL OR phone_number = '') AND ? != '' THEN ? ELSE phone_number END,
                        email = CASE WHEN (email IS NULL OR email = '') AND ? != '' THEN ? ELSE email END,
                        store_num = CASE WHEN (store_num IS NULL OR store_num = '') AND ? != '' THEN ? ELSE store_num END,
                        last_updated = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(cls.class_date, phone, phone, email, email, storeNum, storeNum, nowFormatted, matchedCand.id).run();
            }

            // 1f. Trigger confirmation email via Google Apps Script microservice
            try {
                if (regMarket.toLowerCase() === "dallas") {
                    await fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            username: "dallas_admin",
                            password: "dallas_password_123",
                            action: "sendNtoMeetLinks",
                            classDate: cls.class_date,
                            classTime: cls.start_time,
                            meetLink: cls.meet_link || "https://meet.google.com/zwc-afuu-hgh",
                            trainerName: "Mike Jacobs",
                            notifyAdmin: true,
                            studentPhone: phone,
                            storeNum: storeNum,
                            trainees: [{ name: name, email: email }]
                        })
                    });
                }
            } catch (mailErr) {
                console.warn("Confirmation email proxy failed:", mailErr);
            }

            return new Response(JSON.stringify({
                success: true,
                message: "Registration confirmed!",
                classDate: cls.class_date,
                startTime: cls.start_time,
                endTime: cls.end_time,
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
                try {
                    await fetch(APPS_SCRIPT_URL, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify({
                            username: "dallas_admin",
                            password: "dallas_password_123",
                            action: "sendNtoMeetLinks",
                            classDate: targetClass.class_date,
                            classTime: targetClass.start_time,
                            meetLink: targetClass.meet_link || "https://meet.google.com/zwc-afuu-hgh",
                            trainerName: targetClass.trainer || "Mike Jacobs",
                            trainees: [{ name: recipientName, email: recipientEmail }]
                        })
                    });
                    emailSent = true;
                } catch (mailErr) {
                    console.warn("Reschedule Meet link email failed:", mailErr);
                }
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
            const meetLink = payload.meetLink || (market === "Denver" ? "" : "https://meet.google.com/zwc-afuu-hgh");

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

        // 4. Email & NTO Automation Actions: Proxy to Google Apps Script Gmail microservice
        if (action === "sendEmail" || action === "sendNtoMeetLinks" || action === "sendWelcomeLetter" || action === "concludeNtoClass" || action === "testNtoPayrollReport" || action === "sendNtoPayrollReport" || action === "setupNtoPayrollTrigger" || action === "disableNtoPayrollTrigger") {
            try {
                const gasRes = await fetch(APPS_SCRIPT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(gasPayload)
                });
                const gasJson = await gasRes.json();
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
                        WHERE id = ?
                    `).bind(
                        attVal,
                        hiredVal,
                        missedNtoVal,
                        shirtVal, shirtVal,
                        hatVal, hatVal,
                        payCardVal, payCardVal,
                        itemTime,
                        item.id
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

            // Sync with Google Apps Script in the background so Google Sheets stays in sync
            try {
                fetch(APPS_SCRIPT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(gasPayload)
                }).catch(e => console.warn("GAS background attendance sync warning:", e));
            } catch (e) {
                console.warn("GAS fetch trigger failed:", e);
            }

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

        // 4. Handle ADD Operations (Interviews, Staffing, Onboarding)
        if (action === "add") {
            const target = payload.target || "onboarding";

            if (target === "interviews") {
                const newId = payload.id || `INT-ID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
                    payload.doName || '',
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
                    payload.doName || '',
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

                return new Response(JSON.stringify({ success: true, id: newId }), { status: 200, headers: corsHeaders() });
            }

            // Default target: Onboarding candidate
            const cand = payload.candidate || payload.record || payload;
            const newId = cand.id || `ID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const boolToInt = v => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
            const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = cand.lastUpdated || getNowFormatted(tz);

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
                cand.doName || '',
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

            return new Response(JSON.stringify({ success: true, id: newId }), { status: 200, headers: corsHeaders() });
        }

        // 5. Handle UPDATE Operations (Interviews, Staffing, Onboarding)
        if (action === "updateCandidate" || action === "update") {
            const target = payload.target || "onboarding";

            if (target === "interviews") {
                if (!payload.id) {
                    return new Response(JSON.stringify({ error: "Missing interview ID" }), { status: 400, headers: corsHeaders() });
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
                    payload.doName !== undefined ? payload.doName : null,
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
                    payload.doName !== undefined ? payload.doName : null,
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

                return new Response(JSON.stringify({ success: true, id: payload.id }), { status: 200, headers: corsHeaders() });
            }

            // Default target: Onboarding candidate
            const cand = payload.candidate || payload.record || payload;
            if (!cand || !cand.id) {
                return new Response(JSON.stringify({ error: "Missing candidate ID" }), { status: 400, headers: corsHeaders() });
            }

            const boolToInt = v => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
            const tz = market.toLowerCase() === "denver" ? "America/Denver" : "America/Chicago";
            const nowFormatted = cand.lastUpdated || getNowFormatted(tz);

            await db.prepare(`
                UPDATE onboarding_candidates SET
                    name = COALESCE(?, name),
                    position = COALESCE(?, position),
                    store_num = COALESCE(?, store_num),
                    do_name = COALESCE(?, do_name),
                    nto_date = COALESCE(?, nto_date),
                    nto_attendance = COALESCE(?, nto_attendance),
                    notes = COALESCE(?, notes),
                    shirt_size = COALESCE(?, shirt_size),
                    hat_style = COALESCE(?, hat_style),
                    pay_card = COALESCE(?, pay_card),
                    phone_number = COALESCE(?, phone_number),
                    email = COALESCE(?, email),
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
                cand.doName !== undefined ? cand.doName : null,
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
                        nto_attendance = COALESCE(?, nto_attendance),
                        nto_date = COALESCE(?, nto_date),
                        hired = COALESCE(?, hired),
                        inactive = COALESCE(?, inactive),
                        withdrawn = COALESCE(?, withdrawn),
                        notes = COALESCE(?, notes),
                        last_updated = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    item.ntoAttendance !== undefined ? item.ntoAttendance : null,
                    item.ntoDate !== undefined ? item.ntoDate : null,
                    item.hired !== undefined ? boolToInt(item.hired) : null,
                    item.inactive !== undefined ? boolToInt(item.inactive) : null,
                    item.withdrawn !== undefined ? boolToInt(item.withdrawn) : null,
                    item.notes !== undefined ? item.notes : null,
                    item.lastUpdated || nowFormatted,
                    item.id
                ));
            }

            if (statements.length > 0) {
                await db.batch(statements);
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
