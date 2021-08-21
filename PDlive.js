var priorities
var incidents
var token
var poller
var last_polled
var recent_log_entries = []
var recent_log_entries_purge_timer
var table

function getParameterByName(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function secondsToHHMMSS(seconds) {
	var hours = Math.floor(seconds / 60 / 60);
	var minutes = Math.floor((seconds % 3600) / 60);
	var seconds = seconds % 60;

	var HH = ('0' + hours).slice(-2);
	var MM = ('0' + minutes).slice(-2);
	var SS = ('0' + seconds).slice(-2);

	return `${HH}:${MM}:${SS}`;
}

async function pdfetch(endpoint, params) {
    myParams = {...params}
    const endpoint_identifier = endpoint.split('/').pop()
    let r = []
    responses = await PagerDuty.all({token: token, tokenType: 'bearer', endpoint: `/${endpoint}`, data: myParams})
    for (response of responses) {
        r = [...r, ...response.data[endpoint_identifier]]
    }
    return r
}

function pollLogEntries() {
    params = {
        since: last_polled.toISOString().replace(/\.[\d]{3}/, ''),
        'include[]': ['incidents'],
    }
    pdfetch('log_entries', params).then(log_entries => {
        let add_set = new Set()
        let remove_set = new Set()
        let update_set = new Set()
        for (log_entry of log_entries) {
            if ( recent_log_entries.filter(x => x.id == log_entry.id).length > 0 ) {
                // console.log(`duplicate log entry ${log_entry.id}`)
                continue
            }
            log_entry_date = new Date(log_entry.created_at)
            recent_log_entries.push({
                date: log_entry_date,
                id: log_entry.id
            })
            if (log_entry_date > last_polled) {
                last_polled = log_entry_date
            }
            incident_id = log_entry.incident.id
            entry_type = log_entry.type

            if ( entry_type === 'resolve_log_entry') {
                remove_set.add(log_entry)
            } else if (entry_type === 'trigger_log_entry') {
                add_set.add(log_entry)
            } else {
                update_set.add(log_entry)
            }


        }
        const add_list = [...add_set].filter(x => !remove_set.has(x))
        const update_list = [...update_set].filter(x => !remove_set.has(x) && !add_set.has(x))
        const remove_list = [...remove_set]

        const pd = PagerDuty.api({token: token, tokenType: 'bearer'})
        for (add_item of add_list) {
            console.log('add:', add_item)
            const incident = add_item.incident
            table.row.add({
                incident_id: incident.id,
                number: `<a href="${incident.html_url}" target="blank">${incident.incident_number}</a>`,
                title: incident.title,
                status: incident.status,
                priority: incident.priority ? incident.priority.summary : '~none~',
                notes: 0,
                created_at: moment(incident.created_at).format('l LTS [GMT]ZZ'),
                service_name: `<a href="${incident.service.html_url}" target="blank">${incident.service.summary}</a>`,
                last_log: '',
            })
            .draw()
            flashIncidentRow(incident.id)
        }

        for (update_item of update_list) {
            console.log('update:', update_item)
            const incident = update_item.incident
            const row = table.row(`#${incident.id}`).data()
            if (!row) {
                console.log(`row not found for incident id ${incident.id}`)
                continue
            }
            row.last_log = `${(new Date(update_item.created_at)).toLocaleString()}: ${update_item.summary}`
            if (update_item.type === 'annotate_log_entry') {
                row.notes += 1
            } else if (update_item.type === 'priority_change_log_entry') {
                row.priority = incident.priority ? incident.priority.summary : '~none~'
            } else if (update_item.type === 'acknowledge_log_entry') {
                row.status = 'acknowledged'
            } else if (update_item.type === 'unacknowledge_log_entry') {
                row.status = 'triggered'
            }
            table.row(`#${incident.id}`).data(row).draw()
            flashIncidentRow(incident.id)
        }

        for (remove_item of remove_list) {
            console.log('remove:', remove_item)
            const incident = remove_item.incident
            const row = table.row(`#${incident.id}`).data()
            if (!row) {
                console.log(`row not found for incident id ${incident.id}`)
                continue
            }
            table.row(`#${incident.id}`).remove().draw()
        }
    })
}

function cleanRecentLogEntries() {
    const d = new Date()
    const before = recent_log_entries.length
    recent_log_entries = recent_log_entries.sort((a, b) => b.date - a.date).slice(0, 100)
    console.log(`Purged ${before - recent_log_entries.length} recent log entries (${before} -> ${recent_log_entries.length})`)
}

async function fetchIncidents(since, until) {
	var params = {
		since: since.toISOString(),
		until: until.toISOString(),
        'include[]': 'first_trigger_log_entries',
        'statuses[]': ['triggered', 'acknowledged']
	}
	return await pdfetch('incidents', params);
}

async function buildReport(since, until, reuseFetchedData) {
    if (!reuseFetchedData) {
        $('.busy').show()
        last_polled = new Date()
        const pd = PagerDuty.api({token: token, tokenType: 'bearer'})
        let r = await pd.get('/priorities')
        priorities = r.data.priorities
        $('#priority-checkboxes-div').html('Show priorities: <div class="btn-group" id="priority-checkboxes-group"></div>')
        for (priority of priorities) {
            $('#priority-checkboxes-group').append($('<button/>', { class: "priority-button btn btn-primary active", value: priority.name, text: priority.name }))
        }
        $('#priority-checkboxes-group').append($('<button/>', { class: "priority-button btn btn-primary active", value: "~none~", text: "none" }))
        $('.priority-button').click(function() {
            $(this).toggleClass('btn-primary');
            $(this).toggleClass('active');
            buildReport(since, until, true);
        });
        incidents = await fetchIncidents(since, until)
        for (incident of incidents) {
            r = await pd.get(`/incidents/${incident.id}/notes`)
            incident.notes = r.data.notes
        }
        clearInterval(poller)
        poller = setInterval(pollLogEntries, 5000)
        clearInterval(recent_log_entries_purge_timer)
        recent_log_entries_purge_timer = setInterval(cleanRecentLogEntries, 600_000)
        $('.busy').hide()
    }

    const sinceStr = moment(since).format("LLLL")
    const untilStr = moment(until).format("LLLL")

    const headline = `Incidents occurring since ${sinceStr}`
    $('#details').html('<h3>' + headline + '</h3>')

    $('#details').append($('<table/>', {
        id: "details-table",
        class: "display"
    }))

    const selected_priorities = $(':button.active').map(function() { return this.value; }).get()
    let tableData = []
    for (incident of incidents) {
        if ( ! incident.priority ) {
            incident.priority = { name: '~none~' }
        }
        if ( selected_priorities.indexOf(incident.priority.name) > -1 ) {
            tableData.push({
                incident_id: incident.id,
                number: `<a href="${incident.html_url}" target="blank">${incident.incident_number}</a>`,
                title: incident.title,
                status: incident.status,
                priority: incident.priority.name,
                notes: incident.notes.length,
                created_at: moment(incident.created_at).format('l LTS [GMT]ZZ'),
                service_name: `<a href="${incident.service.html_url}" target="blank">${incident.service.summary}</a>`,
                last_log: '',
            })
        }
    }
    const columnTitles = [
            { title: "#", data: 'number' },
            { title: "Title", data: 'title' },
            { title: "Status", data: 'status' },
            { title: "Priority", data: 'priority' },
            { title: "Notes", data: 'notes' },
            { title: "Created at", data: 'created_at'},
            { title: "Service Name", data: 'service_name' },
            { title: "last log entry", data: 'last_log'},
        ]
    table = $('#details-table').DataTable({
        data: tableData,
        columns: columnTitles,
        rowId: 'incident_id',
        dom: 'Bfrtip',
        buttons: [
            'copy', 'csv', 'pdf', 'print'
        ],
        order: [[2, 'asc']],
        pageLength: 50,
        rowCallback: (row, data, index) => {
            if (data.status == "triggered") {
                $("td:eq(2)", row).removeClass("status-acknowledged");
                $("td:eq(2)", row).addClass("status-triggered");
            } else if (data.status == "acknowledged") {
                $("td:eq(2)", row).removeClass("status-triggered");
                $("td:eq(2)", row).addClass("status-acknowledged");
            } else {
                $("td:eq(2)", row).removeClass("status-triggered");
                $("td:eq(2)", row).removeClass("status-acknowledged");
            }

            const priority = priorities.find(x => x.summary == data.priority)
            if (priority && priority.color) {
                $("td:eq(3)", row).css('background-color', `#${priority.color} !important`)
            } else if (data.priority == '~none~') {
                $("td:eq(3)", row).css('background-color', `transparent`)
            }
        }
    })
}

function flashIncidentRow(incident_id) {
    $(`#${incident_id}`).addClass('flash')
    setTimeout(() => {
        $(`#${incident_id}`).removeClass('flash')
    }, 300)
}

function main() {
    const clientID = '8595554f0beba16a71cde23a6fd8c40bdc6e5ee38d706babe5e52f69999d7572'

    /////////////////////////////
    //
    // you can set the redirect URL, or let PDOAuth assume that it's the current page:
    //
    // const redirectURL = 'https://martindstone.github.io/PDOAuth'

    /////////////////////////////
    //
    // PDOAuth.login will overwrite the DOM with a simple login button, with the
    // provided client ID and redirect URL. It will store a PKCE code verifier in
    // session storage, and on success it will store the PD access token in
    // session storage.
    //
    PDOAuth.login(clientID)
    token = sessionStorage.getItem('pd_access_token')

	$('#since').datepicker();
	$('#until').datepicker();

	if (getParameterByName('hideControls') == 'true') {
		$('#controls').hide();
	}

	var until = new Date();
	var since = new Date();
	since.setDate(since.getDate() - 7);

	since.setHours(0,0,0,0);
	until.setHours(23,59,59,999);

	$('#since').datepicker("setDate", since);
	$('#until').datepicker("setDate", until);

	buildReport(since, until)

	$('#since').change(function() {
		since = $('#since').datepicker("getDate");
		since.setHours(0,0,0,0);

		buildReport(since, until);
	});

	$('#until').change(function() {
		until = $('#until').datepicker("getDate");
		until.setHours(23,59,59,999);

		buildReport(since, until);
    });

    /////////////////////////////
    //
    // You can make a logout button (just clears the token from session storage):
    //
    $('#pd-logout-button').attr('href', '#')
    $('#pd-logout-button').click(() => {
        PDOAuth.logout() 
    })
}

$(document).ready(main);