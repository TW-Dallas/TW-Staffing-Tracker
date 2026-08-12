// ==========================================
// CONFIGURATION
// ==========================================
const DALLAS_SHEET_ID = "1HBsLJNP0a7O6NkFMgkVx60D15EU3DyRJO49Xz--Uykk";
const SHEET_ID = DALLAS_SHEET_ID;
const DENVER_SHEET_ID = "1lrUA8IU7FutR-fWQ-seh0orp0jhAP-aEFWdm0VGIqmc";

function getSpreadsheetForCity(city) {
  const isDenver = (city || "").toLowerCase() === "denver";
  return SpreadsheetApp.openById(isDenver ? DENVER_SHEET_ID : DALLAS_SHEET_ID);
} 
const HIRING_DATA_SHEET_NAME = "Hiring Data (2026)";
const DENVER_HIRING_DATA_SHEET_NAME = "Denver Hiring Data (2026)";

// Configure Market Permissions
const ADMIN_USERS = {
  "denver_admin": { password: "denver_password_123", sheet: "Denver Info", staffingSheet: DENVER_HIRING_DATA_SHEET_NAME },
  "dallas_admin": { password: "dallas_password_123", sheet: "Dallas Info", staffingSheet: HIRING_DATA_SHEET_NAME }
};

// Official Domino's 2026 Fiscal Calendar (P01 - P13)
const DOMINOS_FISCAL_2026 = [
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
  { period: "P13", start: "2026-11-30", end: "2026-12-27" }
];

// Fast Native JS Date Formatter
function formatCellDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return (val.getMonth() + 1) + "/" + val.getDate() + "/" + val.getFullYear();
  }
  var str = String(val).trim();
  if (/^\d{5}$/.test(str)) {
    var num = parseInt(str, 10);
    var d = new Date(Math.round((num - 25569) * 86400 * 1000));
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear();
  }
  return str;
}

function formatCellDateTime(val) {
  if (!val) return "";
  let d = null;
  if (val instanceof Date) {
    d = val;
  } else {
    var str = String(val).trim();
    if (!str) return "";
    if (/^\d{5}(\.\d+)?$/.test(str)) {
      var num = parseFloat(str);
      d = new Date(Math.round((num - 25569) * 86400 * 1000));
    } else {
      d = new Date(str);
    }
  }
  if (!d || isNaN(d.getTime())) return String(val).trim();
  
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const yr = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${m}/${day}/${yr} ${hours}:${minutes} ${ampm}`;
}

function authenticateUser(rawUsername, rawPassword) {
  if (!rawUsername || !rawPassword) return null;
  const username = rawUsername.toString().trim().toLowerCase();
  const password = rawPassword.toString().trim();
  const user = ADMIN_USERS[username];
  if (user && user.password === password) {
    return { key: username, ...user };
  }
  return null;
}

// Ultra-Fast Native JS Fiscal Period Calculator (0.0001 ms per call)
function calculateDominosPeriod(dateInput) {
  if (!dateInput) return "P08";
  let d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "P08";
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const formatted = `${yyyy}-${mm}-${dd}`;
  
  for (let i = 0; i < DOMINOS_FISCAL_2026.length; i++) {
    if (formatted >= DOMINOS_FISCAL_2026[i].start && formatted <= DOMINOS_FISCAL_2026[i].end) {
      return DOMINOS_FISCAL_2026[i].period;
    }
  }
  return "P08";
}

function lookupStoreInfo(ss, storeNum, targetSheetName) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const isDenver = targetSheetName ? targetSheetName.toLowerCase().includes("denver") : false;
  const prefix = isDenver ? "Denver" : "Dallas";
  const lookupSheetName = prefix + " GM-DO Info";
  
  const sheet = ss.getSheetByName(lookupSheetName);
  if (!sheet) return null;
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  
  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = 0; i < values.length; i++) {
    const currentStore = String(values[i][1] || "").trim();
    if (currentStore === storeNum.toString().trim()) {
      return {
        doName: String(values[i][0] || "").trim(),      
        storeNum: currentStore,           
        address: String(values[i][2] || "").trim(),     
        storePhone: String(values[i][3] || "").trim(),  
        gmName: String(values[i][4] || "").trim(),      
        gmPhone: String(values[i][5] || "").trim(),     
        storeEmail: String(values[i][6] || "").trim(),  
        doEmail: String(values[i][7] || "").trim()      
      };
    }
  }
  return null;
}

// ==========================================
// 1. GET DATA (Read Operations - Sub-Second)
// ==========================================
function doGet(e) {
  try {
    const username = e && e.parameter ? e.parameter.username : "";
    const password = e && e.parameter ? e.parameter.password : "";

    const user = authenticateUser(username, password);
    if (!user) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Invalid username or password." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const city = (e && e.parameter && e.parameter.city) ? e.parameter.city : (user.key.startsWith("denver") ? "Denver" : "Dallas");

    const action = e && e.parameter ? e.parameter.action : "";
    if (action === "login") {
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Authenticated successfully", city: city, user: user.key }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // OPEN SPREADSHEET ONCE FOR ALL GETTERS
    const ss = getSpreadsheetForCity(city);
    const sheetName = user.sheet;
    
    const data = {};
    data.onboarding = getOnboardingData(ss, sheetName);
    data.contacts = getContactsData(ss, sheetName);
    data.interviews = (city.toLowerCase() === "dallas") ? getInterviewData(ss) : [];
    data.staffing = getStaffingDataAndBackfillIDs(ss, user.staffingSheet);

    const scratchData = getScratchpadData(ss, sheetName);
    data.scratchpadText = scratchData.text;
    data.scratchpadChecklist = scratchData.checklist;
    data.version = "v125-check";
    
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOnboardingData(ss, sheetName) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  if (!sheetName) sheetName = "Dallas Info";
  
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const isDenver = sheetName === "Denver Info";
  const rosterSheetName = isDenver ? "Denver Roster" : "Dallas Roster";
  const rosterSheet = ss.getSheetByName(rosterSheetName);
  const attendanceMap = {};
  const ntoDateMap = {};
  const rosterEntries = [];

  if (rosterSheet && rosterSheet.getLastRow() >= 2) {
    const rosterValues = rosterSheet.getRange(2, 1, rosterSheet.getLastRow() - 1, 11).getValues();
    // Iterate from NEWEST (bottom row) to OLDEST (top row) so latest attendance status takes precedence
    for (let r = rosterValues.length - 1; r >= 0; r--) {
      const row = rosterValues[r];
      const rId = String(row[0] || "").trim();
      const rName = String(row[1] || "").trim();
      const rEmail = String(row[3] || "").trim().toLowerCase();
      const rDate = formatCellDate(row[4]);
      const rAtt = String(row[9] || "").trim();

      if (rAtt) {
        if (rId && !attendanceMap[rId]) attendanceMap[rId] = rAtt;
        if (rEmail && !attendanceMap[rEmail]) attendanceMap[rEmail] = rAtt;
        if (rName && !attendanceMap[rName.toLowerCase()]) attendanceMap[rName.toLowerCase()] = rAtt;
      }
      if (rDate) {
        if (rId && !ntoDateMap[rId]) ntoDateMap[rId] = rDate;
        if (rEmail && !ntoDateMap[rEmail]) ntoDateMap[rEmail] = rDate;
        if (rName && !ntoDateMap[rName.toLowerCase()]) ntoDateMap[rName.toLowerCase()] = rDate;
      }
      rosterEntries.push({ id: rId, name: rName, email: rEmail, date: rDate, att: rAtt });
    }
  }

  // ULTRA-FAST READ: getValues()
  const displayValues = sheet.getRange(2, 1, lastRow - 1, 32).getValues();
  const isTrue = (val) => val === true || (val && String(val).toUpperCase() === "TRUE");

  const seenKeys = new Set();
  const onboardingData = [];

  // Iterate from newest (bottom) to oldest (top) so newest record wins and duplicates are filtered out
  for (let i = displayValues.length - 1; i >= 0; i--) {
    const row = displayValues[i];
    const sheetRow = i + 2;
    const candName = String(row[1] || "").trim();
    if (!candName) continue;

    const candNameLower = candName.toLowerCase();
    const candEmailLower = String(row[11] || "").trim().toLowerCase();
    let rowId = String(row[0] || "").trim();

    // Auto-generate missing ID in memory (do not write to sheet Column A to preserve formula-imported columns)
    if (!rowId) {
      rowId = "ID-" + (i + 2) + "-" + candNameLower.replace(/[^a-z0-9]/g, "");
    }

    // Deduplication Key: Name + Store Number
    const dedupKey = candNameLower + "_" + String(row[3] || "").trim().toLowerCase();
    if (!seenKeys.has(dedupKey)) {
      seenKeys.add(dedupKey);

      const rawMissingDocs = row[23] ? String(row[23]).trim() : "";
      const hasMissingDocs = rawMissingDocs !== "" && rawMissingDocs.toUpperCase() !== "FALSE";
      const missingDocsText = (hasMissingDocs && rawMissingDocs.toUpperCase() !== "TRUE") ? rawMissingDocs : "";

      let resolvedAtt = attendanceMap[rowId] || attendanceMap[candEmailLower] || attendanceMap[candNameLower] || "";
      let resolvedNtoDate = formatCellDate(row[5]) || ntoDateMap[rowId] || ntoDateMap[candEmailLower] || ntoDateMap[candNameLower] || "";

      if (!resolvedAtt || !resolvedNtoDate) {
        for (let k = 0; k < rosterEntries.length; k++) {
          const entry = rosterEntries[k];
          if (isFuzzyNameMatch(candName, entry.name)) {
            if (!resolvedAtt && entry.att) resolvedAtt = entry.att;
            if (!resolvedNtoDate && entry.date) resolvedNtoDate = entry.date;
            if (resolvedAtt && resolvedNtoDate) break;
          }
        }
      }

      onboardingData.unshift({
        id: rowId,
        name: candName,
        position: String(row[2] || "").trim(),
        store: String(row[3] || "").trim(),
        doName: String(row[4] || "").trim(),
        ntoDate: resolvedNtoDate,
        notes: String(row[6] || "").trim(),
        shirtSize: String(row[7] || "").trim(),
        payCard: String(row[8] || "").trim(),
        lastUpdated: formatCellDateTime(row[9]),
        phoneNumber: String(row[10] || "").trim(),
        email: String(row[11] || "").trim(),
        submissionReceived: isTrue(row[12]),
        onboardingSent: isTrue(row[13]),
        bgcComplete: isTrue(row[14]),
        allPayCompleted: isTrue(row[15]),
        ntoSignupLinkSent: isTrue(row[16]),
        ntoScheduled: isTrue(row[17]) || (resolvedNtoDate !== "" && !resolvedNtoDate.toUpperCase().includes("MISSING")),
        hired: isTrue(row[18]),
        incorrectEmail: isTrue(row[19]),
        ineligible: isTrue(row[21]),
        inactive: isTrue(row[22]),
        missingDocs: rawMissingDocs,
        hasMissingDocs: hasMissingDocs,
        missingDocsText: missingDocsText,
        pulseFormComplete: isTrue(row[24]),
        hatStyle: String(row[25] || "").trim(),
        missedNto: isTrue(row[26]),
        ntoAttendance: resolvedAtt,
        cardReceived: isTrue(row[27]),
        registered: isTrue(row[28]),
        ddReceived: isTrue(row[29]),
        ddEntered: isTrue(row[30]),
        noticeSentDate: formatCellDate(row[31])
      });
    }
  }

  return onboardingData;
}

function getInterviewData(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Dallas Interviews");
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const values = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
  return values.map((row, index) => ({
    id: String(row[15] || "").trim() || ("INT-ID-TEMP-" + index),
    doName: String(row[0] || "").trim(),
    store: String(row[1] || "").trim(),
    name: String(row[2] || "").trim(),
    position: String(row[3] || "").trim(),
    phoneNumber: String(row[4] || "").trim(),
    email: String(row[5] || "").trim(),
    date: formatCellDate(row[6]),
    day: String(row[7] || "").trim(),
    time: formatCellTime(row[8]),
    status: String(row[9] || "").trim(),
    gmDate: formatCellDate(row[10]),
    gmTime: formatCellTime(row[11]),
    statusUpdates: String(row[12] || "").trim(),
    availability: String(row[13] || "").trim(),
    notes: String(row[14] || "").trim()
  })).filter(item => item.name !== "");
}

function getStaffingDataAndBackfillIDs(ss, sheetName) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  if (!sheetName) sheetName = HIRING_DATA_SHEET_NAME;
  
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const values = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  return values.map((row, index) => {
    const itemID = String(row[11] || "").trim() || ("STF-ID-TEMP-" + (index + 2));
    const hireDate = formatCellDate(row[5]);
    const termDate = formatCellDate(row[6]);
    const periodVal = String(row[0] || "").trim();
    const computedPeriod = periodVal || calculateDominosPeriod(termDate || hireDate);

    return {
      period: computedPeriod,
      doName: String(row[1] || "").trim(),
      store: String(row[2] || "").trim(),
      name: String(row[3] || "").trim(),
      position: String(row[4] || "").trim(),
      hireDate: hireDate,
      termDate: termDate,
      rehireEligible: String(row[7] || "").trim() || "Yes",
      causeOfAction: String(row[8] || "").trim(),
      reasonOfAction: String(row[9] || "").trim(),
      notes: String(row[10] || "").trim(),
      id: itemID,
      lastUpdated: formatCellDate(row[12]),
      gmName: String(row[13] || "").trim()
    };
  }).filter(item => item.name !== "");
}

function getContactsData(ss, sheetName) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const isDenver = sheetName ? sheetName.toLowerCase().includes("denver") : false;
  const prefix = isDenver ? "Denver" : "Dallas";
  const lookupSheetName = prefix + " GM-DO Info";
  
  const sheet = ss.getSheetByName(lookupSheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  return values.map(row => ({
    doName: String(row[0] || "").trim(),
    store: String(row[1] || "").trim(),
    address: String(row[2] || "").trim(),
    storePhone: String(row[3] || "").trim(),
    manager: String(row[4] || "").trim(),
    gmPhone: String(row[5] || "").trim(),
    storeEmail: String(row[6] || "").trim(),
    doEmail: String(row[7] || "").trim(),
    ipAddress: String(row[8] || "").trim(),
    doCell: String(row[9] || "").trim()
  })).filter(c => c.store !== "");
}

function getAdminContactsData(ss, sheetName) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const prefix = sheetName ? (sheetName.toLowerCase().includes("denver") ? "Denver" : "Dallas") : "Dallas";
  
  let sheet = ss.getSheetByName(prefix + " Admin Info") 
           || ss.getSheetByName("Dallas Admin Info")
           || ss.getSheetByName(prefix + " Admin Contacts")
           || ss.getSheetByName("Admin Info");

  if (!sheet) {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const name = sheets[i].getName().trim().toLowerCase();
      if (name.includes("admin info") || name.includes("admin contacts")) {
        sheet = sheets[i];
        break;
      }
    }
  }

  if (!sheet || sheet.getLastRow() < 2) return [];
  
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  return values.map(row => ({
    category: String(row[0] || "").trim(),
    name: String(row[1] || "").trim(),
    title: String(row[2] || "").trim(),
    phone: String(row[3] || "").trim(),
    email: String(row[4] || "").trim(),
    notes: String(row[5] || "").trim()
  })).filter(c => c.name !== "" || c.category !== "" || c.title !== "" || c.phone !== "");
}

function getScratchpadData(ss, sheetName) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const prefix = sheetName ? (sheetName.toLowerCase().includes("denver") ? "Denver" : "Dallas") : "Dallas";
  const scratchSheetName = prefix + " Scratchpad";
  let sheet = ss.getSheetByName(scratchSheetName);
  
  // Read-only check: Never insert sheets or write during doGet
  if (!sheet || sheet.getLastRow() < 2) {
    return { text: "", checklist: "[]" };
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  let textContent = "";
  const checklistArr = [];

  values.forEach((row, i) => {
    const type = String(row[0] || "").trim().toLowerCase();
    const content = String(row[1] || "");
    const isDone = row[2] === true || String(row[2]).toUpperCase() === "TRUE";
    const itemId = row[3] || ("item_" + i);

    if (type === "text") textContent = content;
    else if (type === "checklist" && content.trim() !== "") {
      checklistArr.push({ id: itemId, text: content, done: isDone });
    }
  });

  return { text: textContent, checklist: JSON.stringify(checklistArr) };
}

// ==========================================
// 2. POST DATA (Write & Read Router)
// ==========================================
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const user = authenticateUser(params.username, params.password);
    if (!user) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Unauthorized access credentials" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    const isDenverUser = user.key.startsWith("denver");
    const ss = SpreadsheetApp.openById(isDenverUser ? DENVER_SHEET_ID : SHEET_ID);

    // 🚀 READ DATA ROUTE (Bypasses GET 302/404 Proxy Issues)
    if (params.action === "getData" || params.action === "fetchData" || !params.action) {
      const data = {};
      data.onboarding = getOnboardingData(ss, user.sheet);
      data.contacts = getContactsData(ss, user.sheet);
      data.adminContacts = getAdminContactsData(ss, user.sheet);
      data.interviews = (user.key.startsWith("dallas")) ? getInterviewData(ss) : [];
      data.staffing = getStaffingDataAndBackfillIDs(ss, user.staffingSheet);

      const scratchData = getScratchpadData(ss, user.sheet);
      data.scratchpadText = scratchData.text;
      data.scratchpadChecklist = scratchData.checklist;

      return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Explicit Action Routes
    if (params.action === "getNtoClasses") return getNtoClassesHandler(params);
    if (params.action === "addNtoClass") return addNtoClassHandler(params);
    if (params.action === "deleteNtoClass") return deleteNtoClassHandler(params);
    if (params.action === "sendNtoMeetLinks") return sendNtoMeetLinksHandler(params);
    if (params.action === "concludeNtoClass") return concludeNtoClassHandler(params);
    if (params.action === "saveNtoAttendance") return saveNtoAttendanceHandler(params);
    if (params.action === "saveScratchpad") return saveScratchpadHandler(ss, user, params);

    // 🗑️ DELETE RECORD ROUTE
    if (params.action === "delete") {
      let targetSheetName = user.sheet;
      if (params.target === "interviews") targetSheetName = "Dallas Interviews";
      if (params.target === "staffing") targetSheetName = user.staffingSheet;

      const sheet = ss.getSheetByName(targetSheetName);
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Target sheet not found." }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        let idCol = 1;
        if (params.target === "interviews") idCol = 16;
        if (params.target === "staffing") idCol = 12;

        const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flatMap(row => row[0].toString().trim());
        const rowIndex = ids.indexOf((params.id || "").toString().trim());

        if (rowIndex !== -1) {
          sheet.deleteRow(rowIndex + 2);
          return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Record permanently deleted." }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Record ID not found for deletion." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (params.action === "logUsage") {
      logCommandCenterUsage(params.storeNum, params.doName, params.actionView, params.deviceType);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Single-Candidate Email Action Handlers
    if (params.target === "email" || (params.action && params.action.toLowerCase().includes("email"))) {
      return handleSingleCandidateEmail(ss, user, params);
    }

    // Staffing Tab (Hires & Terms)
    if (params.target === "staffing") {
      const targetSheetName = user.staffingSheet;
      const sheet = ss.getSheetByName(targetSheetName);
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: `Sheet '${targetSheetName}' not found!` }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      const lastRow = sheet.getLastRow();
      const hireDate = params.hireDate || "";
      const termDate = params.termDate || "";
      const autoPeriod = params.period || calculateDominosPeriod(termDate || hireDate);
      const timestamp = new Date();
      
      let storeDoName = params.doName || "";
      if (!storeDoName && params.store) {
        const storeInfo = lookupStoreInfo(ss, params.store, user.sheet);
        if (storeInfo) storeDoName = storeInfo.doName;
      }
      
      const rowValues = [[
        autoPeriod, storeDoName, params.store || "", params.name || "",
        params.position || "", hireDate, termDate, params.rehireEligible || "Yes",
        params.causeOfAction || "", params.reasonOfAction || "", params.notes || "",
        params.id || ("STF-ID-" + timestamp.getTime() + "-" + (lastRow + 1)),
        timestamp, params.gmName || ""
      ]];

      if (params.action === "add") {
        sheet.getRange(lastRow < 2 ? 2 : lastRow + 1, 1, 1, 14).setValues(rowValues);
        return ContentService.createTextOutput(JSON.stringify({ success: true, id: rowValues[0][11], period: autoPeriod }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      if (params.action === "update") {
        const ids = sheet.getRange(2, 12, Math.max(lastRow - 1, 1), 1).getValues().flatMap(row => row[0]);
        let rowIndex = ids.indexOf(params.id);
        if (rowIndex === -1) {
          return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Record not found" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        sheet.getRange(rowIndex + 2, 1, 1, 14).setValues(rowValues);
        return ContentService.createTextOutput(JSON.stringify({ success: true, period: autoPeriod }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Interviews Tab
    if (params.target === "interviews") {
      const sheet = ss.getSheetByName("Dallas Interviews");
      const lastRow = sheet.getLastRow();
      
      if (params.action === "add") {
        const newId = "INT-ID-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000);
        // Start at Column 2 (Col B - Store #) to preserve formula-imported Column A (DO Name)
        sheet.getRange(lastRow < 2 ? 2 : lastRow + 1, 2, 1, 15).setValues([[
          params.store || "", params.name || "", params.position || "",
          params.phoneNumber || "", params.email || "", params.date || "", params.day || "",
          params.time || "", params.status || "", params.gmDate || "", params.gmTime || "",
          params.statusUpdates || "", params.availability || "", params.notes || "", newId
        ]]);
        sendPushNotification(params.store, "", "📞 Phone Interview Booked", "Phone interview scheduled with " + params.name + " for " + (params.day || "") + " @ " + (params.time || "") + ".", "?store=" + params.store + "&view=interviews");
        return ContentService.createTextOutput(JSON.stringify({ success: true, id: newId }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      if (params.action === "update") {
        const ids = sheet.getRange(2, 16, Math.max(lastRow - 1, 1), 1).getValues().flatMap(row => row[0]);
        let rowIndex = ids.indexOf(params.id);
        if (rowIndex === -1) {
          return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Interview record not found" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        // Start at Column 2 (Col B - Store #) to preserve formula-imported Column A (DO Name)
        sheet.getRange(rowIndex + 2, 2, 1, 15).setValues([[
          params.store || "", params.name || "", params.position || "",
          params.phoneNumber || "", params.email || "", params.date || "", params.day || "",
          params.time || "", params.status || "", params.gmDate || "", params.gmTime || "",
          params.statusUpdates || "", params.availability || "", params.notes || "", params.id
        ]]);
        return ContentService.createTextOutput(JSON.stringify({ success: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    } 

    // FORMULA-SAFE ONBOARDING WRITE OPERATION
    const targetSheetName = user.sheet; 
    const sheet = ss.getSheetByName(targetSheetName);
    const lastRow = sheet.getLastRow();
    const timestamp = new Date();
    
    if (params.action === "add") {
      const newId = "ID-" + timestamp.getTime() + "-" + Math.floor(Math.random() * 1000);
      const nextRow = lastRow < 2 ? 2 : lastRow + 1;
      
      const col1Formula = sheet.getRange(2, 1).getFormula();
      if (!col1Formula || !col1Formula.startsWith("=")) {
        sheet.getRange(nextRow, 1).setValue(newId);
      }
      sheet.getRange(nextRow, 2, 1, 3).setValues([[ params.name || "", params.position || "", params.store || "" ]]);
      sheet.getRange(nextRow, 7, 1, 6).setValues([[
        params.notes || "", params.shirtSize || "", params.payCard || "", timestamp,
        params.phoneNumber || "", params.email || ""
      ]]);
      const isSubRec = (params.submissionReceived === false || String(params.submissionReceived).toUpperCase() === "FALSE") ? false : true;
      sheet.getRange(nextRow, 13, 1, 5).setValues([[
        isSubRec, params.onboardingSent || false, params.bgcComplete || false,
        params.allPayCompleted || false, params.ntoSignupLinkSent || false
      ]]);
      sheet.getRange(nextRow, 19, 1, 9).setValues([[
        params.hired || false, params.incorrectEmail || false, false,
        params.ineligible || false, params.inactive || false, params.missingDocs || false,
        params.pulseFormComplete || false, params.hatStyle || "", params.missedNto || false
      ]]);
      sheet.getRange(nextRow, 28, 1, 5).setValues([[
        params.cardReceived || false, params.registered || false,
        params.ddReceived || false, params.ddEntered || false,
        params.noticeSentDate || ""
      ]]);

      if (params.submissionReceived || params.submissionReceived === undefined) {
        sendPushNotification(params.store, params.doName, "📄 Interview Guide Reviewed", params.name + "'s guide reviewed & added to onboarding pipeline!", "?store=" + params.store + "&view=onboarding");
      }
      
      if (params.hired && typeof autoSyncAllHiredToHiringData === "function") {
        try {
          const currentCity = targetSheetName.toLowerCase().includes("denver") ? "denver" : "dallas";
          autoSyncAllHiredToHiringData(currentCity);
        } catch(e) {}
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true, id: newId, sheetUsed: targetSheetName }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (params.action === "update") {
      const fullRows = sheet.getRange(2, 1, Math.max(lastRow - 1, 1), 4).getValues();
      const searchId = (params.id || "").toString().trim().toLowerCase();
      const searchName = (params.name || "").toString().trim().toLowerCase();

      let rowIndex = -1;
      if (searchId) {
        for (let i = fullRows.length - 1; i >= 0; i--) {
          if (String(fullRows[i][0] || "").trim().toLowerCase() === searchId) {
            rowIndex = i;
            break;
          }
        }
      }
      if (rowIndex === -1 && searchName) {
        for (let i = fullRows.length - 1; i >= 0; i--) {
          if (String(fullRows[i][1] || "").trim().toLowerCase() === searchName) {
            rowIndex = i;
            break;
          }
        }
      }

      if (rowIndex === -1) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Candidate not found for update." }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      const sheetRow = rowIndex + 2;
      const existingRow = sheet.getRange(sheetRow, 1, 1, 27).getValues()[0];

      // Helper: Preserve existing sheet values if parameter was omitted (undefined)
      const val = (paramVal, existingVal) => (paramVal !== undefined ? paramVal : existingVal);
      const strVal = (paramVal, existingVal) => (paramVal !== undefined ? String(paramVal).trim() : String(existingVal || "").trim());
      const boolVal = (paramVal, existingVal) => (paramVal !== undefined ? (paramVal === true || String(paramVal).toUpperCase() === "TRUE") : (existingVal === true || String(existingVal).toUpperCase() === "TRUE"));

      const updatedName = strVal(params.name, existingRow[1]);
      const updatedPosition = strVal(params.position, existingRow[2]);
      const updatedStore = strVal(params.store, existingRow[3]);

      const updatedNotes = strVal(params.notes, existingRow[6]);
      const updatedShirt = strVal(params.shirtSize, existingRow[7]);
      const updatedPayCard = strVal(params.payCard, existingRow[8]);
      const updatedPhone = strVal(params.phoneNumber, existingRow[10]);
      const updatedEmail = strVal(params.email, existingRow[11]);

      const updatedSubRec = (params.submissionReceived === false || String(params.submissionReceived).toUpperCase() === "FALSE") ? false : true;
      const updatedOnbSent = boolVal(params.onboardingSent, existingRow[13]);
      const updatedBgc = boolVal(params.bgcComplete, existingRow[14]);
      const updatedAllPay = boolVal(params.allPayCompleted, existingRow[15]);
      const updatedNtoLink = boolVal(params.ntoSignupLinkSent, existingRow[16]);
      const updatedNtoScheduled = boolVal(params.ntoScheduled || (params.ntoDate && params.ntoDate !== ""), existingRow[17]);

      const updatedHired = boolVal(params.hired, existingRow[18]);
      const updatedIncorrectEmail = boolVal(params.incorrectEmail, existingRow[19]);
      const updatedIneligible = boolVal(params.ineligible, existingRow[21]);
      const updatedInactive = boolVal(params.inactive, existingRow[22]);
      const updatedMissingDocs = val(params.missingDocs, existingRow[23]);
      const updatedPulseForm = boolVal(params.pulseFormComplete, existingRow[24]);
      const updatedHatStyle = strVal(params.hatStyle, existingRow[25]);
      const updatedMissedNto = boolVal(params.missedNto, existingRow[26]);

      const updatedCardReceived = boolVal(params.cardReceived, existingRow[27]);
      const updatedRegistered = boolVal(params.registered, existingRow[28]);
      const updatedDdReceived = boolVal(params.ddReceived, existingRow[29]);
      const updatedDdEntered = boolVal(params.ddEntered, existingRow[30]);
      const updatedNoticeSentDate = val(params.noticeSentDate, existingRow[31]);

      // Update Name, Position, and Store # (Cols B, C, D) so Store transfers & edits persist
      sheet.getRange(sheetRow, 2, 1, 3).setValues([[ updatedName, updatedPosition, updatedStore ]]);
      sheet.getRange(sheetRow, 7, 1, 6).setValues([[
        updatedNotes, updatedShirt, updatedPayCard, timestamp, updatedPhone, updatedEmail
      ]]);
      sheet.getRange(sheetRow, 13, 1, 6).setValues([[
        updatedSubRec, updatedOnbSent, updatedBgc, updatedAllPay, updatedNtoLink, updatedNtoScheduled
      ]]);
      sheet.getRange(sheetRow, 19, 1, 9).setValues([[
        updatedHired, updatedIncorrectEmail, false,
        updatedIneligible, updatedInactive, updatedMissingDocs,
        updatedPulseForm, updatedHatStyle, updatedMissedNto
      ]]);
      sheet.getRange(sheetRow, 28, 1, 5).setValues([[
        updatedCardReceived, updatedRegistered, updatedDdReceived, updatedDdEntered, updatedNoticeSentDate
      ]]);

      if (params.missingDocs && params.missingDocs !== "FALSE") {
        sendPushNotification(params.store, "", "⚠️ Action Needed: Paperwork Error", params.name + " is missing required onboarding items. Tap to view.", "?store=" + params.store + "&view=onboarding");
      }

      if (params.ntoScheduled) {
        sendPushNotification(params.store, params.doName, "📅 Orientation Scheduled!", params.name + " signed up for NTO class.", "?store=" + params.store + "&view=onboarding");
      }

      if (params.missedNto) {
        sendPushNotification(params.store, "", "🚨 Missed NTO Class", params.name + " missed orientation class. Your approval is required to reschedule.", "?store=" + params.store + "&view=onboarding");
      }

      if (params.hired) {
        sendPushNotification(params.store, params.doName, "🎉 New Team Member Hired!", params.name + " completed NTO orientation and is ready for store scheduling!", "?store=" + params.store + "&view=onboarding");
        if (targetSheetName === "Dallas Info" && typeof autoSyncAllHiredToHiringData === "function") {
          try { autoSyncAllHiredToHiringData(); } catch(e) {}
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true, sheetUsed: targetSheetName, id: params.id }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Invalid action" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// BATCHED NTO CLASS WORKFLOW HANDLERS
// ==========================================
function concludeNtoClassHandler(params) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const classDate = params.classDate || Utilities.formatDate(new Date(), "America/Chicago", "yyyy-MM-dd");
    const endTimeInput = params.endTime || "4:30 PM";
    const rosterUpdates = params.roster || []; 

    const ntoSheet = ss.getSheetByName("NTO Roster Data");
    const formSubmittedNames = new Set();
    const ntoDataForHr = [];

    // Build Start Time map from Dallas Roster and Uniform/Paycard map from Dallas Info
    const dallasRosterSheet = ss.getSheetByName("Dallas Roster");
    const dallasInfoSheetForUniforms = ss.getSheetByName("Dallas Info");
    const startTimeLookupMap = {};
    const dallasUniformMap = {};

    if (dallasInfoSheetForUniforms && dallasInfoSheetForUniforms.getLastRow() >= 2) {
      const infoRows = dallasInfoSheetForUniforms.getRange(2, 1, dallasInfoSheetForUniforms.getLastRow() - 1, 26).getValues();
      infoRows.forEach(r => {
        const rName = String(r[1] || "").trim().toLowerCase();
        const rEmail = String(r[11] || "").trim().toLowerCase();
        const rShirt = String(r[7] || "").trim();
        const rPayCard = String(r[8] || "").trim();
        const rHat = String(r[25] || "").trim();

        const info = { shirtSize: rShirt, hatStyle: rHat, payCard: rPayCard };
        if (rName) dallasUniformMap[rName] = info;
        if (rEmail) dallasUniformMap[rEmail] = info;
      });
    }

    if (dallasRosterSheet && dallasRosterSheet.getLastRow() >= 2) {
      const dallasRows = dallasRosterSheet.getRange(2, 1, dallasRosterSheet.getLastRow() - 1, 10).getValues();
      dallasRows.forEach(r => {
        const rName = String(r[1] || "").trim().toLowerCase();
        const rEmail = String(r[3] || "").trim().toLowerCase();
        const rTime = formatTimeDisplay(r[5]);
        const rShirt = String(r[6] || "").trim();
        const rHat = String(r[7] || "").trim();
        const rPayCard = String(r[8] || "").trim();

        if (rTime) {
          if (rName) startTimeLookupMap[rName] = rTime;
          if (rEmail) startTimeLookupMap[rEmail] = rTime;
        }
        if (!dallasUniformMap[rName] && !dallasUniformMap[rEmail]) {
          const info = { shirtSize: rShirt, hatStyle: rHat, payCard: rPayCard };
          if (rName) dallasUniformMap[rName] = info;
          if (rEmail) dallasUniformMap[rEmail] = info;
        }
      });
    }

    if (ntoSheet && ntoSheet.getLastRow() >= 2) {
      const lastRow = ntoSheet.getLastRow();
      const matrix = ntoSheet.getRange(2, 1, lastRow - 1, 17).getValues();

      for (let i = 0; i < matrix.length; i++) {
        const fullName = (String(matrix[i][2] || "").trim() + " " + String(matrix[i][3] || "").trim()).toLowerCase();
        const candidateEmail = String(matrix[i][12] || "").trim().toLowerCase();
        formSubmittedNames.add(fullName);

        const matchedUi = rosterUpdates.find(r => {
          const att = (r.attendance || "").toLowerCase().trim();
          return r.name.toLowerCase().trim() === fullName && 
                 (att === "nto complete" || att === "in class" || att === "attended");
        });

        if (matchedUi) {
          const rawSheetStartTime = String(matrix[i][14] || "").trim();
          const detectedStartTime = rawSheetStartTime || startTimeLookupMap[fullName] || startTimeLookupMap[candidateEmail] || "9:00 AM";
          const startTime = formatTimeDisplay(detectedStartTime);
          const formattedEndTime = formatTimeDisplay(endTimeInput);
          try { ntoSheet.getRange(i + 2, 16).setValue(formattedEndTime); } catch(e) {}

          ntoDataForHr.push({
            fullName: matrix[i][2] + " " + matrix[i][3],
            storeNum: String(matrix[i][4] || "").trim(),
            ssnLast4: String(matrix[i][5] || "").trim(),
            startTime: startTime,
            endTime: formattedEndTime,
            hours: calculateTrainingHours(startTime, endTimeInput),
            paycard: String(matrix[i][16] || "").trim() || (dallasUniformMap[fullName] ? dallasUniformMap[fullName].payCard : "")
          });
        }
      }
    }

    const finalDallasRoster = rosterUpdates.map(item => {
      const cleanName = item.name.toLowerCase().trim();
      const cleanEmail = (item.email || "").toLowerCase().trim();
      const uiStatus = (item.attendance || "").trim();
      let finalStatus = uiStatus;
      if (!finalStatus && (uiStatus.toLowerCase() === "nto complete" || uiStatus.toLowerCase() === "in class")) {
        finalStatus = formSubmittedNames.has(cleanName) ? "NTO Complete" : "Incomplete (No Form)";
      }
      const uInfo = dallasUniformMap[cleanName] || dallasUniformMap[cleanEmail] || {};
      return {
        ...item,
        shirtSize: item.shirtSize || uInfo.shirtSize || "",
        hatStyle: item.hatStyle || uInfo.hatStyle || "",
        payCard: item.payCard || item.paycard || uInfo.payCard || "",
        finalAttendance: finalStatus
      };
    });

    const dallasSheet = ss.getSheetByName("Dallas Roster");
    if (dallasSheet && dallasSheet.getLastRow() >= 2) {
      const lastRow = dallasSheet.getLastRow();
      const dallasRangeValues = dallasSheet.getRange(2, 1, lastRow - 1, 11).getValues();
      const formattedEndTime = formatTimeDisplay(endTimeInput);

      finalDallasRoster.forEach(item => {
        const targetId = (item.id || item.classId || "").toString().trim();
        const tName = (item.name || "").toString().trim();
        const tEmail = (item.email || "").toLowerCase().trim();

        for (let i = 0; i < dallasRangeValues.length; i++) {
          const rowId = String(dallasRangeValues[i][0] || "").trim();
          const rowName = String(dallasRangeValues[i][1] || "").trim();
          const rowEmail = String(dallasRangeValues[i][3] || "").trim().toLowerCase();

          const isMatched = (targetId && rowId === targetId) ||
                            (tEmail && rowEmail && tEmail === rowEmail) ||
                            isFuzzyNameMatch(tName, rowName);

          if (isMatched) {
            const rowNum = i + 2;
            const shirt = item.shirtSize || item.shirt || item.Shirt || "";
            const hat = item.hatStyle || item.capVisor || item['Cap/Visor'] || item.hat || "";
            const payCard = item.payCard || item.paycard || item.Paycard || "";
            const statusVal = item.finalAttendance || item.ntoAttendance || item.attendance || "";

            if (shirt) try { dallasSheet.getRange(rowNum, 7).setValue(shirt); } catch(e) {} // Col G (Shirt)
            if (hat) try { dallasSheet.getRange(rowNum, 8).setValue(hat); } catch(e) {} // Col H (Cap/Visor)
            if (payCard) try { dallasSheet.getRange(rowNum, 9).setValue(payCard); } catch(e) {} // Col I (Paycard)
            if (statusVal) try { dallasSheet.getRange(rowNum, 10).setValue(statusVal); } catch(e) {} // Col J (NTO Status)
            if (formattedEndTime) try { dallasSheet.getRange(rowNum, 11).setValue(formattedEndTime); } catch(e) {} // Col K (End Time)
            break;
          }
        }
      });
    }

    const dallasInfoSheet = ss.getSheetByName("Dallas Info");
    if (dallasInfoSheet && dallasInfoSheet.getLastRow() >= 2) {
      const lastRow = dallasInfoSheet.getLastRow();
      const nameValues = dallasInfoSheet.getRange(2, 1, lastRow - 1, 2).getValues();
      finalDallasRoster.forEach(item => {
        if (item.finalAttendance === "NTO Complete" || item.finalAttendance === "Attended") {
          const tName = (item.name || "").toLowerCase().trim();
          const tId = (item.id || "").toString().trim();
          for (let i = 0; i < nameValues.length; i++) {
            if ((tId && String(nameValues[i][0] || "").trim() === tId) || 
                (tName && String(nameValues[i][1] || "").trim().toLowerCase() === tName)) {
              try { dallasInfoSheet.getRange(i + 2, 19).setValue(true); } catch(e) {}
              break;
            }
          }
        }
      });
      if (typeof autoSyncAllHiredToHiringData === "function") {
        try { autoSyncAllHiredToHiringData(); } catch(e) {}
      }
    }

    if (typeof sendNtoHrEmail === "function") sendNtoHrEmail(ntoDataForHr, classDate, endTimeInput);
    const verifiedCompletedList = finalDallasRoster.filter(r => r.finalAttendance === "NTO Complete" || r.finalAttendance === "Attended");
    if (typeof sendNtoLeadershipEmail === "function") sendNtoLeadershipEmail(verifiedCompletedList, classDate);
    if (typeof sendNtoStoreAndDoEmails === "function") sendNtoStoreAndDoEmails(finalDallasRoster, classDate, ss);

    return ContentService.createTextOutput(JSON.stringify({ 
      success: true, 
      message: `NTO Class concluded! ${verifiedCompletedList.length} trainees officially completed NTO & auto-marked as Hired.` 
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function isFuzzyNameMatch(name1, name2) {
  if (!name1 || !name2) return false;
  var n1 = name1.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  var n2 = name2.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  if (n1 === n2) return true;

  var parts1 = n1.split(/\s+/).filter(function(p) { return p.length > 0 && p !== 'jr' && p !== 'sr' && p !== 'iii' && p !== 'ii'; });
  var parts2 = n2.split(/\s+/).filter(function(p) { return p.length > 0 && p !== 'jr' && p !== 'sr' && p !== 'iii' && p !== 'ii'; });

  if (parts1.length === 0 || parts2.length === 0) return false;

  var first1 = parts1[0];
  var last1 = parts1[parts1.length - 1];
  var first2 = parts2[0];
  var last2 = parts2[parts2.length - 1];

  // If one name has a distinct middle name (e.g. "Juan Carlos Luna" vs "Juan Luna"), require 1-letter middle initial match only
  if (parts1.length !== parts2.length) {
    var p1MiddleInit = (parts1.length === 3 && parts1[1].length === 1);
    var p2MiddleInit = (parts2.length === 3 && parts2[1].length === 1);
    if (!p1MiddleInit && !p2MiddleInit) {
      return false; // Distinct middle name (e.g. "Carlos") => Do not match!
    }
  }

  if (first1 === first2 && last1 === last2) return true;

  return false;
}

function saveNtoAttendanceHandler(params) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const rosterUpdates = params.roster || []; 
    if (rosterUpdates.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "No roster items provided." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const dallasSheet = ss.getSheetByName("Dallas Roster");
    if (dallasSheet && dallasSheet.getLastRow() >= 2) {
      const lastRow = dallasSheet.getLastRow();
      const dallasRangeValues = dallasSheet.getRange(2, 1, lastRow - 1, 11).getValues();

      rosterUpdates.forEach(item => {
        const targetId = (item.id || item.classId || "").toString().trim();
        const targetName = (item.name || "").toString().trim();
        const targetEmail = (item.email || "").toLowerCase().trim();

        for (let i = 0; i < dallasRangeValues.length; i++) {
          const rowId = String(dallasRangeValues[i][0] || "").trim();
          const rowName = String(dallasRangeValues[i][1] || "").trim();
          const rowEmail = String(dallasRangeValues[i][3] || "").trim().toLowerCase();

          const isMatched = (targetId && rowId === targetId) ||
                            (targetEmail && rowEmail && targetEmail === rowEmail) ||
                            isFuzzyNameMatch(targetName, rowName);

          if (isMatched) {
            const rowNum = i + 2;
            const shirt = item.shirtSize || item.shirt || item.Shirt || "";
            const hat = item.hatStyle || item.capVisor || item['Cap/Visor'] || item.hat || "";
            const payCard = item.payCard || item.paycard || item.Paycard || "";
            const statusVal = item.ntoStatus || item.ntoAttendance || item.liveStatus || item.attendance || "";

            if (shirt) try { dallasSheet.getRange(rowNum, 7).setValue(shirt); } catch(e) {} // Col G (Shirt)
            if (hat) try { dallasSheet.getRange(rowNum, 8).setValue(hat); } catch(e) {} // Col H (Cap/Visor)
            if (payCard) try { dallasSheet.getRange(rowNum, 9).setValue(payCard); } catch(e) {} // Col I (Paycard)
            if (statusVal) try { dallasSheet.getRange(rowNum, 10).setValue(statusVal); } catch(e) {} // Col J (NTO Status)
            break;
          }
        }
      });
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: `Live attendance updated for ${rosterUpdates.length} trainees!` }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function sendNtoMeetLinksHandler(params) {
  try {
    const targetDate = params.classDate;
    const meetUrl = params.meetLink || "https://meet.google.com/zwc-afuu-hgh";
    const trainees = params.trainees || [];

    if (trainees.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "No trainees found." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // AUTOMATIC LOOKUP FOR CLASS START TIME FROM CLASSES SHEET IF NOT PASSED
    let detectedClassTime = params.classTime || params.time || "";
    if (!detectedClassTime && targetDate) {
      try {
        const calSs = SpreadsheetApp.openById(DALLAS_NTO_CALENDAR_SHEET_ID);
        const calSheet = calSs.getSheetByName("Classes") || calSs.getSheetByName("NTO Classes") || calSs.getSheets()[0];
        if (calSheet && calSheet.getLastRow() >= 2) {
          const classRows = calSheet.getRange(2, 1, calSheet.getLastRow() - 1, 5).getValues();
          const targetFormatted = formatCellDate(targetDate);
          const matchedClass = classRows.find(r => {
            const rowDateFormatted = formatCellDate(r[1]);
            return rowDateFormatted === targetFormatted || 
                   String(r[1]).includes(String(targetDate)) || 
                   formatDateForInput(r[1]) === formatDateForInput(targetDate);
          });
          if (matchedClass && matchedClass[2]) {
            detectedClassTime = formatTimeDisplay(matchedClass[2]);
          }
        }
      } catch (e) {
        Logger.log("Class time lookup error: " + e.toString());
      }
    }

    const finalClassTime = detectedClassTime || "Scheduled Class Time";
    let sentCount = 0;
    const sentEmails = new Set();

    trainees.forEach(t => {
      const emailKey = (t.email || "").toLowerCase().trim();
      if (emailKey && emailKey.includes("@") && !sentEmails.has(emailKey)) {
        sentEmails.add(emailKey);
        if (typeof sendNtoClassLinkEmail === "function") {
          sendNtoClassLinkEmail(t.email.trim(), t.name, targetDate, finalClassTime, meetUrl, params.trainerName || "Mike Jacobs");
        }
        sentCount++;
      }
    });

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: `Successfully delivered links for ${finalClassTime} class on ${targetDate} to ${sentCount} trainee(s)!` }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleSingleCandidateEmail(ss, user, params) {
  try {
    const emailType = params.emailType || params.action;
    let candidateEmail = (params.email || params.candidateEmail || "").toString().trim();
    let candidateName = (params.candidateName || params.name || "").toString().trim();
    let storeNum = (params.storeNum || params.store || "").toString().trim();
    let candidatePosition = (params.position || "").toString().trim();
    
    const emailTargetSheetName = user.sheet;
    const emailSheet = ss.getSheetByName(emailTargetSheetName);

    let matchedRowIndex = -1;
    if (emailSheet) {
      const lastRow = emailSheet.getLastRow();
      if (lastRow >= 2) {
        const displayValues = emailSheet.getRange(2, 1, lastRow - 1, 27).getValues();
        const searchId = (params.id || "").toString().trim().toLowerCase();
        const searchName = (candidateName || "").toString().trim().toLowerCase();
        const searchEmail = (candidateEmail || "").toString().trim().toLowerCase();

        for (let i = 0; i < displayValues.length; i++) {
          const rowId = String(displayValues[i][0] || "").trim().toLowerCase();
          const rowName = String(displayValues[i][1] || "").trim().toLowerCase();
          const rowEmail = String(displayValues[i][11] || "").trim().toLowerCase();

          const matchesId = searchId && rowId && rowId === searchId;
          const matchesName = searchName && rowName && rowName === searchName;
          const matchesEmail = searchEmail && rowEmail && rowEmail === searchEmail;

          if (matchesId || matchesName || matchesEmail) {
            matchedRowIndex = i + 2;
            if (!candidateName) candidateName = String(displayValues[i][1] || "").trim();
            if (!candidatePosition) candidatePosition = String(displayValues[i][2] || "").trim();
            if (!storeNum) storeNum = String(displayValues[i][3] || "").trim();
            if (!candidateEmail) candidateEmail = String(displayValues[i][11] || "").trim();
            break;
          }
        }
      }
    }

    if (!candidateEmail) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: `No email address found for ${candidateName || "candidate"}.` }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const storeInfo = storeNum ? lookupStoreInfo(ss, storeNum, emailTargetSheetName) : null;
    const storeEmail = params.storeEmail || (storeInfo ? storeInfo.storeEmail : "");
    const doEmail = params.doEmail || (storeInfo ? storeInfo.doEmail : "");

    if (emailType === "sendWelcomeEmail" || emailType === "welcome") {
      if (typeof sendDynamicWelcomeEmail === "function") {
        sendDynamicWelcomeEmail(candidateEmail, candidateName, candidatePosition, storeNum, params.hourlyRate || "", params.gmName || (storeInfo ? storeInfo.gmName : ""), params.gmPhone || (storeInfo ? storeInfo.gmPhone : ""), params.storeAddress || (storeInfo ? storeInfo.address : ""), params.storePhone || (storeInfo ? storeInfo.storePhone : ""), storeEmail, doEmail, params.roadRate || "");
      }
      if (matchedRowIndex !== -1) {
        try {
          emailSheet.getRange(matchedRowIndex, 13).setValue(true); // submissionReceived
          emailSheet.getRange(matchedRowIndex, 14).setValue(true); // onboardingSent
        } catch(e) {}
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Welcome email sent successfully." })).setMimeType(ContentService.MimeType.JSON);
    }

    if (emailType === "sendOnboardingReminderEmail" || emailType === "reminder") {
      if (typeof sendOnboardingReminderEmail === "function") {
        sendOnboardingReminderEmail(candidateEmail, candidateName, params.missingForms || "", storeEmail, doEmail, params.allPayLink || "", params.checkrLink || "", params.storeSetupLink || "");
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Reminder email sent." })).setMimeType(ContentService.MimeType.JSON);
    }

    if (emailType === "sendOrientationRegistrationEmail" || emailType === "orientation") {
      if (typeof sendOrientationRegistrationEmail === "function") {
        sendOrientationRegistrationEmail(candidateEmail, candidateName);
      }
      if (matchedRowIndex !== -1) {
        try {
          emailSheet.getRange(matchedRowIndex, 17).setValue(true); // ntoSignupLinkSent
        } catch(e) {}
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Orientation registration email sent." })).setMimeType(ContentService.MimeType.JSON);
    }

    if (emailType === "sendGmInterviewEmail" || emailType === "gmInterview") {
      if (typeof sendGmInterviewEmail === "function") {
        sendGmInterviewEmail(candidateEmail, candidateName, candidatePosition, storeNum, params.gmDate || "", params.gmTime || "", params.gmName || (storeInfo ? storeInfo.gmName : ""), params.storeAddress || (storeInfo ? storeInfo.address : ""), params.storePhone || (storeInfo ? storeInfo.storePhone : ""), storeEmail, doEmail);
      }
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: "GM interview email sent." })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Invalid email action" })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function saveScratchpadHandler(ss, user, params) {
  try {
    const prefix = user.sheet.toLowerCase().includes("denver") ? "Denver" : "Dallas";
    const scratchSheetName = prefix + " Scratchpad";
    let sheet = ss.getSheetByName(scratchSheetName);

    if (!sheet) {
      sheet = ss.insertSheet(scratchSheetName);
      sheet.getRange(1, 1, 1, 4).setValues([["Type", "Content / Task", "Completed", "Item ID"]]);
    }

    if (params.scratchpadMode === "text") {
      const lastRow = sheet.getLastRow();
      let textRowIndex = -1;
      if (lastRow >= 2) {
        const types = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flatMap(r => String(r[0] || "").toLowerCase());
        textRowIndex = types.indexOf("text");
      }
      if (textRowIndex !== -1) {
        sheet.getRange(textRowIndex + 2, 2).setValue(params.scratchpadContent || "");
      } else {
        sheet.appendRow(["Text", params.scratchpadContent || "", false, "text_main"]);
      }
    } else {
      let items = [];
      try { items = JSON.parse(params.scratchpadContent || "[]"); } catch(e) {}

      const lastRow = sheet.getLastRow();
      let existingText = "";
      if (lastRow >= 2) {
        const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
        const textRow = rows.find(r => String(r[0] || "").toLowerCase() === "text");
        if (textRow) existingText = textRow[1];
      }

      const batchRows = [["Text", existingText, false, "text_main"]];
      items.forEach(item => batchRows.push(["Checklist", item.text, item.done === true, item.id || new Date().getTime()]));

      if (items.length > 0 || lastRow < 3) {
        if (lastRow >= 2) {
          sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
        }
        sheet.getRange(2, 1, batchRows.length, 4).setValues(batchRows);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// UTILITY & CALENDAR HANDLERS
// ==========================================
function parseTimeToMinutes(tStr) {
  if (!tStr) return 0;
  tStr = tStr.toString().trim().toUpperCase();
  var isPm = tStr.includes("PM");
  var isAm = tStr.includes("AM");
  var clean = tStr.replace(/(AM|PM|\s)/g, "");

  var h = 0, m = 0;
  if (clean.includes(":")) {
    var parts = clean.split(":");
    h = parseInt(parts[0], 10) || 0;
    m = parseInt(parts[1], 10) || 0;
  } else {
    var num = parseInt(clean, 10) || 0;
    h = (num >= 100) ? Math.floor(num / 100) : num;
    m = (num >= 100) ? (num % 100) : 0;
  }

  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;
  return (h * 60) + m;
}

function formatTimeDisplay(tStr) {
  if (!tStr) return "";
  var totalMins = parseTimeToMinutes(tStr);
  var h = Math.floor(totalMins / 60) % 24;
  var m = totalMins % 60;
  var period = h >= 12 ? "PM" : "AM";
  var displayH = h % 12 || 12;
  var displayM = m < 10 ? "0" + m : m;
  return displayH + ":" + displayM + " " + period;
}

function formatCellTime(val) {
  if (!val && val !== 0) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "h:mm a");
  }
  var str = String(val).trim();
  if (str.includes("1899") || str.includes("GMT") || str.includes("Central")) {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), "h:mm a");
    }
  }
  return formatTimeDisplay(str) || str;
}

function calculateTrainingHours(startStr, endStr) {
  if (!startStr || !endStr) return "0.00";
  try {
    var diffMins = parseTimeToMinutes(endStr) - parseTimeToMinutes(startStr);
    if (diffMins < 0) diffMins += (24 * 60);
    return (diffMins / 60).toFixed(2);
  } catch (err) {
    return "0.00";
  }
}

const ONESIGNAL_APP_ID = "260aafa0-6a1c-40fc-a8a7-2a8e80b206b4";
const ONESIGNAL_REST_KEY = PropertiesService.getScriptProperties().getProperty("ONESIGNAL_REST_KEY") || "";

function sendPushNotification(storeNum, doName, title, message, targetUrl) {
  if (!ONESIGNAL_REST_KEY) return;
  var filters = [];
  if (storeNum && storeNum.toString().trim() !== "" && storeNum !== "ALL") {
    filters.push({ field: "tag", key: "store_number", relation: "=", value: storeNum.toString().replace(/\D/g, "").trim() });
  }
  if (doName && doName.toString().trim() !== "" && doName !== "ALL") {
    if (filters.length > 0) filters.push({ operator: "OR" });
    filters.push({ field: "tag", key: "do_name", relation: "=", value: doName.trim().toLowerCase() });
  }

  var payload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: title },
    contents: { en: message }
  };
  if (filters.length > 0) payload.filters = filters;
  else payload.included_segments = ["Subscribed Users"];
  if (targetUrl) payload.url = targetUrl;

  try {
    UrlFetchApp.fetch("https://onesignal.com/api/v1/notifications", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Basic " + ONESIGNAL_REST_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {}
}

function logCommandCenterUsage(storeNum, doName, actionView, deviceType) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("Command Center Usage Log") || ss.insertSheet("Command Center Usage Log");
    var timestamp = Utilities.formatDate(new Date(), "America/Chicago", "M/d/yyyy h:mm:ss a") + " CT";
    sheet.appendRow([timestamp, storeNum || "All", doName || "All", actionView || "Opened App", deviceType || "Browser"]);
  } catch (e) {}
}

const DALLAS_NTO_CALENDAR_SHEET_ID = "1AsWV44eSqhifjwjcSVvFIrOi9ysUJv4_PXmuvTF-oTg";

function getNtoClassesHandler(params) {
  try {
    const ss = SpreadsheetApp.openById(DALLAS_NTO_CALENDAR_SHEET_ID);
    let sheet = ss.getSheetByName("Classes") || ss.getSheetByName("NTO Classes") || ss.getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return ContentService.createTextOutput(JSON.stringify({ success: true, classes: [] })).setMimeType(ContentService.MimeType.JSON);
    
    const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    const classes = values.map((row, index) => ({
      rowNum: index + 2,
      classId: String(row[0] || "").trim(),
      classDate: formatCellDate(row[1]),
      startTime: String(row[2] || "").trim(),
      endTime: String(row[3] || "").trim(),
      trainerName: String(row[4] || "").trim(),
      capacity: String(row[5] || "").trim()
    })).filter(c => c.classDate !== "");

    return ContentService.createTextOutput(JSON.stringify({ success: true, classes: classes })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function addNtoClassHandler(params) {
  try {
    const ss = SpreadsheetApp.openById(DALLAS_NTO_CALENDAR_SHEET_ID);
    let sheet = ss.getSheetByName("Classes") || ss.getSheetByName("NTO Classes") || ss.getSheets()[0];
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow < 2 ? 2 : lastRow + 1, 2, 1, 5).setValues([[
      params.classDate || "", params.startTime || "6:00 PM", params.endTime || "7:15 PM", params.trainerName || "Mike", params.capacity || 15
    ]]);
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "New NTO class session added!" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function deleteNtoClassHandler(params) {
  try {
    const ss = SpreadsheetApp.openById(DALLAS_NTO_CALENDAR_SHEET_ID);
    let sheet = ss.getSheetByName("Classes") || ss.getSheetByName("NTO Classes") || ss.getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return ContentService.createTextOutput(JSON.stringify({ success: false, error: "No classes to delete." })).setMimeType(ContentService.MimeType.JSON);

    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    let targetRow = -1;
    for (let i = 0; i < values.length; i++) {
      if ((params.classId && String(values[i][0] || "").trim() === params.classId.toString().trim()) || 
          (params.classDate && formatCellDate(values[i][1]) === params.classDate.toString().trim()) ||
          (params.rowNum && (i + 2) === parseInt(params.rowNum, 10))) {
        targetRow = i + 2;
        break;
      }
    }
    if (targetRow === -1) return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Class session not found." })).setMimeType(ContentService.MimeType.JSON);

    sheet.deleteRow(targetRow);
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Class session deleted." })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function backfillDallasRosterFromInfo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dallasRoster = ss.getSheetByName("Dallas Roster");
  var dallasInfo = ss.getSheetByName("Dallas Info");
  if (!dallasRoster || !dallasInfo) return;

  var infoRows = dallasInfo.getDataRange().getValues();
  var rosterRows = dallasRoster.getDataRange().getValues();

  var infoList = [];
  for (var i = 1; i < infoRows.length; i++) {
    var name = String(infoRows[i][1] || "").trim();
    var email = String(infoRows[i][11] || "").trim().toLowerCase();
    var shirt = String(infoRows[i][7] || "").trim();
    var paycard = String(infoRows[i][8] || "").trim();
    var hat = String(infoRows[i][25] || "").trim();
    if (name || email) {
      infoList.push({ name: name, email: email, shirt: shirt, hat: hat, paycard: paycard });
    }
  }

  for (var r = 1; r < rosterRows.length; r++) {
    var rName = String(rosterRows[r][1] || "").trim();
    var rEmail = String(rosterRows[r][3] || "").trim().toLowerCase();
    
    var match = null;
    for (var m = 0; m < infoList.length; m++) {
      if ((rEmail && infoList[m].email && rEmail === infoList[m].email) || isFuzzyNameMatch(rName, infoList[m].name)) {
        match = infoList[m];
        break;
      }
    }

    if (match) {
      var rowNum = r + 1;
      if (match.shirt && !rosterRows[r][6]) dallasRoster.getRange(rowNum, 7).setValue(match.shirt);
      if (match.hat && !rosterRows[r][7]) dallasRoster.getRange(rowNum, 8).setValue(match.hat);
      if (match.paycard && !rosterRows[r][8]) dallasRoster.getRange(rowNum, 9).setValue(match.paycard);
    }
  }
}

function testNtoAttendance() {
  var data = getOnboardingData(null, "Dallas Info");
  data.forEach(function(c) {
    if (c.name.includes("Todd") || c.name.includes("Rolando") || c.name.includes("Willie") || c.name.includes("Colin")) {
      Logger.log(c.name + " => ntoAttendance: '" + c.ntoAttendance + "'");
    }
  });
}
