/**
 * MIT Leadership Class Scheduler & Roster Manager
 * Extracted module for TW-Staffing-Tracker
 */

window.mitCalendarClassesCache = [];
window.currentSelectedMitClassId = null;
window.currentMitRosterCache = [];

function isDenverActive() {
    const u = localStorage.getItem('onb_user') || '';
    const headerCityText = document.getElementById('headerCity') ? document.getElementById('headerCity').innerText : '';
    return (window.currentCity || '').toLowerCase() === 'denver' ||
           (typeof getCityFromUser === 'function' && getCityFromUser(u).toLowerCase() === 'denver') ||
           headerCityText.toLowerCase().includes('denver');
}

function getMitClassTimestamp(c) {
    if (!c || !c.classDate) return 0;
    const parts = c.classDate.split('/');
    if (parts.length !== 3) return 0;
    const m = parseInt(parts[0], 10) - 1;
    const d = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    let hours = 0, minutes = 0;
    if (c.startTime) {
        const match = c.startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
            let h = parseInt(match[1], 10);
            const min = parseInt(match[2], 10);
            const ampm = match[3].toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            hours = h;
            minutes = min;
        }
    }
    return new Date(y, m, d, hours, minutes).getTime();
}

function formatMitDateDisplay(dateStr) {
    if (!dateStr) return { dayOfWeek: '', formattedDate: '', isToday: false, isPast: false };
    const parts = dateStr.split('/');
    if (parts.length !== 3) return { dayOfWeek: '', formattedDate: dateStr, isToday: false, isPast: false };
    const m = parseInt(parts[0], 10) - 1;
    const d = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = days[dt.getDay()] || '';
    const formattedDate = `${dayOfWeek} ${parts[0]}/${parts[1]}`;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const classStart = new Date(y, m, d).getTime();
    const isToday = classStart === todayStart;
    const isPast = classStart < todayStart;

    return { dayOfWeek, formattedDate, isToday, isPast };
}

async function fetchMitSchedulerClasses() {
    try {
        const u = localStorage.getItem('onb_user') || '';
        const headerCityText = document.getElementById('headerCity') ? document.getElementById('headerCity').innerText : '';
        let currentCity = window.currentCity || (typeof getCityFromUser === 'function' ? getCityFromUser(u) : '');
        if (!currentCity || currentCity === 'System') {
            if (headerCityText.toLowerCase().includes('denver')) currentCity = 'Denver';
            else currentCity = 'Dallas';
        }
        const apiBase = (typeof D1_API_URL !== 'undefined') ? D1_API_URL : '/api/staffing';
        const res = await fetch(`${apiBase}?action=getMitClasses&market=${encodeURIComponent(currentCity || 'Dallas')}`);
        const data = await res.json();
        if (!data.success || !data.classes || data.classes.length === 0) {
            window.mitCalendarClassesCache = [];
            renderMitSidebar();
            renderMitClassView();
            updateMitAuditMetrics();
            return;
        }

        window.mitCalendarClassesCache = data.classes;
        renderMitSidebar();
        renderMitClassView(window.currentSelectedMitClassId);
        updateMitAuditMetrics();
    } catch (err) {
        console.error("Error loading MIT classes:", err);
    }
}

function renderMitSidebar() {
    const listContainer = document.getElementById('candidateList');
    if (!listContainer) return;

    const listCounterLabel = document.getElementById('listCounterLabel');
    const sortDropdown = document.getElementById('customSortDropdown');
    if (sortDropdown) sortDropdown.classList.add('hidden');

    const isDenver = isDenverActive();
    const levelFilterEl = document.getElementById('mitSidebarLevelFilter');
    if (levelFilterEl) {
        levelFilterEl.style.display = isDenver ? 'none' : '';
    }

    const searchVal = (document.getElementById('searchControl')?.value || '').trim().toLowerCase();
    const locFilter = document.getElementById('mitSidebarCenterFilter')?.value || 'ALL';
    const lvlFilter = (!isDenver && document.getElementById('mitSidebarLevelFilter')) ? document.getElementById('mitSidebarLevelFilter').value : 'ALL';
    const showPast = document.getElementById('mitShowPastClasses')?.checked || false;

    let classes = (window.mitCalendarClassesCache || []).slice();

    // Filter
    classes = classes.filter(c => {
        const dateInfo = formatMitDateDisplay(c.classDate);
        if (!showPast && !searchVal && dateInfo.isPast && !dateInfo.isToday) {
            return false;
        }
        if (locFilter !== 'ALL' && c.location !== locFilter) return false;
        if (!isDenver && lvlFilter !== 'ALL' && String(c.level) !== String(lvlFilter)) return false;
        if (searchVal) {
            const matchName = (c.name || '').toLowerCase().includes(searchVal);
            const matchTrainer = (c.trainer || '').toLowerCase().includes(searchVal);
            const matchLoc = (c.location || '').toLowerCase().includes(searchVal);
            const matchId = (c.id || '').toLowerCase().includes(searchVal);
            const matchDate = (c.classDate || '').toLowerCase().includes(searchVal);
            const matchAttendee = (c.attendees || []).some(a => String(a.candidate_name || a.name || '').toLowerCase().includes(searchVal));
            if (!matchName && !matchTrainer && !matchLoc && !matchId && !matchDate && !matchAttendee) return false;
        }
        return true;
    });

    // Sort chronological
    classes.sort((a, b) => getMitClassTimestamp(a) - getMitClassTimestamp(b));

    if (listCounterLabel) {
        listCounterLabel.innerHTML = `UPCOMING SESSIONS · <span id="mitUpcomingCount">${classes.length}</span>`;
    }

    // Auto-select first session if none selected
    if (classes.length > 0) {
        const isSelectedPresent = classes.some(c => c.id === window.currentSelectedMitClassId);
        if (!window.currentSelectedMitClassId || !isSelectedPresent) {
            const upcomingFirst = classes.find(c => {
                const info = formatMitDateDisplay(c.classDate);
                return !info.isPast || info.isToday;
            }) || classes[0];
            window.currentSelectedMitClassId = upcomingFirst.id;
        }
    } else {
        window.currentSelectedMitClassId = null;
    }

    listContainer.innerHTML = '';
    if (classes.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding: 25px; color: var(--crust-deep); font-size: 15px;">No MIT sessions match current filters.</div>';
        return;
    }

    classes.forEach(c => {
        const dateInfo = formatMitDateDisplay(c.classDate);
        const isSelected = c.id === window.currentSelectedMitClassId;
        const card = document.createElement('div');
        card.className = `mit-session-card ${isSelected ? 'selected' : ''}`;

        // Color accent according to mockup: Level 3 is dark-blue (#005c91), Level 1/2 is tan (#c0a588), Denver is brand-blue (#0077bd)
        if (isDenver) {
            card.style.borderLeftColor = 'var(--brand-blue, #0077bd)';
        } else if (c.level === 3) {
            card.style.borderLeftColor = 'var(--dark-blue, #005c91)';
        } else {
            card.style.borderLeftColor = 'var(--crust-dark, #c0a588)';
        }

        const dateSubText = dateInfo.isToday ? `${dateInfo.formattedDate} · TODAY` : dateInfo.formattedDate;
        
        // CRITICAL DENVER EXCEPTION: Denver does NOT do levels for their classes!
        let levelPillHtml = '';
        if (!isDenver) {
            const lvlNum = c.level || 1;
            levelPillHtml = `<span class="mit-lv-pill mit-lv-${lvlNum}">Level ${lvlNum}</span>`;
        }

        const spotsTaken = c.spotsTaken || (c.attendees ? c.attendees.length : 0);
        const spotsTotal = c.spotsTotal || 15;
        const timeStr = c.startTime ? c.startTime.replace(/:\d\d\s*/, ' ') : '';

        card.innerHTML = `
            <span class="mit-card-sub" style="font-size: 13.5px;">
                <span>${dateSubText}</span>
                ${levelPillHtml}
            </span>
            <span class="mit-card-title">${c.name}</span>
            <span class="mit-card-sub" style="font-weight: 500; font-size: 14px;">
                <span>${c.location} · ${timeStr || c.startTime || '11 AM'} · ${c.trainer || 'Trainer'}</span>
                <b style="color: var(--dark-blue, #005c91);">${spotsTaken}/${spotsTotal}</b>
            </span>
        `;

        card.onclick = () => selectMitSession(c.id);
        listContainer.appendChild(card);
    });
}

function selectMitSession(classId) {
    window.currentSelectedMitClassId = classId;
    const cards = document.querySelectorAll('.mit-session-card');
    cards.forEach(card => card.classList.remove('selected'));
    renderMitSidebar();
    renderMitClassView(classId);
}

async function renderMitClassView(classId = null) {
    const resolvedId = classId || window.currentSelectedMitClassId;
    const heroCourse = document.getElementById('mitHeroCourseName');
    const heroLevel = document.getElementById('mitHeroLevelPill');
    const heroStatus = document.getElementById('mitHeroStatusChip');
    const heroId = document.getElementById('mitHeroSessionId');
    const heroCenter = document.getElementById('mitHeroCenter');
    const heroTime = document.getElementById('mitHeroTime');
    const heroTrainer = document.getElementById('mitHeroTrainer');
    const heroSeats = document.getElementById('mitHeroSeatsText');
    const heroProgress = document.getElementById('mitHeroProgressBar');
    const rosterHeader = document.getElementById('mitRosterCountHeader');
    const rosterList = document.getElementById('mitRosterList');
    const emptyBanner = document.getElementById('mitOpenSeatsBanner');

    if (!heroCourse) return;

    const isDenver = isDenverActive();

    if (!resolvedId || !window.mitCalendarClassesCache || window.mitCalendarClassesCache.length === 0) {
        heroCourse.innerText = "No Session Selected";
        if (heroLevel) heroLevel.style.display = 'none';
        if (heroStatus) heroStatus.innerText = "—";
        if (heroId) heroId.innerText = "—";
        if (heroCenter) heroCenter.innerText = "—";
        if (heroTime) heroTime.innerText = "—";
        if (heroTrainer) heroTrainer.innerText = "—";
        if (heroSeats) heroSeats.innerText = "0 of 15";
        if (heroProgress) heroProgress.style.width = "0%";
        if (rosterHeader) rosterHeader.innerText = "Roster · 0 of 15";
        if (rosterList) rosterList.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--crust-deep); font-size: 16px;">Schedule or select an MIT session to view attendee roster.</div>';
        if (emptyBanner) emptyBanner.innerText = "No active session";
        return;
    }

    const cls = window.mitCalendarClassesCache.find(c => c.id === resolvedId);
    if (!cls) return;

    const dateInfo = formatMitDateDisplay(cls.classDate);

    heroCourse.innerText = cls.name || "Operations Assessment";
    heroId.innerText = cls.id || "—";
    heroCenter.innerText = cls.location || "McKinney";
    heroTime.innerText = `${cls.startTime || '11:00 AM'} – ${cls.endTime || '1:00 PM'}`;
    heroTrainer.innerText = cls.trainer || "Unassigned";

    // CRITICAL DENVER EXCEPTION: Denver does NOT do levels for their classes!
    if (heroLevel) {
        if (isDenver) {
            heroLevel.style.display = 'none';
        } else {
            heroLevel.style.display = 'inline-flex';
            const lvlNum = cls.level || 1;
            heroLevel.className = `mit-lv-pill mit-lv-${lvlNum}`;
            heroLevel.innerText = `Level ${lvlNum} · every ${lvlNum === 1 ? '4' : lvlNum === 2 ? '8' : '12'} wks`;
        }
    }

    if (heroStatus) {
        const dateText = dateInfo.formattedDate || cls.classDate || '';
        if (dateInfo.isToday) {
            heroStatus.innerText = dateText ? `${dateText} · TODAY` : "TODAY";
            heroStatus.style.background = "var(--dark-blue, #005c91)";
        } else if (dateInfo.isPast) {
            heroStatus.innerText = dateText || "PAST";
            heroStatus.style.background = "var(--crust-dark, #c0a588)";
        } else {
            heroStatus.innerText = dateText || "UPCOMING";
            heroStatus.style.background = "var(--brand-blue, #0077bd)";
        }
    }

    // Fetch Attendee Roster
    if (rosterList) {
        rosterList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--crust-deep); font-size: 15px;">Loading session attendee roster...</div>';
    }

    try {
        const res = await fetch(`/api/staffing?action=getMitRoster&classId=${encodeURIComponent(resolvedId)}`);
        const data = await res.json();
        const roster = (data.success && data.roster) ? data.roster : [];
        window.currentMitRosterCache = roster;

        const spotsTotal = cls.spotsTotal || 15;
        const spotsTaken = roster.length;
        cls.spotsTaken = spotsTaken;

        // Update Hero facts
        if (heroSeats) heroSeats.innerText = `${spotsTaken} of ${spotsTotal}`;
        if (heroProgress) {
            const pct = Math.min(100, Math.round((spotsTaken / spotsTotal) * 100));
            heroProgress.style.width = `${pct}%`;
            heroProgress.style.background = pct >= 100 ? 'var(--brand-red, #ff0000)' : 'var(--brand-blue, #0077bd)';
        }

        if (rosterHeader) {
            rosterHeader.innerText = `Roster · ${spotsTaken} of ${spotsTotal}`;
        }

        if (rosterList) {
            if (roster.length === 0) {
                rosterList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--crust-deep); font-size: 15.5px;">No trainees currently enrolled in this session.</div>';
            } else {
                rosterList.innerHTML = '';
                roster.forEach(r => {
                    const row = document.createElement('div');
                    row.className = 'mit-roster-item-row';
                    const candidateDo = r.do_name || (typeof contacts !== 'undefined' && contacts.find(c => String(c.store).trim() === String(r.store_num).trim())?.doName) || '';
                    const doText = candidateDo ? ` · DO ${candidateDo}` : '';

                    const st = (r.status || 'Enrolled').trim();
                    const isEnrolled = st === 'Enrolled' || st === 'Confirmed' || !st;
                    const isAttended = st === 'Attended';
                    const isNoShow = st === 'No Show' || st === 'Absent';
                    const isCanceled = st === 'Canceled';
                    const isCompleted = st === 'Completed';

                    row.innerHTML = `
                        <span style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-family: 'Subhead1', 'Oswald', sans-serif; font-weight: 600; font-size: 18px; color: var(--dark-blue, #005c91); line-height: 1.2;">
                                ${r.candidate_name}
                            </span>
                            <span style="font-size: 14.5px; color: var(--crust-deep, #603913); font-weight: 500;">
                                Store #${r.store_num}${doText}
                            </span>
                        </span>
                        <select class="field mit-roster-status-select" data-reg-id="${r.id}"
                            style="height: 38px; font-size: 15px; border-radius: 8px; border: 1.5px solid var(--crust-dark); background: white; color: var(--crust-burnt); padding: 0 10px; font-family: 'Condensed', sans-serif;">
                            <option value="Enrolled" ${isEnrolled ? 'selected' : ''}>Enrolled</option>
                            <option value="Attended" ${isAttended ? 'selected' : ''}>Attended</option>
                            <option value="Completed" ${isCompleted ? 'selected' : ''}>Completed</option>
                            <option value="No Show" ${isNoShow ? 'selected' : ''}>No Show</option>
                            <option value="Canceled" ${isCanceled ? 'selected' : ''}>Canceled</option>
                        </select>
                        <a href="javascript:void(0)" onclick="removeMitAttendeeFromSession('${r.id}', '${(r.candidate_name || '').replace(/'/g, "\\'")}')"
                            style="font-weight: 600; color: var(--crust-deep, #603913); font-size: 15px; text-decoration: none; text-align: right; cursor: pointer;">
                            Remove
                        </a>
                    `;
                    rosterList.appendChild(row);
                });
            }
        }

        // Open seats pattern banner
        if (emptyBanner) {
            const openSeats = Math.max(0, spotsTotal - spotsTaken);
            if (openSeats > 0) {
                emptyBanner.innerText = `${openSeats} open seat${openSeats === 1 ? '' : 's'}`;
                emptyBanner.className = 'mit-empty-seats-pattern';
            } else {
                emptyBanner.innerText = 'Session is full (0 open seats)';
                emptyBanner.className = 'mit-empty-seats-pattern';
                emptyBanner.style.background = '#faf2e9';
            }
        }

    } catch (err) {
        if (rosterList) {
            rosterList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--brand-red); font-size: 15px;">Error loading roster: ${err.message}</div>`;
        }
    }
}

async function saveCurrentMitRoster() {
    const selects = document.querySelectorAll('.mit-roster-status-select');
    if (selects.length === 0) {
        showBrandAlert("No candidates in this session roster to save.", "Roster Empty");
        return;
    }

    const registrations = [];
    selects.forEach(sel => {
        const regId = sel.dataset.regId;
        if (regId) {
            registrations.push({ id: regId, status: sel.value });
        }
    });

    showLoader(true, "Saving MIT roster attendance...");
    try {
        const res = await fetch('/api/staffing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'saveMitAttendance', registrations })
        });
        const data = await res.json();
        showLoader(false);

        if (data.success) {
            showBrandAlert("Session roster saved successfully!", "Roster Updated");
            renderMitClassView(window.currentSelectedMitClassId);
            updateMitAuditMetrics();
        } else {
            showBrandAlert(data.error || "Failed to save roster.", "Error");
        }
    } catch (err) {
        showLoader(false);
        showBrandAlert("Error saving roster: " + err.message, "System Error");
    }
}

function editCurrentMitSession() {
    if (!window.currentSelectedMitClassId) {
        showBrandAlert("Please select an MIT session to edit.", "No Session Selected");
        return;
    }
    openMitClassModal(window.currentSelectedMitClassId);
}

async function cancelCurrentMitSession() {
    if (!window.currentSelectedMitClassId) {
        showBrandAlert("Please select an MIT session to cancel.", "No Session Selected");
        return;
    }
    const cls = (window.mitCalendarClassesCache || []).find(c => c.id === window.currentSelectedMitClassId);
    const courseName = cls ? cls.name : "this MIT session";
    const classDate = cls ? cls.classDate : "";
    await deleteMitClassSession(window.currentSelectedMitClassId, classDate, courseName);
}

async function removeMitAttendeeFromSession(regId, candidateName) {
    const confirmed = await showBrandConfirm(`Remove ${candidateName} from this MIT session? This will free up a seat.`, "Remove Trainee");
    if (!confirmed) return;

    showLoader(true, "Removing attendee...");
    try {
        const res = await fetch('/api/staffing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'removeMitAttendee',
                registrationId: regId,
                classId: window.currentSelectedMitClassId
            })
        });
        const data = await res.json();
        showLoader(false);

        if (data.success) {
            showBrandAlert(`${candidateName} has been removed from the session.`, "Attendee Removed");
            fetchMitSchedulerClasses();
        } else {
            showBrandAlert(data.error || "Failed to remove attendee.", "Error");
        }
    } catch (err) {
        showLoader(false);
        showBrandAlert("Error removing attendee: " + err.message, "System Error");
    }
}

function updateMitAuditMetrics() {
    const classes = window.mitCalendarClassesCache || [];
    const upcomingCountEl = document.getElementById('mitAuditUpcomingCount');
    const seatsFilledEl = document.getElementById('mitAuditSeatsFilled');
    const mitsInProgressEl = document.getElementById('mitAuditMitsInProgress');
    const under3SeatsEl = document.getElementById('mitAuditUnder3Seats');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const in30Days = todayStart + (30 * 24 * 60 * 60 * 1000);

    let upcomingCount = 0;
    let seatsTaken30 = 0;
    let seatsTotal30 = 0;
    let under3Count = 0;

    classes.forEach(c => {
        const ts = getMitClassTimestamp(c);
        if (ts >= todayStart) {
            upcomingCount++;
            const taken = c.spotsTaken || 0;
            const total = c.spotsTotal || 15;
            if (taken < 3) under3Count++;
            if (ts <= in30Days) {
                seatsTaken30 += taken;
                seatsTotal30 += total;
            }
        }
    });

    // Count MITs in progress from candidates roster
    let mitsInProgress = 0;
    if (typeof candidates !== 'undefined' && Array.isArray(candidates)) {
        mitsInProgress = candidates.filter(c => {
            const pos = String(c.position || '').toUpperCase();
            const isMit = pos.includes('MIT') || pos.includes('MANAGER IN TRAINING') || String(c.status || '').toUpperCase().includes('MIT');
            const isActive = !c.hired && !c.ineligible && !c.inactive && !c.withdrawn;
            return isMit && isActive;
        }).length;
    }

    if (upcomingCountEl) upcomingCountEl.innerText = upcomingCount;
    if (seatsFilledEl) seatsFilledEl.innerText = `${seatsTaken30} / ${seatsTotal30}`;
    if (mitsInProgressEl) mitsInProgressEl.innerText = mitsInProgress;
    if (under3SeatsEl) under3SeatsEl.innerText = under3Count;
}

function openMitEnrollModal() {
    if (!window.currentSelectedMitClassId) {
        showBrandAlert("Please select an MIT session to enroll candidates.", "No Session Selected");
        return;
    }
    const cls = (window.mitCalendarClassesCache || []).find(c => c.id === window.currentSelectedMitClassId);
    if (!cls) return;

    const modal = document.getElementById('mitEnrollModal');
    if (!modal) return;

    document.getElementById('mitEnrollModalSubtitle').innerText = `${cls.name} · ${cls.classDate} @ ${cls.startTime} (${cls.location})`;
    
    // Populate quick-select dropdown
    const selectEl = document.getElementById('mitEnrollCandidateSelect');
    if (selectEl) {
        selectEl.innerHTML = '<option value="">-- Choose from active candidates or enter below --</option>';
        const activeOnb = (typeof candidates !== 'undefined' && Array.isArray(candidates)) ? candidates.filter(c => !c.hired && !c.ineligible && !c.inactive) : [];
        activeOnb.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = `${c.name} (Store #${c.store || '—'} · ${c.position || 'Onboarding'})`;
            selectEl.appendChild(opt);
        });
    }

    document.getElementById('mitEnrollName').value = '';
    document.getElementById('mitEnrollStore').value = '';
    document.getElementById('mitEnrollPosition').value = isDenverActive() ? 'MIT' : 'MIT 1';
    document.getElementById('mitEnrollPhone').value = '';
    document.getElementById('mitEnrollEmail').value = '';

    modal.classList.remove('hidden');
}

function closeMitEnrollModal() {
    const modal = document.getElementById('mitEnrollModal');
    if (modal) modal.classList.add('hidden');
}

function onMitEnrollCandidateSelected() {
    const selectEl = document.getElementById('mitEnrollCandidateSelect');
    const candidateId = selectEl ? selectEl.value : '';
    if (!candidateId) return;

    const cand = (typeof candidates !== 'undefined' && Array.isArray(candidates)) ? candidates.find(c => c.id === candidateId) : null;
    if (!cand) return;

    document.getElementById('mitEnrollName').value = cand.name || '';
    document.getElementById('mitEnrollStore').value = cand.store || '';
    document.getElementById('mitEnrollPosition').value = cand.position || (isDenverActive() ? 'MIT' : 'MIT 1');
    document.getElementById('mitEnrollPhone').value = cand.phone || '';
    document.getElementById('mitEnrollEmail').value = cand.email || '';
}

async function submitMitCandidateEnrollment() {
    const classId = window.currentSelectedMitClassId;
    const name = document.getElementById('mitEnrollName').value.trim();
    const storeNum = document.getElementById('mitEnrollStore').value.trim();
    const position = document.getElementById('mitEnrollPosition').value.trim() || 'MIT';
    const phone = document.getElementById('mitEnrollPhone').value.trim();
    const email = document.getElementById('mitEnrollEmail').value.trim();
    const candidateId = document.getElementById('mitEnrollCandidateSelect').value || '';

    if (!classId || !name || !storeNum) {
        showBrandAlert("Please enter both trainee name and store number.", "Missing Details");
        return;
    }

    showLoader(true, "Enrolling MIT trainee...");
    try {
        const res = await fetch('/api/staffing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'registerMitClass',
                classId: classId,
                name: name,
                storeNum: storeNum,
                position: position,
                phone: phone,
                email: email,
                candidateId: candidateId
            })
        });
        const data = await res.json();
        showLoader(false);

        if (data.success) {
            closeMitEnrollModal();
            showBrandAlert(`${name} enrolled into MIT session successfully!`, "Enrolled");
            fetchMitSchedulerClasses();
        } else {
            showBrandAlert(data.error || "Failed to enroll candidate.", "Enrollment Error");
        }
    } catch (err) {
        showLoader(false);
        showBrandAlert("Error enrolling candidate: " + err.message, "System Error");
    }
}

function openMitScheduleSummaryModal() {
    const modal = document.getElementById('mitScheduleSummaryModal');
    if (!modal) return;

    const isDenver = isDenverActive();
    const thLevel = document.getElementById('mitModalThLevel');
    if (thLevel) {
        thLevel.innerText = isDenver ? 'Course' : 'Course & Level';
    }

    const tbody = document.getElementById('mitScheduleSummaryTableBody');
    if (tbody) {
        const classes = (window.mitCalendarClassesCache || []).slice();
        classes.sort((a, b) => getMitClassTimestamp(a) - getMitClassTimestamp(b));

        if (classes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--crust-deep);">No scheduled classes found.</td></tr>';
        } else {
            tbody.innerHTML = '';
            classes.forEach(c => {
                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid var(--crust-med)';

                let levelPill = '';
                if (!isDenver) {
                    levelPill = `<span class="mit-lv-pill mit-lv-${c.level || 1}" style="margin-left: 6px;">L${c.level || 1}</span>`;
                }

                const spotsTaken = c.spotsTaken || 0;
                const spotsTotal = c.spotsTotal || 15;

                row.innerHTML = `
                    <td style="padding: 10px 12px; font-weight: bold; color: var(--dark-blue); font-size: 15px;">
                        ${c.classDate} <br>
                        <span style="font-size: 11.5px; color: var(--crust-deep); font-family: monospace;">${c.id}</span>
                    </td>
                    <td style="padding: 10px 12px; font-size: 15.5px; font-weight: 600;">
                        ${c.name} ${levelPill}
                    </td>
                    <td style="padding: 10px 12px; text-align: center; font-size: 14.5px;">
                        <strong>${c.location}</strong><br>
                        <span style="color: var(--dark-blue);">${c.startTime} - ${c.endTime}</span>
                    </td>
                    <td style="padding: 10px 12px; text-align: center; font-size: 14.5px;">
                        ${c.trainer || 'Unassigned'}
                    </td>
                    <td style="padding: 10px 12px; text-align: center; font-weight: bold; color: var(--dark-blue);">
                        ${spotsTaken} / ${spotsTotal}
                    </td>
                    <td style="padding: 10px 12px; text-align: center;">
                        <button type="button" onclick="closeMitScheduleSummaryModal(); selectMitSession('${c.id}');" class="btn p"
                            style="padding: 5px 12px; font-size: 13.5px; cursor: pointer;">
                            View
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
    }

    modal.classList.remove('hidden');
}

function closeMitScheduleSummaryModal() {
    const modal = document.getElementById('mitScheduleSummaryModal');
    if (modal) modal.classList.add('hidden');
}

function openMitClassModal(editClassId = null) {
    const modal = document.getElementById('mitClassModal');
    if (!modal) return;

    const isDenver = isDenverActive();
    const levelGroup = document.getElementById('mitModalLevelGroup');
    if (levelGroup) {
        levelGroup.style.display = isDenver ? 'none' : '';
    }

    document.getElementById('mitModalTitle').innerText = editClassId ? "✏️ Edit MIT Class Session" : "➕ Schedule New MIT Class Session";
    document.getElementById('mitEditClassId').value = editClassId || "";

    if (editClassId && window.mitCalendarClassesCache) {
        const cls = window.mitCalendarClassesCache.find(c => c.id === editClassId);
        if (cls) {
            const parts = (cls.classDate || '').split('/');
            if (parts.length === 3) {
                const y = parts[2];
                const m = parts[0].padStart(2, '0');
                const d = parts[1].padStart(2, '0');
                document.getElementById('mitModalDate').value = `${y}-${m}-${d}`;
            }
            document.getElementById('mitModalCourse').value = cls.name || (isDenver ? "Creating a Schedule/Labor Class" : "Operations Assessment");
            document.getElementById('mitModalLevel').value = cls.level || "1";
            document.getElementById('mitModalLocation').value = cls.location || (isDenver ? "Academy" : "McKinney");
            document.getElementById('mitModalTrainer').value = cls.trainer || (isDenver ? "Nick" : "Rebecca");
            document.getElementById('mitModalStart').value = cls.startTime || "11:00 AM";
            document.getElementById('mitModalEnd').value = cls.endTime || "1:00 PM";
            document.getElementById('mitModalCapacity').value = cls.spotsTotal || 15;
            document.getElementById('mitModalMeetLink').value = cls.meetLink || "";
        }
    } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        document.getElementById('mitModalDate').value = tomorrow.toISOString().split('T')[0];
        document.getElementById('mitModalCourse').value = isDenver ? "Creating a Schedule/Labor Class" : "Operations Assessment";
        document.getElementById('mitModalLevel').value = "1";
        document.getElementById('mitModalLocation').value = isDenver ? "Academy" : "McKinney";
        document.getElementById('mitModalTrainer').value = isDenver ? "Nick" : "Rebecca";
        document.getElementById('mitModalStart').value = "11:00 AM";
        document.getElementById('mitModalEnd').value = "1:00 PM";
        document.getElementById('mitModalCapacity').value = 15;
        document.getElementById('mitModalMeetLink').value = "";
    }

    modal.classList.remove('hidden');
}

function closeMitClassModal() {
    const modal = document.getElementById('mitClassModal');
    if (modal) modal.classList.add('hidden');
}

function onMitCourseChange() {
    if (isDenverActive()) return; // Denver has no levels
    const course = document.getElementById('mitModalCourse').value;
    const lvlSelect = document.getElementById('mitModalLevel');
    if (course === 'Customer Experience' || course === 'Operations Assessment' || course === 'Product Quality') {
        lvlSelect.value = "1";
    } else if (course === 'Smooth Operator' || course === 'Train the Trainer') {
        lvlSelect.value = "2";
    } else if (course === 'Cost Management' || course === 'P&L') {
        lvlSelect.value = "3";
    }
}

async function saveMitClassSession() {
    const classId = document.getElementById('mitEditClassId').value;
    const rawDate = document.getElementById('mitModalDate').value;
    const name = document.getElementById('mitModalCourse').value;
    const level = document.getElementById('mitModalLevel').value;
    const location = document.getElementById('mitModalLocation').value;
    const trainer = document.getElementById('mitModalTrainer').value.trim();
    const startTime = document.getElementById('mitModalStart').value.trim();
    const endTime = document.getElementById('mitModalEnd').value.trim();
    const capacity = document.getElementById('mitModalCapacity').value;
    const meetLink = document.getElementById('mitModalMeetLink').value.trim();

    if (!rawDate) {
        showBrandAlert("Please select a date for this session.", "Missing Date");
        return;
    }

    const [year, month, day] = rawDate.split('-');
    const formattedDateStr = `${parseInt(month, 10)}/${parseInt(day, 10)}/${year}`;

    if (classId && window.mitCalendarClassesCache) {
        const cls = window.mitCalendarClassesCache.find(c => c.id === classId);
        if (cls && cls.classDate && cls.classDate !== formattedDateStr) {
            const attendeesCount = (cls.attendees || []).length;
            let confirmMsg = `You are rescheduling this ${name} session from ${cls.classDate} to ${formattedDateStr}.`;
            if (attendeesCount > 0) {
                confirmMsg = `This session has ${attendeesCount} enrolled attendee(s).\n\nMoving this class to ${formattedDateStr} will update their records and automatically email each trainee an updated Change of Date notice with course and location details. Proceed?`;
            }
            const confirmed = await showBrandConfirm(confirmMsg, "Reschedule MIT Session");
            if (!confirmed) return;
        }
    }

    showLoader(true, classId ? "Updating MIT session..." : "Adding MIT session...");

    try {
        const action = classId ? 'updateMitClass' : 'addMitClass';
        const payload = {
            action: action,
            classId: classId || undefined,
            classDate: formattedDateStr,
            name: name,
            level: isDenverActive() ? 1 : parseInt(level, 10),
            location: location,
            trainer: trainer,
            startTime: startTime,
            endTime: endTime,
            capacity: parseInt(capacity, 10),
            meetLink: meetLink,
            notifyAttendees: true
        };

        const res = await fetch('/api/staffing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        showLoader(false);

        if (data.success) {
            closeMitClassModal();
            showBrandAlert(classId ? "MIT class updated successfully!" : "New MIT class session added!", "Success");
            if (data.id) window.currentSelectedMitClassId = data.id;
            fetchMitSchedulerClasses();
        } else {
            showBrandAlert(data.error || "Failed to save session.", "Error");
        }
    } catch (err) {
        showLoader(false);
        showBrandAlert("Error saving class: " + err.message, "System Error");
    }
}

async function deleteMitClassSession(classId, classDate, courseName) {
    const confirmed = await showBrandConfirm(`Cancel session for ${courseName || 'this class'} on ${classDate || ''}? This will deactivate it from signups.`, "Deactivate Session");
    if (!confirmed) return;

    showLoader(true, "Deactivating session...");
    try {
        const res = await fetch('/api/staffing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deleteMitClass', classId: classId })
        });
        const data = await res.json();
        showLoader(false);
        if (data.success) {
            showBrandAlert("Session canceled and removed.", "Deactivated");
            window.currentSelectedMitClassId = null;
            fetchMitSchedulerClasses();
        } else {
            showBrandAlert(data.error || "Failed to cancel session.", "Error");
        }
    } catch (err) {
        showLoader(false);
        showBrandAlert("Error: " + err.message, "System Error");
    }
}

async function openMitRosterModal(classId, className, classDate, startTime) {
    const modal = document.getElementById('mitRosterModal');
    if (!modal) return;

    document.getElementById('mitRosterModalTitle').innerText = `👥 Roster: ${className}`;
    document.getElementById('mitRosterModalSubtitle').innerText = `${classDate} @ ${startTime} • ID: ${classId}`;
    const tbody = document.getElementById('mitRosterTableBody');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; color:#888;">Loading attendee roster...</td></tr>`;

    modal.classList.remove('hidden');

    try {
        const res = await fetch(`/api/staffing?action=getMitRoster&classId=${encodeURIComponent(classId)}`);
        const data = await res.json();
        if (!data.success || !data.roster || data.roster.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 25px; color:#888;">No candidates currently registered for this session.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        data.roster.forEach(r => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid var(--crust-med)';
            row.innerHTML = `
                <td style="padding: 10px 12px; font-weight: bold; color: var(--dark-blue); font-size: 16px;">${r.candidate_name}</td>
                <td style="padding: 10px 12px; text-align: center; font-size: 15px;">Store #${r.store_num}</td>
                <td style="padding: 10px 12px; text-align: center; font-size: 15px;">${r.position || 'MIT 1'}</td>
                <td style="padding: 10px 12px; text-align: center; font-size: 15px;">
                    ${r.phone ? `<a href="tel:${r.phone}" style="color: var(--dark-blue); font-weight: bold; text-decoration: none;">📞 ${r.phone}</a>` : '—'}
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    <span style="display: inline-block; padding: 3px 8px; border-radius: 10px; font-family: 'Subhead2'; font-size: 12px; background: var(--crust-light); color: var(--dark-blue); border: 1px solid var(--dark-blue);">
                        ${r.status || 'Confirmed'}
                    </span>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; color: var(--brand-red);">Error loading roster: ${err.message}</td></tr>`;
    }
}

function closeMitRosterModal() {
    const modal = document.getElementById('mitRosterModal');
    if (modal) modal.classList.add('hidden');
}

// Explicit window bindings for safety across scopes
window.isDenverActive = isDenverActive;
window.getMitClassTimestamp = getMitClassTimestamp;
window.formatMitDateDisplay = formatMitDateDisplay;
window.fetchMitSchedulerClasses = fetchMitSchedulerClasses;
window.renderMitSidebar = renderMitSidebar;
window.selectMitSession = selectMitSession;
window.renderMitClassView = renderMitClassView;
window.saveCurrentMitRoster = saveCurrentMitRoster;
window.editCurrentMitSession = editCurrentMitSession;
window.cancelCurrentMitSession = cancelCurrentMitSession;
window.removeMitAttendeeFromSession = removeMitAttendeeFromSession;
window.updateMitAuditMetrics = updateMitAuditMetrics;
window.openMitEnrollModal = openMitEnrollModal;
window.closeMitEnrollModal = closeMitEnrollModal;
window.onMitEnrollCandidateSelected = onMitEnrollCandidateSelected;
window.submitMitCandidateEnrollment = submitMitCandidateEnrollment;
window.openMitScheduleSummaryModal = openMitScheduleSummaryModal;
window.closeMitScheduleSummaryModal = closeMitScheduleSummaryModal;
window.openMitClassModal = openMitClassModal;
window.closeMitClassModal = closeMitClassModal;
window.onMitCourseChange = onMitCourseChange;
window.saveMitClassSession = saveMitClassSession;
window.deleteMitClassSession = deleteMitClassSession;
window.openMitRosterModal = openMitRosterModal;
window.closeMitRosterModal = closeMitRosterModal;
