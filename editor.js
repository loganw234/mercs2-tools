// State Variables
let originalFileBytes = null;
let originalFileName = "";
let saveLuaText = "";

// Faction mappings
const FACTIONS = ["Oil", "All", "Chi", "Gur", "Pir"];

// DOM Elements
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const browseBtn = document.getElementById("browse-btn");
const fileNameDisplay = document.getElementById("file-name-display");

const metadataCard = document.getElementById("metadata-card");
const emptyState = document.getElementById("empty-state");
const editorControls = document.getElementById("editor-controls");

const metaSlot = document.getElementById("meta-slot");
const metaMission = document.getElementById("meta-mission");
const metaTime = document.getElementById("meta-time");
const metaCompletion = document.getElementById("meta-completion");
const metaId = document.getElementById("meta-id");

// Money elements
const cashInput = document.getElementById("cash-input");
const cashSlider = document.getElementById("cash-slider");
const cashFormatted = document.getElementById("cash-formatted");

// Fuel elements
const fuelInput = document.getElementById("fuel-input");
const fuelSlider = document.getElementById("fuel-slider");
const fuelFormatted = document.getElementById("fuel-formatted");

// Download button
const downloadBtn = document.getElementById("download-btn");

// Stockpile elements
const stockpileBtn = document.getElementById("stockpile-btn");
const stockpileFormatted = document.getElementById("stockpile-formatted");

// Stockpile items list (134 items)
const SUPPORT_ITEMS = ['Support', 'aa', 'ah1z', 'al', 'alouette3attackpr', 'alouette3attackvz', 'alouette3elite', 'alouette3superiority', 'alouette3transportpr', 'alouette3transportvz', 'amal', 'amch', 'amx30', 'amx30aa', 'amx30elite', 'artillery', 'atal', 'atch', 'bike', 'blanco', 'bombingrun', 'buggyhellfire', 'buggypr', 'bunkerbuster', 'c4', 'carpetbomb', 'ch', 'civilian', 'clusterbomb', 'coandaattack', 'coandagunship', 'coandasuperiority', 'coandatransport', 'combatairpatrol', 'covert', 'cqb', 'cruisemissile', 'daisycutter', 'dinghy', 'dsvscoutvehicle', 'endriagoattack', 'endriagoelite', 'endriagosuperiority', 'ext', 'extgl', 'fiona', 'fuelairbomb', 'gl', 'gr', 'guntruckoc', 'hmmwvarmored50cal', 'hmmwvarmoredgl', 'hmmwvarmoredtow', 'hmmwvavenger', 'hmmwvsofttop', 'jetskiciv', 'junkers', 'ka29b', 'laserguidedbomb', 'laviii25mm', 'laviii50cal', 'laviiiad', 'laviiiat', 'laviiimewss', 'laviiimgs', 'lightmg', 'luxury', 'm113aagr', 'm113aavz', 'm113gr', 'm113jammervz', 'm113vz', 'm15150calgr', 'm15150calvz', 'm151softtopgr', 'm151softtopvz', 'm1a2', 'm2a3', 'm35aagr', 'm35aavz', 'm35guntruckgr', 'm35guntruckvz', 'm551', 'mattiaschopper', 'mh53j', 'mi26ch', 'mi26vz', 'mi35', 'moab', 'monster', 'monstertruck', 'nglv50cal', 'nglvgl', 'nuke', 'oc', 'omen', 'panhardassault', 'patrolboatpmc', 'patrolboatvz', 'pgz95', 'pgz95command', 'piranha', 'plz45', 'pr', 'rocketartillery', 'rpg', 'scorpion90', 'sidecarmotorcycle', 'smartbomb', 'sniperch', 'sniperru', 'speedboat', 'sports', 'stingrayii', 'strategicmissile', 'surgicalstrike', 'sx2150mlrs', 't300m60', 'tankbike', 'tankbuster', 'turbosquidgr', 'turbosquidoc', 'uh1transportgr', 'upclusterbomb', 'upcombatairpatrol', 'uptankbuster', 'utility', 'valiantpython', 'veyronassault', 'wz10', 'wz551', 'zbd2000', 'ztz63a', 'ztz98'];

let customStockpile = {};

// Modal DOM elements
const customDepotBtn = document.getElementById("custom-depot-btn");
const rawEditorBtn = document.getElementById("raw-editor-btn");

const depotModal = document.getElementById("depot-modal");
const closeDepotModal = document.getElementById("close-depot-modal");
const depotSearch = document.getElementById("depot-search");
const depotItemsList = document.getElementById("depot-items-list");
const depotClearBtn = document.getElementById("depot-clear-btn");
const depotApplyBtn = document.getElementById("depot-apply-btn");

const rawModal = document.getElementById("raw-modal");
const closeRawModal = document.getElementById("close-raw-modal");
const rawTextarea = document.getElementById("raw-textarea");
const rawApplyBtn = document.getElementById("raw-apply-btn");

// ----------------------------------------------------
// File Upload & Drag-and-Drop Binding
// ----------------------------------------------------

browseBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

function handleFile(file) {
    originalFileName = file.name;
    fileNameDisplay.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const arrayBuffer = e.target.result;
        const bytes = new Uint8Array(arrayBuffer);
        
        if (bytes.length !== 13404) {
            alert(`Error: File is not a valid Mercenaries 2 save. File size must be exactly 13,404 bytes. (Got ${bytes.length} bytes)`);
            return;
        }
        
        originalFileBytes = bytes;
        parseSaveGame(bytes);
    };
    reader.readAsArrayBuffer(file);
}

// ----------------------------------------------------
// Binary Parsing Utilities
// ----------------------------------------------------

function readUint32LE(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeUint32LE(bytes, offset, value) {
    bytes[offset] = value & 0xFF;
    bytes[offset + 1] = (value >> 8) & 0xFF;
    bytes[offset + 2] = (value >> 16) & 0xFF;
    bytes[offset + 3] = (value >> 24) & 0xFF;
}

function readFloat32LE(bytes, offset) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    for (let i = 0; i < 4; i++) {
        view.setUint8(i, bytes[offset + i]);
    }
    return view.getFloat32(0, true);
}

function readASCIIString(bytes, offset, maxLength = 32) {
    let result = "";
    for (let i = 0; i < maxLength; i++) {
        let b = bytes[offset + i];
        if (b === 0) break;
        result += String.fromCharCode(b);
    }
    return result;
}

function readUTF16LEString(bytes, offset, maxLength = 128) {
    let result = "";
    for (let i = 0; i < maxLength * 2; i += 2) {
        let code = bytes[offset + i] | (bytes[offset + i + 1] << 8);
        if (code === 0) break;
        result += String.fromCharCode(code);
    }
    return result;
}

// Non-reflected CRC-32 (MPEG-2)
function crc32Mpeg2(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= (data[i] << 24);
        for (let j = 0; j < 8; j++) {
            if (crc & 0x80000000) {
                crc = ((crc << 1) ^ 0x04C11DB7) >>> 0;
            } else {
                crc = (crc << 1) >>> 0;
            }
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ----------------------------------------------------
// Save Game Deconstruction
// ----------------------------------------------------

function parseSaveGame(bytes) {
    // 1. Verify Checksum
    const storedChecksum = readUint32LE(bytes, 0);
    const computedChecksum = crc32Mpeg2(bytes.subarray(4));
    console.log(`Stored Checksum: 0x${storedChecksum.toString(16).toUpperCase()}`);
    console.log(`Computed Checksum: 0x${computedChecksum.toString(16).toUpperCase()}`);
    
    // 2. Read Header Metadata
    const timeSec = readFloat32LE(bytes, 0x14);
    const cash = readUint32LE(bytes, 0x18);
    const fuel = readUint32LE(bytes, 0x1C);
    const saveId = readUint32LE(bytes, 0x20);
    const activeMission = readASCIIString(bytes, 0x2C, 20);
    const charId = bytes[0x004D];
    const completion = bytes[0x0051];
    const slotName = readUTF16LEString(bytes, 0x020A, 64);
    
    // 3. Decompress Lua table
    const compressedPayload = bytes.slice(0x0468);
    try {
        const decompressed = pako.inflate(compressedPayload);
        saveLuaText = new TextDecoder("utf-8").decode(decompressed);
        console.log("Decompressed Lua Payload length:", saveLuaText.length);
    } catch (err) {
        alert("Failed to decompress save game data. The file might be corrupted.");
        console.error("Zlib decompression error:", err);
        return;
    }
    
    // 4. Update UI Fields
    // Format Time Played
    const hrs = Math.floor(timeSec / 3600);
    const mins = Math.floor((timeSec % 3600) / 60);
    const secs = Math.floor(timeSec % 60);
    const formattedTime = `${hrs}h ${mins}m ${secs}s`;
    
    // Format ID/Date
    const date = new Date(saveId * 1000);
    const formattedDate = date.toLocaleDateString() + " " + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    metaSlot.textContent = slotName || "Auto Save";
    metaMission.textContent = activeMission || "None";
    metaTime.textContent = formattedTime;
    metaCompletion.textContent = `${completion}%`;
    metaId.textContent = `${saveId} (${formattedDate})`;
    
    // Parse Stockpile from Lua
    customStockpile = parseStockpile(saveLuaText);
    
    // Reset Stockpile label/button state
    stockpileFormatted.textContent = "Default Stockpile";
    stockpileFormatted.className = "stockpile-display";
    stockpileBtn.textContent = "MAX STOCKPILE (99)";
    stockpileBtn.className = "btn btn-xs btn-highlight";

    // Populate Money & Fuel
    setCash(cash);
    setFuel(fuel);
    
    // Populate Faction Sliders
    FACTIONS.forEach(fac => {
        let val = parseFactionRelation(saveLuaText, fac);
        let slider = document.querySelector(`#faction-${fac.toLowerCase()} .faction-slider`);
        let badge = document.querySelector(`#faction-${fac.toLowerCase()} .mood-badge`);
        if (slider && badge) {
            slider.value = val;
            updateMoodBadge(badge, val);
        }
    });

    // Unhide UI
    emptyState.classList.add("hidden");
    metadataCard.classList.remove("hidden");
    editorControls.classList.remove("hidden");
}

// Parse faction relations from the Lua table string
function parseFactionRelation(luaText, faction) {
    const relsStart = luaText.indexOf('["tRelations"] = {');
    if (relsStart === -1) return 0;
    const pmcStart = luaText.indexOf('["Pmc"] = {', relsStart);
    if (pmcStart === -1) return 0;
    const pmcEnd = luaText.indexOf('}', pmcStart);
    const pmcBlock = luaText.substring(pmcStart, pmcEnd + 1);
    
    const re = new RegExp('\\["' + faction + '"\\]\\s*=\\s*([-0-9.]+)');
    const match = pmcBlock.match(re);
    if (match) {
        return Math.round(parseFloat(match[1]));
    }
    return 0;
}

// ----------------------------------------------------
// UI Sync Bindings
// ----------------------------------------------------



// Cash sync
cashInput.addEventListener("input", (e) => {
    let val = parseInt(e.target.value) || 0;
    if (val > 1000000000) val = 1000000000;
    cashSlider.value = val;
    updateCashDisplay(val);
});

cashSlider.addEventListener("input", (e) => {
    let val = parseInt(e.target.value);
    cashInput.value = val;
    updateCashDisplay(val);
});

function setCash(value) {
    cashInput.value = value;
    cashSlider.value = value;
    updateCashDisplay(value);
}

function updateCashDisplay(value) {
    cashFormatted.textContent = `$${value.toLocaleString()}`;
}

// Fuel sync
fuelInput.addEventListener("input", (e) => {
    let val = parseInt(e.target.value) || 0;
    if (val > 999999) val = 999999;
    fuelSlider.value = val;
    updateFuelDisplay(val);
});

fuelSlider.addEventListener("input", (e) => {
    let val = parseInt(e.target.value);
    fuelInput.value = val;
    updateFuelDisplay(val);
});

function setFuel(value) {
    fuelInput.value = value;
    fuelSlider.value = value;
    updateFuelDisplay(value);
}

function updateFuelDisplay(value) {
    fuelFormatted.textContent = `${value.toLocaleString()} units`;
}

// Stockpile Maxing
stockpileBtn.addEventListener("click", () => {
    SUPPORT_ITEMS.forEach(item => {
        customStockpile[item] = 99;
    });
    stockpileFormatted.textContent = "Maxed Stockpile (99)";
    stockpileFormatted.className = "stockpile-display highlight";
    stockpileBtn.textContent = "ACTIVATED";
    stockpileBtn.className = "btn btn-xs btn-highlight";
});

// Custom Depot Modal triggers
customDepotBtn.addEventListener("click", () => {
    depotSearch.value = "";
    renderDepotList();
    depotModal.classList.remove("hidden");
});

closeDepotModal.addEventListener("click", () => {
    depotModal.classList.add("hidden");
});

depotClearBtn.addEventListener("click", () => {
    SUPPORT_ITEMS.forEach(item => {
        customStockpile[item] = 0;
    });
    renderDepotList();
});

depotApplyBtn.addEventListener("click", () => {
    depotModal.classList.add("hidden");
    // Check if there are any non-zero items
    let nonZeroCount = 0;
    for (let item in customStockpile) {
        if (customStockpile[item] > 0) nonZeroCount++;
    }
    if (nonZeroCount > 0) {
        stockpileFormatted.textContent = `Custom Depot (${nonZeroCount} items)`;
        stockpileFormatted.className = "stockpile-display highlight";
    } else {
        stockpileFormatted.textContent = "Empty Stockpile";
        stockpileFormatted.className = "stockpile-display";
    }
    stockpileBtn.textContent = "MAX STOCKPILE (99)";
    stockpileBtn.className = "btn btn-xs btn-highlight";
});

depotSearch.addEventListener("input", (e) => {
    renderDepotList(e.target.value);
});

function renderDepotList(filter = "") {
    depotItemsList.innerHTML = "";
    const lowerFilter = filter.toLowerCase();
    
    SUPPORT_ITEMS.forEach(item => {
        if (filter && !item.toLowerCase().includes(lowerFilter)) {
            return;
        }
        
        const val = customStockpile[item] || 0;
        
        const itemDiv = document.createElement("div");
        itemDiv.className = "depot-item";
        
        const nameSpan = document.createElement("span");
        nameSpan.className = "depot-item-name";
        nameSpan.textContent = item;
        
        const inputEl = document.createElement("input");
        inputEl.type = "number";
        inputEl.min = "0";
        inputEl.max = "999";
        inputEl.value = val;
        inputEl.className = "input-num depot-item-input";
        
        inputEl.addEventListener("input", (e) => {
            let v = parseInt(e.target.value) || 0;
            if (v < 0) v = 0;
            if (v > 999) v = 999;
            customStockpile[item] = v;
        });
        
        itemDiv.appendChild(nameSpan);
        itemDiv.appendChild(inputEl);
        depotItemsList.appendChild(itemDiv);
    });
}

// Raw Database Modal triggers
rawEditorBtn.addEventListener("click", () => {
    rawTextarea.value = saveLuaText;
    rawModal.classList.remove("hidden");
});

closeRawModal.addEventListener("click", () => {
    rawModal.classList.add("hidden");
});

rawApplyBtn.addEventListener("click", () => {
    const text = rawTextarea.value;
    
    // Simple bracket checks before applying
    let openBr = (text.match(/{/g) || []).length;
    let closeBr = (text.match(/}/g) || []).length;
    if (openBr !== closeBr) {
        if (!confirm(`Warning: The number of open brackets ({: ${openBr}}) does not match close brackets (}: ${closeBr}}). Applying this change may corrupt the save. Save anyway?`)) {
            return;
        }
    }
    
    saveLuaText = text;
    // Re-parse the stockpile block in case they changed it raw
    customStockpile = parseStockpile(saveLuaText);
    
    rawModal.classList.add("hidden");
    alert("Raw database changes applied to session cache!");
});

// Factions sliders
FACTIONS.forEach(fac => {
    const slider = document.querySelector(`#faction-${fac.toLowerCase()} .faction-slider`);
    const badge = document.querySelector(`#faction-${fac.toLowerCase()} .mood-badge`);
    if (slider && badge) {
        slider.addEventListener("input", (e) => {
            let val = parseInt(e.target.value);
            updateMoodBadge(badge, val);
        });
    }
});

function updateMoodBadge(badge, val) {
    badge.className = "mood-badge";
    if (val <= -25) {
        badge.classList.add("mood-hostile");
        badge.textContent = `Hostile (${val})`;
    } else if (val >= 25) {
        badge.classList.add("mood-friendly");
        badge.textContent = `Friendly (${val})`;
    } else {
        badge.classList.add("mood-neutral");
        badge.textContent = `Neutral (${val})`;
    }
}

function setAllFactions(val) {
    FACTIONS.forEach(fac => {
        let slider = document.querySelector(`#faction-${fac.toLowerCase()} .faction-slider`);
        let badge = document.querySelector(`#faction-${fac.toLowerCase()} .mood-badge`);
        if (slider && badge) {
            slider.value = val;
            updateMoodBadge(badge, val);
        }
    });
}

// ----------------------------------------------------
// Lua Modification Logic
// ----------------------------------------------------

function modifyRelations(luaText, pmcRelations) {
    let startIdx = luaText.indexOf('["tRelations"] = {');
    if (startIdx === -1) return luaText;
    
    // Count brackets to locate end of tRelations
    let bracketCount = 0;
    let endIdx = -1;
    for (let i = startIdx + 17; i < luaText.length; i++) {
        if (luaText[i] === '{') bracketCount++;
        else if (luaText[i] === '}') {
            if (bracketCount === 0) {
                endIdx = i;
                break;
            }
            bracketCount--;
        }
    }
    if (endIdx === -1) return luaText;
    
    let relsBlock = luaText.substring(startIdx, endIdx + 1);
    
    // 1. Modify PMC sub-block inside relations table
    let pmcStart = relsBlock.indexOf('["Pmc"] = {');
    if (pmcStart !== -1) {
        let pmcEnd = relsBlock.indexOf('}', pmcStart);
        let pmcSubBlock = relsBlock.substring(pmcStart, pmcEnd + 1);
        
        for (let faction in pmcRelations) {
            let val = pmcRelations[faction].toFixed(6);
            let re = new RegExp('(\\["' + faction + '"\\]\\s*=\\s*)[-0-9.]+');
            pmcSubBlock = pmcSubBlock.replace(re, '$1' + val);
        }
        
        relsBlock = relsBlock.substring(0, pmcStart) + pmcSubBlock + relsBlock.substring(pmcEnd + 1);
    }
    
    // 2. Modify other factions' sub-blocks inside relations table (symmetrical update)
    for (let faction in pmcRelations) {
        let val = pmcRelations[faction].toFixed(6);
        let facStart = relsBlock.indexOf('["' + faction + '"] = {');
        if (facStart !== -1) {
            let facEnd = relsBlock.indexOf('}', facStart);
            let facSubBlock = relsBlock.substring(facStart, facEnd + 1);
            
            let re = new RegExp('(\\["Pmc"\\]\\s*=\\s*)[-0-9.]+');
            facSubBlock = facSubBlock.replace(re, '$1' + val);
            
            relsBlock = relsBlock.substring(0, facStart) + facSubBlock + relsBlock.substring(facEnd + 1);
        }
    }
    
    return luaText.substring(0, startIdx) + relsBlock + luaText.substring(endIdx + 1);
}

function parseStockpile(luaText) {
    const stockpile = {};
    SUPPORT_ITEMS.forEach(item => {
        stockpile[item] = 0;
    });
    
    let startIdx = luaText.indexOf('["tStockpile"] = {');
    if (startIdx === -1) return stockpile;
    
    let bracketCount = 0;
    let endIdx = -1;
    for (let i = startIdx + 18; i < luaText.length; i++) {
        if (luaText[i] === '{') bracketCount++;
        else if (luaText[i] === '}') {
            if (bracketCount === 0) {
                endIdx = i;
                break;
            }
            bracketCount--;
        }
    }
    if (endIdx === -1) return stockpile;
    
    const block = luaText.substring(startIdx, endIdx + 1);
    
    SUPPORT_ITEMS.forEach(item => {
        const re = new RegExp('\\["' + item + '"\\]\\s*=\\s*\\{[^}]*?\\["nAmt"\\]\\s*=\\s*([-0-9.]+)');
        const match = block.match(re);
        if (match) {
            stockpile[item] = Math.round(parseFloat(match[1]));
        }
    });
    
    return stockpile;
}

function modifyStockpile(luaText, stockpile) {
    let startIdx = luaText.indexOf('["tStockpile"] = {');
    if (startIdx === -1) return luaText;
    
    let bracketCount = 0;
    let endIdx = -1;
    for (let i = startIdx + 18; i < luaText.length; i++) {
        if (luaText[i] === '{') bracketCount++;
        else if (luaText[i] === '}') {
            if (bracketCount === 0) {
                endIdx = i;
                break;
            }
            bracketCount--;
        }
    }
    if (endIdx === -1) return luaText;
    
    // Construct new tStockpile block. Only write items where count > 0 to keep save clean and small.
    let newStockpileBlock = '["tStockpile"] = {\n';
    for (let item in stockpile) {
        let val = stockpile[item] || 0;
        if (val > 0) {
            newStockpileBlock += `["${item}"] = {\n["nAmt"] = ${val.toFixed(6)},\n["bNew"] = true,\n},\n`;
        }
    }
    newStockpileBlock += '}';
    
    return luaText.substring(0, startIdx) + newStockpileBlock + luaText.substring(endIdx + 1);
}

// ----------------------------------------------------
// Save Generation & Download
// ----------------------------------------------------

downloadBtn.addEventListener("click", () => {
    if (!originalFileBytes) return;
    
    const cashValue = parseInt(cashInput.value) || 0;
    const fuelValue = parseInt(fuelInput.value) || 0;
    
    // Get faction relation values
    const pmcRelations = {};
    FACTIONS.forEach(fac => {
        let slider = document.querySelector(`#faction-${fac.toLowerCase()} .faction-slider`);
        if (slider) {
            pmcRelations[fac] = parseFloat(slider.value);
        }
    });
    
    // 1. Modify the Lua table string
    let modifiedLua = saveLuaText;
    
    // Update nCash
    modifiedLua = modifiedLua.replace(/(\["nCash"\]\s*=\s*)[-0-9.]+/, '$1' + cashValue.toFixed(6));
    // Update nFuel
    modifiedLua = modifiedLua.replace(/(\["nFuel"\]\s*=\s*)[-0-9.]+/, '$1' + fuelValue.toFixed(6));
    // Update relations
    modifiedLua = modifyRelations(modifiedLua, pmcRelations);
    
    // Update stockpile using current stockpile amounts
    modifiedLua = modifyStockpile(modifiedLua, customStockpile);
    
    // 2. Compress the Lua text back using zlib
    const encoder = new TextEncoder();
    const luaBytes = encoder.encode(modifiedLua);
    let compressedBytes;
    try {
        compressedBytes = pako.deflate(luaBytes);
        console.log(`Original compressed size: ${originalFileBytes.length - 0x0468} bytes`);
        console.log(`New compressed size: ${compressedBytes.length} bytes`);
    } catch (err) {
        alert("Failed to compress save game. Try setting lower values.");
        console.error(err);
        return;
    }
    
    const maxCompressedSize = 13404 - 0x0468;
    if (compressedBytes.length > maxCompressedSize) {
        alert(`Error: Edited save state is too large to fit in slot. (Compressed size ${compressedBytes.length} bytes, maximum is ${maxCompressedSize} bytes). Consider editing fewer standings or stockpiles.`);
        return;
    }
    
    // 3. Construct new file payload
    const newFileBytes = new Uint8Array(13404);
    
    // Copy the original header contents
    newFileBytes.set(originalFileBytes.subarray(0, 0x0468), 0);
    
    // Update header values
    writeUint32LE(newFileBytes, 0x18, cashValue);
    writeUint32LE(newFileBytes, 0x1C, fuelValue);
    
    // Keep character ID and outfit ID from the original save
    newFileBytes[0x004D] = originalFileBytes[0x004D];
    newFileBytes[0x004F] = originalFileBytes[0x004F];
    
    // Copy compressed payload
    newFileBytes.set(compressedBytes, 0x0468);
    
    // 4. Compute Checksum
    const checksum = crc32Mpeg2(newFileBytes.subarray(4));
    writeUint32LE(newFileBytes, 0, checksum);
    console.log("New file checksum:", checksum.toString(16).toUpperCase());
    
    // 5. Trigger download
    const blob = new Blob([newFileBytes], { type: "application/octet-stream" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = originalFileName || "EditedSave.profile";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log("Downloaded modified save file.");
});
