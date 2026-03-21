/**
 * Main application logic for the Employee Time Clock.
 * Handles:
 * - UI interactions and updates.
 * - Real-time employee status checks.
 * - Clock-in and clock-out actions.
 * - Multi-profile employee selection.
 * - Offline action caching and synchronization.
 */

// === KIOSK MODE INITIALIZATION ===
// Disable all gestures and movements for kiosk/tablet display
(() => {
    // Prevent context menu (right-click)
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    // Prevent all scroll
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    document.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: false });
    
    // Prevent zoom
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('touchstart', e => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    
    // Prevent pull-to-refresh (Android)
    let lastY = 0;
    document.addEventListener('touchstart', e => { lastY = e.touches[0].clientY; }, { passive: false });
    document.addEventListener('touchmove', e => {
        const diff = e.touches[0].clientY - lastY;
        if (diff > 0 && window.scrollY === 0) e.preventDefault();
    }, { passive: false });
    
    // Lock viewport position
    window.scrollTo(0, 0);
})();

document.addEventListener('DOMContentLoaded', () => {

    // --- CORE APP SETUP ---
    // Immutable DOM elements and global state variables.

    const empIdInput = document.getElementById('empId');
    const clockInButton = document.querySelector('.clock-in');
    const clockOutButton = document.querySelector('.clock-out');
    const dateEl = document.getElementById('date');
    const clockEl = document.getElementById('clock');
    const modal = document.getElementById('selectionModal');
    const selectionList = document.getElementById('employee-selection-list');
    const cancelSelectionButton = document.querySelector('.modal-content .secondary');
    const statusIndicator = document.getElementById('status-indicator');
    const lastActivity = document.getElementById('last-activity');

    let _supabase;
    let pendingActionType = null;
    let statusCheckTimeout = null;
    const SUPABASE_URL = 'https://jqppakaodpgbtxzpvsti.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxcHBha2FvZHBnYnR4enB2c3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMDIxOTEsImV4cCI6MjA4NjY3ODE5MX0.ksc0lzbjlMxC942dkSBSwJHpnwTjcyFV4ZX91LFtijk';


    // --- UI & DISPLAY LOGIC ---
    // Functions dedicated to updating the user interface.

    /**
     * Displays a non-intrusive toast notification.
     * @param {string} message The message to display.
     * @param {string} [type='success'] 'success' or 'error'.
     * @param {number} [duration=4000] How long to display the message.
     */
    function showToast(message, type = 'success', duration = 4000) {
        const container = document.getElementById('notification-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => container.removeChild(toast), 300);
        }, duration);
    }

    /**
     * Updates the live clock and date display.
     */
    function updateClock() {
        const now = new Date();
        const timeZone = "America/New_York"; 
        clockEl.innerText = now.toLocaleTimeString("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: true });
        dateEl.innerText = now.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" });
    }

    /**
     * Updates the status indicator based on the employee's clock-in status.
     * @param {object|null} statusInfo - Information about the employee's status.
     * @param {string} statusInfo.status - 'in' or 'out'.
     * @param {string} statusInfo.timestamp - The ISO timestamp of the last event.
     * @param {string} statusInfo.clientName - The name of the client associated with the event.
     */
    function updateStatusUI(statusInfo) {
        if (!statusInfo || !statusInfo.status) {
            statusIndicator.className = 'status-out';
            statusIndicator.textContent = 'Clocked Out';
            lastActivity.textContent = 'Enter your ID to see your status';
            return;
        }

        if (statusInfo.status === 'in') {
            statusIndicator.className = 'status-in';
            statusIndicator.textContent = 'Clocked In';
            lastActivity.textContent = `At ${statusInfo.clientName} since ${new Date(statusInfo.timestamp).toLocaleTimeString()}`;
        } else { // 'out'
            statusIndicator.className = 'status-out';
            statusIndicator.textContent = 'Clocked Out';
            lastActivity.textContent = `Last activity: ${new Date(statusInfo.timestamp).toLocaleTimeString()}`;
        }
    }

    /**
     * Resets the main UI to its initial state.
     */
    function resetUI() {
        empIdInput.value = "";
        updateStatusUI(null); // Reset status display
        setMainButtonsDisabled(false);
    }

    /**
     * Disables or enables the main clock-in/out buttons.
     * @param {boolean} disabled - True to disable, false to enable.
     */
    function setMainButtonsDisabled(disabled) {
        clockInButton.disabled = disabled;
        clockOutButton.disabled = disabled;
    }

    /**
     * Displays the modal for selecting between multiple employee profiles.
     * @param {Array<object>} employees - The list of active employee profiles.
     * @param {string} actionType - 'clock_in' or 'clock_out'.
     */
    function showEmployeeSelection(employees, actionType) {
        pendingActionType = actionType;
        selectionList.innerHTML = '';
        employees.forEach(employee => {
            const btn = document.createElement('button');
            const clientName = employee.client ? employee.client.name : 'Unknown Client';
            btn.innerHTML = `${employee.name} <span>at ${clientName}</span>`;
            btn.onclick = () => selectEmployee(employee);
            selectionList.appendChild(btn);
        });
        modal.style.display = 'flex';
    }
    
    /**
     * Cancels the multi-profile selection and resets the UI.
     */
    function cancelSelection() {
        modal.style.display = 'none';
        resetUI();
    }


    // --- DATABASE & CACHE ---
    // Functions for interacting with Supabase and the local browser cache.

    /**
     * Initializes the Supabase client.
     */
    async function initializeApp() {
        try {
            _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        } catch (error) {
            console.error('Failed to initialize Supabase:', error);
            showToast("Error: Could not connect to the server.", 'error');
        }
    }

    /**
     * Retrieves employee records, using online DB first, then falling back to cache.
     * Caches the results on successful online lookup.
     * @param {string} publicEmpId - The 4-digit employee ID.
     * @returns {Promise<{employees: Array|null, error: object|null}>}
     */
    async function getEmployeeRecords(publicEmpId) {
        if (!navigator.onLine) {
            const cachedEmployees = getEmployeeRecordsFromCache(publicEmpId);
            return cachedEmployees ? { employees: cachedEmployees, error: null } : { employees: null, error: { message: 'Offline and no data in cache.' } };
        }

        const { data, error } = await _supabase.from('employees').select(`id, name, active, employee_id, client_id, client:clients(name)`).eq('employee_id', publicEmpId);
        
        if (error) {
            console.error("getEmployeeRecords error:", error);
            showToast('A database error occurred.', 'error');
            return { employees: null, error };
        }
        
        // On successful lookup, cache the data for offline use.
        localStorage.setItem(`employee_cache_${publicEmpId}`, JSON.stringify(data));
        return { employees: data, error: null };
    }

    /**
     * Retrieves employee data from the browser's localStorage.
     * @param {string} publicEmpId - The 4-digit employee ID.
     * @returns {Array|null} The cached employee data.
     */
    function getEmployeeRecordsFromCache(publicEmpId) {
        const cached = localStorage.getItem(`employee_cache_${publicEmpId}`);
        return cached ? JSON.parse(cached) : null;
    }

    /**
     * Fetches the last time entry for an employee ID to determine their current status.
     * Updates the UI with this information.
     * @param {string} publicEmpId - The 4-digit employee ID.
     */
    async function fetchAndDisplayStatus(publicEmpId) {
        if (publicEmpId.length !== 4) {
            updateStatusUI(null); // Reset if ID is not fully entered
            return;
        }

        if (!navigator.onLine) {
            lastActivity.textContent = "Status check unavailable offline.";
            return;
        }

        lastActivity.textContent = "Checking status...";
        
        const { data: latestEntry, error } = await _supabase
            .from('time_entries')
            .select(`*, client:clients(name)`)
            .eq('employee_id', publicEmpId)
            .order('clock_in', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('Status check error:', error);
            lastActivity.textContent = "Could not check status.";
            return;
        }
        
        if (latestEntry) {
            const status = latestEntry.clock_out === null ? 'in' : 'out';
            const clientName = latestEntry.client ? latestEntry.client.name : 'Unknown Client';
            updateStatusUI({
                status: status,
                timestamp: status === 'in' ? latestEntry.clock_in : latestEntry.clock_out,
                clientName: clientName
            });
        } else {
            // For brand new employees, assume they are clocked out.
            updateStatusUI({ status: 'out', timestamp: new Date(), clientName: 'N/A' }); 
            lastActivity.textContent = "No previous activity found.";
        }
    }


    // --- CORE CLOCKING LOGIC ---
    // The main business logic for handling clock-in and clock-out events.

    /**
     * Orchestrates the clocking action, from fetching employee data to handling multiple profiles.
     * @param {string} actionType - 'clock_in' or 'clock_out'.
     */
    async function handleClockAction(actionType) {
        const empId = empIdInput.value.trim();
        if (!empId) {
            showToast("Please enter an Employee ID.", 'error');
            return;
        }

        setMainButtonsDisabled(true);
        showToast("Processing...");

        const { employees, error } = await getEmployeeRecords(empId);
        
        if (error || !employees) {
            if (!navigator.onLine) showToast('Offline: This ID must be used online once before offline use.', 'error');
            setMainButtonsDisabled(false);
            return;
        }

        if (employees.length === 0) {
            showToast('Employee ID not found.', 'error');
            setMainButtonsDisabled(false);
            return;
        }

        const activeEmployees = employees.filter(emp => emp.active);
        if (activeEmployees.length === 0) {
            showToast('This employee ID is inactive.', 'error');
            setMainButtonsDisabled(false);
            return;
        }
        
        if (activeEmployees.length === 1) {
            await performClockAction(actionType, activeEmployees[0]);
        } else {
            // If offline with multiple profiles, user action is required.
            if (!navigator.onLine) {
                showToast('This ID has multiple profiles and requires an internet connection to select one.', 'error', 6000);
                setMainButtonsDisabled(false);
                return;
            }
            showEmployeeSelection(activeEmployees, actionType);
        }
    }

    /**
     * Handles the user's selection from the multi-profile modal.
     * @param {object} employee - The employee profile selected by the user.
     */
    async function selectEmployee(employee) {
        modal.style.display = 'none';
        if (pendingActionType) {
            showToast("Processing...");
            await performClockAction(pendingActionType, employee);
        }
        pendingActionType = null;
    }

    /**
     * Executes the final clock-in or clock-out database operation.
     * Also handles logic for offline action saving.
     * @param {string} actionType - 'clock_in' or 'clock_out'.
     * @param {object} employee - The specific employee profile to use.
     * @param {boolean} [isSyncing=false] - True if this action is part of an offline sync.
     * @param {string|null} [syncTimestamp=null] - The original timestamp for a sync action.
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async function performClockAction(actionType, employee, isSyncing = false, syncTimestamp = null) {
        const now = syncTimestamp || new Date().toISOString();
        const publicEmpId = employee.employee_id;
        const clientId = employee.client_id;
        
        try {
            // If we are not syncing, and we are offline, throw to trigger offline save.
            if (!navigator.onLine && !isSyncing) throw new Error('offline');
            
            const location = isSyncing ? null : await getDeviceLocation();

            if (actionType === 'clock_in') {
                const { data: openEntry } = await _supabase.from("time_entries").select("id").eq("employee_id", publicEmpId).eq("client_id", clientId).is("clock_out", null).maybeSingle();
                if (openEntry) {
                    if (!isSyncing) showToast("You are already clocked in.", 'error');
                    setMainButtonsDisabled(false);
                    return { success: false, error: 'Already clocked in' };
                }
                const { error } = await _supabase.from("time_entries").insert([{ employee_id: publicEmpId, clock_in: now, client_id: clientId, location: location ? JSON.stringify(location) : null }]);
                if (error) throw error;
                if (!isSyncing) showToast("Clocked In!", 'success');

            } else if (actionType === 'clock_out') {
                const { data: openEntry, error: findError } = await _supabase.from("time_entries").select("id").eq("employee_id", publicEmpId).eq("client_id", clientId).is("clock_out", null).maybeSingle();
                if (findError) throw findError;
                if (!openEntry) {
                    if (!isSyncing) showToast("No active clock-in found.", 'error');
                    setMainButtonsDisabled(false);
                    return { success: false, error: 'No active clock-in' };
                }
                const { error } = await _supabase.from("time_entries").update({ clock_out: now, location: location ? JSON.stringify(location) : null }).eq("id", openEntry.id);
                if (error) throw error;
                if (!isSyncing) showToast("Clocked Out!", 'success');
            }

            if (!isSyncing) {
                await fetchAndDisplayStatus(publicEmpId); // Refresh status UI
                // Keep status visible for a moment before clearing input
                setTimeout(() => empIdInput.value = "", 2000);
            }
            return { success: true };

        } catch (error) {
            if (error.message === 'offline' || !navigator.onLine) {
                if (!isSyncing) {
                    showToast('You are offline. Action saved.', 'success');
                    saveOfflineAction({ type: actionType, public_employee_id: publicEmpId, client_id: clientId, timestamp: now });
                    setTimeout(resetUI, 2000);
                }
                return { success: false, error: 'offline' };
            } else {
                console.error('Clock action error:', error);
                if (!isSyncing) {
                    showToast(`Clock action error: ${error.message}`, 'error');
                    setMainButtonsDisabled(false);
                }
                return { success: false, error: error.message };
            }
        }
    }

    /**
     * Attempts to get the user's current geolocation coordinates.
     * @returns {Promise<object|null>} The location object or null.
     */
    async function getDeviceLocation() {
        if (!navigator.geolocation) return null;
        try {
            const position = await new Promise((res, rej) => {
                navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, enableHighAccuracy: true });
            });
            return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
        } catch (geoError) {
            console.warn("Could not get location:", geoError.message);
            showToast(`Could not get location: ${geoError.message}`, 'error');
            return null;
        }
    }


    // --- OFFLINE HANDLING ---
    // Functions for saving actions while offline and syncing when reconnected.

    /**
     * Saves a clocking action to localStorage to be synced later.
     * @param {object} action - The action details to save.
     */
    function saveOfflineAction(action) {
        try {
            let pending = JSON.parse(localStorage.getItem("pendingActions")) || [];
            pending.push(action);
            localStorage.setItem("pendingActions", JSON.stringify(pending));
        } catch (e) {
            console.error("Could not save offline action:", e);
            showToast("Could not save offline action.", 'error');
        }
    }

    /**
     * Processes and syncs actions that were saved while offline.
     */
    async function syncOfflineActions() {
        if (!_supabase || !navigator.onLine) return;
        
        let pendingActions;
        try {
            pendingActions = JSON.parse(localStorage.getItem("pendingActions")) || [];
        } catch (e) {
            console.error("Could not parse pending actions, clearing:", e);
            localStorage.setItem("pendingActions", "[]");
            return;
        }

        if (pendingActions.length === 0) return;
        
        showToast(`Syncing ${pendingActions.length} offline action(s)...`);
        
        const remainingActions = [];
        for (const action of pendingActions) {
            // Basic validation for the stored action
            if (!action || !action.type || !action.public_employee_id || !action.timestamp || action.client_id === null || action.client_id === undefined) {
                console.error("Skipping invalid pending action:", action);
                continue; 
            }
            try {
                const employeeToSync = { employee_id: action.public_employee_id, client_id: action.client_id };
                const result = await performClockAction(action.type, employeeToSync, true, action.timestamp);
                
                // If sync fails for a reason other than a logical conflict, keep it for retry.
                if (!result.success && result.error !== 'Already clocked in' && result.error !== 'No active clock-in') {
                    remainingActions.push(action);
                }
            } catch (syncError) {
                console.error("Error processing a sync action:", syncError);
                remainingActions.push(action);
            }
        }

        localStorage.setItem("pendingActions", JSON.stringify(remainingActions));

        if (remainingActions.length > 0) {
            showToast(`${remainingActions.length} action(s) failed to sync and will be retried.`, 'error');
        } else {
            showToast('Offline actions synced successfully!', 'success');
        }
    }


    // --- INITIALIZATION & EVENT LISTENERS ---
    // Sets up the application, event listeners, and timers.

    // Register service worker for PWA capabilities
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
    }
    
    // Listen for the browser coming back online
    window.addEventListener('online', () => {
        showToast('You are back online. Syncing...', 'success');
        syncOfflineActions();
    });
    
    // Main clocking buttons
    clockInButton.addEventListener('click', () => handleClockAction('clock_in'));
    clockOutButton.addEventListener('click', () => handleClockAction('clock_out'));
    
    // Modal cancel button
    cancelSelectionButton.addEventListener('click', cancelSelection);
    
    // Employee ID input with debounce for status checking
    empIdInput.addEventListener('input', () => {
        clearTimeout(statusCheckTimeout);
        statusCheckTimeout = setTimeout(() => {
            const empId = empIdInput.value.trim();
            fetchAndDisplayStatus(empId);
        }, 500); // Wait 500ms after user stops typing
    });
    
    // Initial application startup sequence
    initializeApp().then(() => {
        syncOfflineActions();
    });

    updateClock();
    setInterval(updateClock, 1000);

});
