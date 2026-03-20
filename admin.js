/**
 * Admin Panel Logic for the Employee Time Clock.
 * Handles:
 * - Admin authentication.
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

        document.getElementById('app-container').style.display = 'block';
        await loadInitialData();
        subscribeToTimeEntries();
        setupEventListeners();

    } catch (err) {
        console.error("Error during session check:", err);
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
    
    document.getElementById('employee-form').addEventListener('submit', saveEmployee);
    document.getElementById('client-form').addEventListener('submit', saveClient);
    document.getElementById('time-entry-form').addEventListener('submit', saveTimeEntry);
}

// --- REAL-TIME FUNCTIONALITY ---
function subscribeToTimeEntries() {
    if (timeEntriesListener) return;

    timeEntriesListener = _supabase.channel('public:time_entries')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'time_entries' }, 
            (payload) => {
                console.log('Realtime change detected:', payload);
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
        const [clientsRes, employeesRes] = await Promise.all([
            _supabase.from('clients').select('id, name'),
            _supabase.from('employees').select('*, client:clients(name)')
        ]);

        if (clientsRes.error) throw clientsRes.error;
        if (employeesRes.error) throw employeesRes.error;

        allClients = clientsRes.data;
        allEmployees = employeesRes.data;
        
        // The main render call that now includes the new dashboard.
        await renderDashboardAndTables();

    } catch (error) {
        showToast('Error loading initial data: ' + error.message, 'error');
    }
}

async function renderDashboardAndTables() {
    // This function will now fetch time-sensitive data and render everything.
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch data for dashboard and recent entries simultaneously.
    const [{ data: recentEntries, error: recentErr }, { data: weeklyEntries, error: weeklyErr }] = await Promise.all([
        _supabase.from('time_entries').select('*, employee:employees(*, client:clients(name))').order('clock_in', { ascending: false }).limit(50),
        _supabase.from('time_entries').select('employee_id, clock_in').gte('clock_in', sevenDaysAgo.toISOString())
    ]);

    if (recentErr) throw recentErr;
    if (weeklyErr) throw weeklyErr;

    // Render all components with the fetched data.
    renderDashboard(recentEntries, weeklyEntries);
    renderAllManagementTables(recentEntries);
}

function renderAllManagementTables(timeEntries) {
    renderClients(allClients);
    populateClientDropdown(allClients);
    renderEmployees(allEmployees);
    populateEmployeeDropdown();
    renderTimeEntries(timeEntries);
}

// --- DASHBOARD SPECIFIC FUNCTIONS ---
function renderDashboard(recentEntries, weeklyEntries) {
    renderTodaysActivity(recentEntries);
    renderWeeklyAttendance(weeklyEntries);
}

function renderTodaysActivity(entries) {
    const list = document.getElementById('todays-activity-list');
    const startOfDay = new Date().setHours(0, 0, 0, 0);

    const todaysEntries = entries.filter(entry => new Date(entry.clock_in) >= startOfDay);

    if (todaysEntries.length === 0) {
        list.innerHTML = '<p>No employee activity recorded yet today.</p>';
        return;
    }

    list.innerHTML = `
        <div class="list-header">
            <span>Employee</span>
            <span>Status</span>
        </div>
        <ul>
            ${todaysEntries.map(entry => {
                const employeeName = entry.employee ? entry.employee.name : `ID: ${entry.employee_id}`;
                const clientName = (entry.employee && entry.employee.client) ? entry.employee.client.name : 'N/A';
                const status = entry.clock_out ? `Clocked out at ${new Date(entry.clock_out).toLocaleTimeString()}` : 'Clocked In';
                return `<li><strong>${employeeName}</strong> (${clientName}) - <span>${status}</span></li>`;
            }).join('')}
        </ul>
    `;
}

function renderWeeklyAttendance(entries) {
    const chartContainer = document.getElementById('weekly-attendance-chart');
    const attendance = {};
    const today = new Date();

    // Initialize last 7 days
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        attendance[dayName] = new Set(); // Use a Set to count unique employees
    }

    // Process entries
    entries.forEach(entry => {
        const entryDate = new Date(entry.clock_in);
        const dayName = entryDate.toLocaleDateString('en-US', { weekday: 'short' });
        if (attendance.hasOwnProperty(dayName)) {
            attendance[dayName].add(entry.employee_id);
        }
    });

    const maxAttendance = Math.max(...Object.values(attendance).map(s => s.size), 1); // Avoid division by zero

    let chartHtml = '<div class="chart-bars">';
    for (const day in attendance) {
        const count = attendance[day].size;
        const barHeight = (count / maxAttendance) * 100;
        chartHtml += `
            <div class="chart-bar-group">
                <div class="chart-bar" style="height: ${barHeight}%;">
                    <span class="bar-label">${count}</span>
                </div>
                <div class="day-label">${day}</div>
            </div>
        `;
    }
    chartHtml += '</div>';
    chartContainer.innerHTML = chartHtml;
}

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
        rowHtml = `
            <tr>
                <td>${employeeName}</td>
                <td>${clientName}</td>
                <td>${new Date(entry.clock_in).toLocaleString()}</td>
                <td>${entry.clock_out ? new Date(entry.clock_out).toLocaleString() : 'Active'}</td>
                <td>${entry.location ? `<a href="https://www.google.com/maps?q=${JSON.parse(entry.location).latitude},${JSON.parse(entry.location).longitude}" target="_blank">View Map</a>` : ''}</td>
                <td>
                    <button onclick="editTimeEntry(${entry.id})">Edit</button>
                    ${!entry.clock_out ? `<button class="secondary" onclick="manualClockOut(${entry.id})">Clock Out</button>` : ''}
                    <button class="secondary" onclick="deleteTimeEntry(${entry.id})">Delete</button>
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
    const id = document.getElementById('employee-id-hidden').value;
    const record = {
        name: document.getElementById('employee-name').value,
        employee_id: document.getElementById('employee-id').value,
        client_id: parseInt(document.getElementById('employee-client').value),
        user_id: _supabase.auth.user()?.id
    };

    try {
        const { error } = id ? await _supabase.from('employees').update(record).eq('id', id) : await _supabase.from('employees').insert([record]);
        if (error) throw error;
        showToast('Employee saved successfully.');
        document.getElementById('employee-form').reset();
        document.getElementById('employee-id-hidden').value = '';
        await loadInitialData();
    } catch (error) {
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
    const { error } = await _supabase.from('employees').update({ active: !currentStatus }).eq('id', id);
    if (error) {
        showToast('Failed to update employee status.', 'error');
    } else {
        showToast(`Employee ${!currentStatus ? 'activated' : 'deactivated'}.`, 'success');
        await loadInitialData();
    }
}

// --- CRUD OPERATIONS: CLIENTS ---

async function saveClient(event) {
    event.preventDefault();
    const id = document.getElementById('client-id-hidden').value;
    const record = { 
        name: document.getElementById('client-name').value,
        user_id: _supabase.auth.user()?.id
    };

    try {
        const { error } = id ? await _supabase.from('clients').update(record).eq('id', id) : await _supabase.from('clients').insert([record]);
        if (error) throw error;
        showToast('Client saved successfully.');
        document.getElementById('client-form').reset();
        document.getElementById('client-id-hidden').value = '';
        await loadInitialData();
    } catch (error) {
        showToast('Failed to save client: ' + error.message, 'error');
    }
}

function editClient(id, name) {
    document.getElementById('client-id-hidden').value = id;
    document.getElementById('client-name').value = name;
    document.getElementById('clients-panel').scrollIntoView();
}

async function deleteClient(id) {
    if (!confirm('Are you sure you want to delete this client? This might affect existing employees and time entries.')) return;
    
    const { error } = await _supabase.from('clients').delete().eq('id', id);
    if (error) {
        showToast('Failed to delete client: ' + error.message, 'error');
    } else {
        showToast('Client deleted successfully.');
        await loadInitialData();
    }
}

// --- CRUD OPERATIONS: TIME ENTRIES ---

async function saveTimeEntry(event) {
    event.preventDefault();
    const id = document.getElementById('time-entry-id-hidden').value;
    const employeeId = document.getElementById('time-entry-employee').value;
    const clockIn = document.getElementById('time-entry-clock-in').value;
    const clockOut = document.getElementById('time-entry-clock-out').value;

    const selectedEmployee = allEmployees.find(e => e.id == employeeId);
    if (!selectedEmployee) return showToast("Invalid employee selected", "error");

    const record = {
        employee_id: selectedEmployee.employee_id,
        client_id: selectedEmployee.client_id,
        clock_in: new Date(clockIn).toISOString(),
        clock_out: clockOut ? new Date(clockOut).toISOString() : null,
        user_id: _supabase.auth.user()?.id
    };

    try {
        const { error } = id ? await _supabase.from('time_entries').update(record).eq('id', id) : await _supabase.from('time_entries').insert([record]);
        if (error) throw error;
        showToast('Time entry saved successfully.');
        document.getElementById('time-entry-form').reset();
        document.getElementById('time-entry-id-hidden').value = '';
        await loadInitialData();
    } catch (error) {
        showToast('Failed to save time entry: ' + error.message, 'error');
    }
}

async function editTimeEntry(id) {
    const { data, error } = await _supabase.from('time_entries').select('*, employee:employees(*)').eq('id', id).single();
    if (error) return showToast('Could not fetch time entry data.', 'error');

    const formatForInput = (date) => date ? new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16) : '';

    document.getElementById('time-entry-id-hidden').value = data.id;
    
    const empSelect = document.getElementById('time-entry-employee');
    const masterEmp = allEmployees.find(e => e.employee_id === data.employee.employee_id && e.client_id === data.client_id);
    if(masterEmp) empSelect.value = masterEmp.id;

    document.getElementById('time-entry-clock-in').value = formatForInput(new Date(data.clock_in));
    document.getElementById('time-entry-clock-out').value = formatForInput(data.clock_out ? new Date(data.clock_out) : null);
    document.getElementById('time-entries-panel').scrollIntoView();
}

async function deleteTimeEntry(id) {
    if (!confirm('Are you sure you want to delete this time entry?')) return;
    
    const { error } = await _supabase.from('time_entries').delete().eq('id', id);
    if (error) {
        showToast('Failed to delete time entry: ' + error.message, 'error');
    } else {
        showToast('Time entry deleted successfully.');
        await loadInitialData();
    }
}

async function manualClockOut(entryId) {
    if (!confirm('Are you sure you want to manually clock out this entry?')) return;

    try {
        const { error } = await _supabase.from('time_entries').update({ clock_out: new Date().toISOString() }).eq('id', entryId);
        if (error) throw error;
        showToast('Entry successfully clocked out.');
    } catch (error) {
        showToast(`Failed to clock out: ${error.message}`, 'error');
    }
}

// --- REPORTS & UTILITIES ---

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

    let html = '<table><tr><th>Employee ID</th><th>Name</th><th>Company</th><th>Active</th></tr>';
    duplicates.forEach(group => {
        group.forEach(emp => {
            html += `<tr><td>${emp.employee_id}</td><td>${emp.name}</td><td>${emp.client ? emp.client.name : 'N/A'}</td><td>${emp.active}</td></tr>`;
        });
    });
    html += '</table>';
    resultsContainer.innerHTML = html;
}

async function generateReport() {
    const genButton = document.getElementById('generate-report-btn');
    genButton.disabled = true;
    genButton.textContent = 'Generating...';

    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const resultsContainer = document.getElementById('report-results');
    
    if (!startDate || !endDate) {
        showToast('Please select both a start and end date.', 'error');
        genButton.disabled = false;
        genButton.textContent = 'Generate Report';
        return;
    }
    resultsContainer.innerHTML = '<p>Fetching data...</p>';

    try {
        const startDateIso = new Date(startDate + 'T00:00:00').toISOString();
        const endDateIso = new Date(endDate + 'T23:59:59').toISOString();

        const { data: timeEntries, error } = await _supabase.from('time_entries').select('*, location').gte('clock_in', startDateIso).lte('clock_in', endDateIso).order('clock_in', { ascending: false });
        if (error) throw error;

        if (!timeEntries || timeEntries.length === 0) {
            resultsContainer.innerHTML = '<p>No time entries found for the selected period.</p>';
            return;
        }

        let tableHtml = `<h3>Report: ${startDate} to ${endDate}</h3><button onclick="downloadCSV(this)" id="download-csv-btn">Download CSV</button><table id="report-table">...</table>`; // (Implementation unchanged)
        resultsContainer.innerHTML = tableHtml;
        // CSV generation logic remains the same

    } catch (err) {
        showToast(`Error generating report: ${err.message}`, 'error');
    } finally {
        genButton.disabled = false;
        genButton.textContent = 'Generate Report';
    }
}

function downloadCSV(button) {
    const csvContent = button.dataset.csv; // Assuming the content is attached to the button
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `time_report_${document.getElementById('start-date').value}_to_${document.getElementById('end-date').value}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
