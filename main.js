var params = processExpr(" ");

var cmd = false;
if (isDef(params.setup)) {
    cmd = true;
    oJobRunFile(getOPackPath("roJob") + "/genScripts.yaml", {
        APIKEY: params.APIKEY,
        CDISC : params.CDISC
    });
} 

if (isDef(params.stop)) {
    log("Stopping roJob...");
    loadLib("rojob.js");
    (new roJob()).stopAll();
}

if (isDef(params.start)) {
    log("Starting roJob...");
    oJobRunFile(getOPackPath("roJob") + "/watchdog.yaml");
}

if (isDef(params.restart)) {
    log("Stopping roJob...");
    loadLib("rojob.js");
    (new roJob()).stopAll();

    sleep(1500);

    log("Starting roJob...");
    oJobRunFile(getOPackPath("roJob") + "/watchdog.yaml");
}

if (!cmd) {
    loadLib("rojob.js");

    var file, c = -3, args = {};
    for(var ii in params) {
        if (ii.endsWith(".yaml") || ii.endsWith(".json")) {
            file = ii;
        }
        if (c >= 0) {
            args[ii] = params[ii];
        }
        c++;
    }
    if (isDef(file)) {
        sprint((new roJob()).exec(file, args));
    }
}