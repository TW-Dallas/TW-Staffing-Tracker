// Cloudflare Pages Function: /api/staffing
// Handles sub-millisecond D1 SQLite reads & atomic writes for Team Wow Staffing Tracker & Admin Hub

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxQVuU0uQ3TdkfsBwJpZ-K1iUDXTuLgvqEayPeqZgSRLDNxHOEUsOrjaSZAujI8p_874g/exec";

// CORS Headers Helper
function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Content-Type": "application/json;charset=utf-8"
    };
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
    let market = url.searchParams.get("market") || url.searchParams.get("city") || "Dallas";
    market = market.toLowerCase() === "denver" ? "Denver" : "Dallas";

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
            ntoClassesRes
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
            db.prepare("SELECT * FROM training_classes WHERE program = 'NTO' AND (market = ? OR market = 'Virtual') AND is_active = 1 ORDER BY class_date ASC").bind(market).all()
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

        // NTO Classes
        const ntoClasses = (ntoClassesRes.results || []).map(cl => ({
            id: cl.id,
            market: cl.market,
            name: cl.name,
            classDate: cl.class_date,
            startTime: cl.start_time,
            endTime: cl.end_time,
            trainer: cl.trainer,
            location: cl.location,
            meetLink: cl.meet_link,
            spotsTotal: cl.spots_total,
            spotsTaken: cl.spots_taken
        }));

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
            headers: corsHeaders()
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
        // 1. Email & NTO Class Automation Actions: Proxy to Google Apps Script Gmail microservice
        if (action === "sendEmail" || action === "sendNtoMeetLinks" || action === "sendWelcomeLetter" || action === "concludeNtoClass" || action === "getNtoClasses" || action === "addNtoClass" || action === "deleteNtoClass") {
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
            const scratchText = payload.scratchpadText || "";
            const checklistJson = JSON.stringify(payload.scratchpadChecklist || []);
            await db.prepare(`INSERT OR REPLACE INTO scratchpad (market, scratchpad_text, checklist_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`).bind(
                market,
                scratchText,
                checklistJson
            ).run();
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
