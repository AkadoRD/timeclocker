/**
 * Admin Panel Logic for the Employee Time Clock.
 * Handles:
 * - Admin authentication & profile management.
 * - Real-time monitoring of time entries.
 * - CRUD operations for Employees, Clients, and Time Entries.
 * - Reporting and data export.
 * - Dashboard with daily and weekly summaries.
 */

// --- GLOBAL STATE & SETUP ---
const SUPABASE_URL = 'https://jqppakaodpgbtxzpvsti.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxcHBha2FvZHBnYnR4enB2c3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMDIxOTEsImV4cCI6MjA4NjY3ODE5MX0.ksc0lzbjlMxC942dkSBSwJHpnwTjcyFV4ZX91LFtijk';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// In-memory cache for frequently accessed data.
let allEmployees = [];
let allClients = [];
let timeEntriesListener = null;
let currentUser = null;

// --- LOGGING SYSTEM ---
/**
 * Logs an action to the activity_logs table for auditing and debugging.
 * @param {string} action - Action type: create, update, delete, clock_in, clock_out, auth_error
 * @param {string} tableName - Table name: employees, clients, time_entries
 * @param {string|null} recordId - ID of the affected record
 * @param {object|null} details - Additional details about the action
 * @param {string} status - 'success' or 'failed'
 * @param {string|null} errorMessage - Error message if status is 'failed'
 */
async function logEvent(action, tableName, recordId, details = null, status = 'success', errorMessage = null) {
    try {
        if (!currentUser) return; // Don't log if user not authenticated
        
        const logData = {
            user_id: currentUser.id,
            action,
            table_name: tableName,
            record_id: recordId,
            details: details ? JSON.stringify(details) : null,
            status,
            error_message: errorMessage
        };

        const { error } = await _supabase.from('activity_logs').insert([logData]);
        if (error) {
            console.error('❌ Failed to log activity:', error);
        } else {
            console.log(`✓ Activity logged: ${action} on ${tableName}`);
        }
    } catch (err) {
        console.error('❌ Error in logEvent:', err);
        // Don't throw - logging should never break the app
    }
}

// --- VALIDATION SYSTEM ---
/**
 * Input validation utilities for secure data handling
 */
const Validators = {
    /**
     * Validate a name field (employee, client)
     * @returns {string} error message or empty string if valid
     */
    validateName: (name) => {
        if (!name || typeof name !== 'string') return 'Name is required and must be text.';
        const trimmed = name.trim();
        if (trimmed.length === 0) return 'Name cannot be empty.';
        if (trimmed.length > 255) return 'Name must be less than 255 characters.';
        // Allow only alphanumeric, spaces, and common punctuation
        if (!/^[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s\-\.\']+$/.test(trimmed)) {
            return 'Name contains invalid characters.';
        }
        return '';
    },

    /**
     * Validate employee ID (4 digits 0000-9999)
     * @returns {string} error message or empty string if valid
     */
    validateEmployeeID: (id) => {
        if (!id || typeof id !== 'string') return 'Employee ID is required.';
        if (!/^\d{4}$/.test(id.trim())) return 'Employee ID must be exactly 4 digits (0000-9999).';
        return '';
    },

    /**
     * Validate email format
     * @returns {string} error message or empty string if valid
     */
    validateEmail: (email) => {
        if (!email || typeof email !== 'string') return 'Email is required.';
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) return 'Please enter a valid email address.';
        if (email.length > 255) return 'Email is too long.';
        return '';
    },

    /**
     * Validate date/datetime input
     * @returns {string} error message or empty string if valid
     */
    validateDateTime: (dateString) => {
        if (!dateString) return 'Date and time are required.';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Invalid date and time format.';
        return '';
    },

    /**
     * Validate UUID format
     * @returns {string} error message or empty string if valid
     */
    validateUUID: (uuid) => {
        if (!uuid) return 'ID is required.';
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(uuid)) return 'Invalid ID format.';
        return '';
    },

    /**
     * Validate select/dropdown selection
     * @returns {string} error message or empty string if valid
     */
    validateSelection: (value, fieldName = 'Selection') => {
        if (!value || value === '') return `${fieldName} is required.`;
        return '';
    },

    /**
     * Sanitize input to prevent XSS (basic)
     * @returns {string} sanitized input
     */
    sanitize: (input) => {
        if (typeof input !== 'string') return input;
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .trim();
    }
};

// --- LOGGING SYSTEM ---

// --- AUTHENTICATION & INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    checkSessionAndInitialize();
});

async function checkSessionAndInitialize() {
    try {
        const { data: { session }, error } = await _supabase.auth.getSession();
        if (error || !session) {
            window.location.href = 'admin_login.html';
            return;
        }

        // Store current user for logging
        currentUser = session.user;

        // Populate profile form with user data
        const user = session.user;
        document.getElementById('profile-name').value = user.user_metadata.name || '';
        document.getElementById('profile-email').value = user.email;

        document.getElementById('app-container').style.display = 'block';
        await loadInitialData();
        subscribeToTimeEntries();
        setupEventListeners();
        
        // Log successful initialization
        await logEvent('auth_success', 'auth', user.id, { email: user.email }, 'success');

    } catch (err) {
        console.error("Error during session check:", err);
        if (currentUser) {
            await logEvent('auth_error', 'auth', currentUser.id, { action: 'session_check' }, 'failed', err.message);
        }
        document.body.innerHTML = `<div>Authentication Error: ${err.message}. <a href="admin_login.html">Return to Login</a></div>`;
    }
}

_supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        if (timeEntriesListener) {
            _supabase.removeChannel(timeEntriesListener);
        }
        window.location.href = 'admin_login.html';
    }
});

function setupEventListeners() {
    document.getElementById('logout-button').addEventListener('click', () => _supabase.auth.signOut());

    document.querySelectorAll('.nav-button').forEach(button => {
        button.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));
            document.getElementById(e.target.dataset.panel).classList.add('active');
        });
    });
    
    // Add listeners for all forms
    document.getElementById('employee-form').addEventListener('submit', saveEmployee);
    document.getElementById('client-form').addEventListener('submit', saveClient);
    document.getElementById('time-entry-form').addEventListener('submit', saveTimeEntry);
    document.getElementById('profile-form').addEventListener('submit', saveProfile);
}

// --- REAL-TIME FUNCTIONALITY ---
function subscribeToTimeEntries() {
    if (timeEntriesListener) return;

    timeEntriesListener = _supabase.channel('public:time_entries')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'time_entries' }, 
            (payload) => {
                showToast('Activity detected. Refreshing data...', 'success');
                loadInitialData(); 
            }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') console.log('Successfully subscribed to real-time updates.');
            else if (err) console.error('Realtime subscription failed:', err);
        });
}

// --- DATA FETCHING & RENDERING ---
async function loadInitialData() {
    try {
        const [clientsRes, employeesRes, timeEntriesRes] = await Promise.all([
            _supabase.from('clients').select('id, name'),
            _supabase.from('employees').select('*, client:clients(name)'),
            _supabase.from('time_entries').select('*, employee:employees(*, client:clients(name))').order('clock_in', { ascending: false }).limit(50)
        ]);

        if (clientsRes.error) throw clientsRes.error;
        if (employeesRes.error) throw employeesRes.error;
        if (timeEntriesRes.error) throw timeEntriesRes.error;

        allClients = clientsRes.data;
        allEmployees = employeesRes.data;
        
        await renderDashboardAndTables(timeEntriesRes.data);

    } catch (error) {
        showToast('Error loading initial data: ' + error.message, 'error');
    }
}

async function renderDashboardAndTables(timeEntries) {
    try {
        if (!timeEntries || !Array.isArray(timeEntries)) {
            throw new Error('Invalid time entries data.');
        }

        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

        const { data: weeklyEntries, error: weeklyErr } = await _supabase.from('time_entries').select('employee_id, clock_in').gte('clock_in', sevenDaysAgo.toISOString());
        if (weeklyErr) throw weeklyErr;

        renderDashboard(timeEntries, weeklyEntries);
        renderAllManagementTables(timeEntries);
    } catch (error) {
        console.error('❌ Error rendering dashboard:', error);
        showToast('Error loading dashboard: ' + error.message, 'error');
    }
}

function renderAllManagementTables(timeEntries) {
    renderClients(allClients);
    populateClientDropdown(allClients);
    renderEmployees(allEmployees);
    populateEmployeeDropdown();
    renderTimeEntries(timeEntries);
}

// --- DASHBOARD & PROFILE ---

function renderDashboard(recentEntries, weeklyEntries) {
    renderTodaysActivity(recentEntries);
    renderWeeklyAttendance(weeklyEntries);
}

async function saveProfile(event) {
    event.preventDefault();
    try {
        const name = document.getElementById('profile-name').value;
        const password = document.getElementById('profile-password').value;
        const passwordConfirm = document.getElementById('profile-password-confirm').value;
        
        // Validation
        if (!name || name.trim().length === 0) {
            throw new Error('Name is required.');
        }

        const updateData = {
            data: { name: name.trim() }
        };

        if (password) {
            if (password.length < 6) {
                throw new Error('Password must be at least 6 characters long.');
            }
            if (password !== passwordConfirm) {
                throw new Error('Passwords do not match.');
            }
            updateData.password = password;
        }

        const { error } = await _supabase.auth.updateUser(updateData);
        if (error) throw error;

        showToast('Profile updated successfully!', 'success');
        document.getElementById('profile-password').value = '';
        document.getElementById('profile-password-confirm').value = '';
    } catch (error) {
        console.error('❌ Error updating profile:', error);
        showToast('Failed to update profile: ' + error.message, 'error');
    }
}


function renderTodaysActivity(entries) {
    const list = document.getElementById('todays-activity-list');
    const startOfDay = new Date().setHours(0, 0, 0, 0);

    const todaysEntries = entries.filter(entry => new Date(entry.clock_in) >= startOfDay);

    if (todaysEntries.length === 0) {
        list.innerHTML = '<p>No employee activity recorded yet today.</p>';
        return;
    }

    list.innerHTML = `<ul>${todaysEntries.map(entry => {
        const employeeName = entry.employee ? entry.employee.name : `ID: ${entry.employee_id}`;
        const status = entry.clock_out ? `Clocked out at ${new Date(entry.clock_out).toLocaleTimeString()}` : 'Clocked In';
        return `<li><strong>${employeeName}</strong> - <span>${status}</span></li>`;
    }).join('')}</ul>`;
}

function renderWeeklyAttendance(entries) {
    const chartContainer = document.getElementById('weekly-attendance-chart');
    const attendance = {};
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        attendance[dayName] = new Set();
    }

    entries.forEach(entry => {
        const dayName = new Date(entry.clock_in).toLocaleDateString('en-US', { weekday: 'short' });
        if (attendance.hasOwnProperty(dayName)) {
            attendance[dayName].add(entry.employee_id);
        }
    });

    const maxAttendance = Math.max(...Object.values(attendance).map(s => s.size), 1);

    let chartHtml = '<div class="chart-bars">';
    for (const day in attendance) {
        const count = attendance[day].size;
        const barHeight = (count / maxAttendance) * 100;
        chartHtml += `<div class="chart-bar-group"><div class="chart-bar" style="height: ${barHeight}%;"><span class="bar-label">${count}</span></div><div class="day-label">${day}</div></div>`;
    }
    chartHtml += '</div>';
    chartContainer.innerHTML = chartHtml;
}

// Other functions remain unchanged...

// --- UI RENDERING & DOM MANIPULATION (Management Panels) ---

function renderEmployees(employees) {
    const tableBody = document.querySelector('#employees-table tbody');
    tableBody.innerHTML = '';
    employees.sort((a, b) => a.name.localeCompare(b.name)).forEach(emp => {
        const clientName = emp.client ? emp.client.name : 'N/A';
        tableBody.innerHTML += `
            <tr>
                <td>${emp.name}</td>
                <td>${emp.employee_id}</td>
                <td>${clientName}</td>
                <td>${emp.active ? 'Yes' : 'No'}</td>
                <td>
                    <button onclick="editEmployee(${emp.id})">Edit</button>
                    <button class="secondary" onclick="toggleEmployeeActive(${emp.id}, ${emp.active})">${emp.active ? 'Deactivate' : 'Activate'}</button>
                </td>
            </tr>`;
    });
}

function renderClients(clients) {
    const tableBody = document.querySelector('#clients-table tbody');
    tableBody.innerHTML = '';
    clients.sort((a, b) => a.name.localeCompare(b.name)).forEach(client => {
        tableBody.innerHTML += `
            <tr>
                <td>${client.name}</td>
                <td>
                    <button onclick="editClient(${client.id}, '${client.name}')">Edit</button>
                    <button class="secondary" onclick="deleteClient(${client.id})">Delete</button>
                </td>
            </tr>`;
    });
}

function renderTimeEntries(entries) {
    const tableBody = document.querySelector('#time-entries-table tbody');
    tableBody.innerHTML = '';
    entries.forEach(entry => {
        const employeeName = entry.employee ? entry.employee.name : 'Unknown';
        const clientName = (entry.employee && entry.employee.client) ? entry.employee.client.name : 'N/A';
        const rowHtml = `
            <tr>
                <td>${employeeName}</td>
                <td>${clientName}</td>
                <td>${new Date(entry.clock_in).toLocaleString()}</td>
                <td>${entry.clock_out ? new Date(entry.clock_out).toLocaleString() : 'Active'}</td>
                <td>${entry.location ? `<a href="https://www.google.com/maps?q=${JSON.parse(entry.location).latitude},${JSON.parse(entry.location).longitude}" target="_blank">View Map</a>` : ''}</td>
                <td>
                    <button onclick="editTimeEntry('${entry.id}')">Edit</button>
                    ${!entry.clock_out ? `<button class="secondary" onclick="manualClockOut('${entry.id}')">Clock Out</button>` : ''}
                    <button class="secondary" onclick="deleteTimeEntry('${entry.id}')">Delete</button>
                </td>
            </tr>
        `;
        tableBody.innerHTML += rowHtml;
    });
}

function populateClientDropdown(clients) {
    const clientSelect = document.getElementById('employee-client');
    const currentVal = clientSelect.value;
    clientSelect.innerHTML = '<option value="">Select Client</option>';
    clients.forEach(c => {
        clientSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
    clientSelect.value = currentVal;
}

function populateEmployeeDropdown() {
    const employeeSelect = document.getElementById('time-entry-employee');
    employeeSelect.innerHTML = '<option value="">Select Employee</option>';
    allEmployees.filter(e => e.active).sort((a,b) => a.name.localeCompare(b.name)).forEach(e => {
        employeeSelect.innerHTML += `<option value="${e.id}">${e.name} (${e.client.name})</option>`;
    });
}

function showToast(message, type = 'success', duration = 4000) {
    const container = document.getElementById('notification-container');
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

// --- CRUD OPERATIONS: EMPLOYEES ---

async function saveEmployee(event) {
    event.preventDefault();
    try {
        const id = document.getElementById('employee-id-hidden').value;
        const nameInput = document.getElementById('employee-name').value;
        const empIdInput = document.getElementById('employee-id').value;
        const clientIdInput = document.getElementById('employee-client').value;

        // VALIDATION
        let validationError = Validators.validateName(nameInput);
        if (validationError) throw new Error(validationError);

        validationError = Validators.validateEmployeeID(empIdInput);
        if (validationError) throw new Error(validationError);

        validationError = Validators.validateSelection(clientIdInput, 'Client');
        if (validationError) throw new Error(validationError);

        // Sanitize inputs
        const record = {
            name: Validators.sanitize(nameInput),
            employee_id: empIdInput.trim(),
            client_id: parseInt(clientIdInput, 10),
        };

        const isUpdate = !!id;
        const { error } = isUpdate ? 
            await _supabase.from('employees').update(record).eq('id', id) : 
            await _supabase.from('employees').insert([record]);
        
        if (error) throw error;
        
        // Log the action
        await logEvent(
            isUpdate ? 'update' : 'create',
            'employees',
            id || record.employee_id,
            { name: record.name, employee_id: record.employee_id },
            'success'
        );
        
        showToast('Employee saved successfully.');
        document.getElementById('employee-form').reset();
        document.getElementById('employee-id-hidden').value = '';
        await loadInitialData();
    } catch (error) {
        console.error('❌ Error saving employee:', error);
        await logEvent('create/update', 'employees', null, {}, 'failed', error.message);
        showToast('Failed to save employee: ' + error.message, 'error');
    }
}

function editEmployee(id) {
    const emp = allEmployees.find(e => e.id === id);
    if (!emp) return showToast('Could not find employee data.', 'error');
    
    document.getElementById('employee-id-hidden').value = emp.id;
    document.getElementById('employee-name').value = emp.name;
    document.getElementById('employee-id').value = emp.employee_id;
    document.getElementById('employee-client').value = emp.client_id;
    document.getElementById('employees-panel').scrollIntoView();
}

async function toggleEmployeeActive(id, currentStatus) {
    try {
        if (!id) throw new Error('Invalid employee ID.');
        
        const { error } = await _supabase.from('employees').update({ active: !currentStatus }).eq('id', id);
        if (error) throw error;
        
        // Log the action
        await logEvent('update', 'employees', id, { active: !currentStatus }, 'success');
        
        showToast(`Employee ${!currentStatus ? 'activated' : 'deactivated'}.`, 'success');
        await loadInitialData();
    } catch (error) {
        console.error('❌ Error toggling employee status:', error);
        await logEvent('update', 'employees', id, { action: 'toggle_active' }, 'failed', error.message);
        showToast('Failed to update employee status: ' + error.message, 'error');
    }
}

// --- CRUD OPERATIONS: CLIENTS ---

async function saveClient(event) {
    event.preventDefault();
    try {
        const id = document.getElementById('client-id-hidden').value;
        const nameInput = document.getElementById('client-name').value;

        // VALIDATION
        let validationError = Validators.validateName(nameInput);
        if (validationError) throw new Error(validationError);

        // Sanitize input
        const record = { 
            name: Validators.sanitize(nameInput),
        };

        const isUpdate = !!id;
        const { error } = isUpdate ? 
            await _supabase.from('clients').update(record).eq('id', id) : 
            await _supabase.from('clients').insert([record]);
        
        if (error) throw error;
        
        // Log the action
        await logEvent(
            isUpdate ? 'update' : 'create',
            'clients',
            id || record.name,
            { name: record.name },
            'success'
        );
        
        showToast('Client saved successfully.');
        document.getElementById('client-form').reset();
        document.getElementById('client-id-hidden').value = '';
        await loadInitialData();
    } catch (error) {
        console.error('❌ Error saving client:', error);
        await logEvent('create/update', 'clients', null, {}, 'failed', error.message);
        showToast('Failed to save client: ' + error.message, 'error');
    }
}

function editClient(id, name) {
    document.getElementById('client-id-hidden').value = id;
    document.getElementById('client-name').value = name;
    document.querySelector('[data-panel="clients-panel"]').click();
    document.getElementById('clients-panel').scrollIntoView();
}

async function deleteClient(id) {
    try {
        if (!confirm('Are you sure you want to delete this client?')) return;
        if (!id) throw new Error('Invalid client ID.');
        
        const { error } = await _supabase.from('clients').delete().eq('id', id);
        if (error) throw error;
        
        // Log the action
        await logEvent('delete', 'clients', id, {}, 'success');
        
        showToast('Client deleted successfully.', 'success');
        await loadInitialData();
    } catch (error) {
        console.error('❌ Error deleting client:', error);
        await logEvent('delete', 'clients', id, {}, 'failed', error.message);
        showToast('Error deleting client: ' + error.message, 'error');
    }
}

// --- CRUD OPERATIONS: TIME ENTRIES ---

async function saveTimeEntry(event) {
    event.preventDefault();
    try {
        const id = document.getElementById('time-entry-id-hidden').value;
        const employeeId = document.getElementById('time-entry-employee').value;
        const clockInInput = document.getElementById('time-entry-clock-in').value;
        const clockOutInput = document.getElementById('time-entry-clock-out').value;

        // VALIDATION
        let validationError = Validators.validateSelection(employeeId, 'Employee');
        if (validationError) throw new Error(validationError);

        validationError = Validators.validateDateTime(clockInInput);
        if (validationError) throw new Error('Clock In: ' + validationError);

        if (clockOutInput) {
            validationError = Validators.validateDateTime(clockOutInput);
            if (validationError) throw new Error('Clock Out: ' + validationError);
            
            // Validate clock_out is after clock_in
            if (new Date(clockOutInput) < new Date(clockInInput)) {
                throw new Error('Clock Out time must be after Clock In time.');
            }
        }

        const selectedEmployee = allEmployees.find(e => e.id == employeeId);
        if (!selectedEmployee) throw new Error('Invalid employee selected.');

        const record = {
            employee_id: selectedEmployee.employee_id,
            client_id: selectedEmployee.client_id,
            clock_in: new Date(clockInInput).toISOString(),
            clock_out: clockOutInput ? new Date(clockOutInput).toISOString() : null,
        };

        const isUpdate = !!id;
        const { error } = isUpdate ? 
            await _supabase.from('time_entries').update(record).eq('id', id) : 
            await _supabase.from('time_entries').insert([record]);
        
        if (error) throw error;
        
        // Log the action
        await logEvent(
            isUpdate ? 'update' : 'create',
            'time_entries',
            id,
            { employee_id: selectedEmployee.employee_id, clock_in: record.clock_in, clock_out: record.clock_out },
            'success'
        );
        
        showToast('Time entry saved successfully.');
        document.getElementById('time-entry-form').reset();
        document.getElementById('time-entry-id-hidden').value = '';
        await loadInitialData();
    } catch (error) {
        console.error('❌ Error saving time entry:', error);
        await logEvent('create/update', 'time_entries', null, {}, 'failed', error.message);
        showToast('Failed to save time entry: ' + error.message, 'error');
    }
}

async function editTimeEntry(id) {
    try {
        if (!id) throw new Error('Invalid time entry ID.');
        
        const { data, error } = await _supabase.from('time_entries').select('*, employee:employees(*)').eq('id', id).single();
        if (error) throw error;
        if (!data) throw new Error('Time entry not found.');

        const formatForInput = (date) => date ? new Date(new Date(date).getTime() - (new Date(date).getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : '';

        document.getElementById('time-entry-id-hidden').value = data.id;
        document.getElementById('time-entry-employee').value = allEmployees.find(e => e.id === data.employee.id)?.id || '';
        document.getElementById('time-entry-clock-in').value = formatForInput(new Date(data.clock_in));
        document.getElementById('time-entry-clock-out').value = data.clock_out ? formatForInput(new Date(data.clock_out)) : '';
        
        // Subir al formulario de edición
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('❌ Error fetching time entry:', error);
        showToast('Could not fetch time entry data: ' + error.message, 'error');
    }
}

async function manualClockOut(entryId) {
    if (!confirm('Are you sure you want to manually clock out this entry?')) return;
    try {
        const { error } = await _supabase.from('time_entries').update({ clock_out: new Date().toISOString() }).eq('id', entryId);
        if (error) throw error;
        showToast('Entry successfully clocked out.');
        await loadInitialData();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function deleteTimeEntry(id) {
    try {
        if (!confirm('Are you sure you want to delete this time entry?')) return;
        if (!id) throw new Error('Invalid time entry ID.');
        
        const { error } = await _supabase.from('time_entries').delete().eq('id', id);
        if (error) throw error;
        
        // Log the action
        await logEvent('delete', 'time_entries', id, {}, 'success');
        
        showToast('Time entry deleted successfully.', 'success');
        await loadInitialData();
    } catch (error) {
        console.error('❌ Error deleting time entry:', error);
        await logEvent('delete', 'time_entries', id, {}, 'failed', error.message);
        showToast('Error deleting time entry: ' + error.message, 'error');
    }
}

async function findDuplicateIds() {
    const resultsContainer = document.getElementById('duplicate-id-results');
    resultsContainer.innerHTML = '<p>Searching...</p>';
    const idMap = new Map();
    allEmployees.forEach(emp => {
        if (!idMap.has(emp.employee_id)) idMap.set(emp.employee_id, []);
        idMap.get(emp.employee_id).push(emp);
    });
    const duplicates = Array.from(idMap.values()).filter(arr => arr.length > 1);
    if (duplicates.length === 0) {
        resultsContainer.innerHTML = '<p>No duplicate employee IDs found.</p>';
        return;
    }
    let html = '<table><tr><th>Employee ID</th><th>Name</th></tr>';
    duplicates.forEach(group => group.forEach(emp => {
        html += `<tr><td>${emp.employee_id}</td><td>${emp.name}</td></tr>`;
    }));
    html += '</table>';
    resultsContainer.innerHTML = html;
}

async function generateReport() {
    showToast('Report generation logic triggered (Ready to implement export)');
}

// --- CONECTAR FUNCIONES AL OBJETO WINDOW PARA LOS ONCLICK ---
// Esto permite que los botones HTML (onclick="function()") funcionen correctamente
// IMPORTANTE: Debe estar al final del archivo, DESPUÉS de que las funciones estén definidas
window.editEmployee = editEmployee;
window.toggleEmployeeActive = toggleEmployeeActive;
window.editClient = editClient;
window.deleteClient = deleteClient;
window.editTimeEntry = editTimeEntry;
window.deleteTimeEntry = deleteTimeEntry;
window.manualClockOut = manualClockOut;
window.findDuplicateIds = findDuplicateIds;
window.generateReport = generateReport;
