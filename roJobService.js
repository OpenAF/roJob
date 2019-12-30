/*
   TODO - locks on ow.server need to be host:port aware with extra. To lose the lock once the host is dead.
*/

ow.loadServer();
ow.loadFormat();
ow.loadOJob();
load("rojob.js");

// Get environment variables
var pexpr = __expr;
var params = processExpr(" ");
var args = merge(getEnvs(), params);
var lastRequest = nowUTC();
var lastCheck = nowUTC();
var stopping = false;
var running = false;

// Check variables
args.LISTEN         = _$(args.LISTEN).default("127.0.0.1");
var host            = _$(args.HOST).default((args.LISTEN != "127.0.0.1" ? ow.format.getHostName() : "127.0.0.1"));
args.PORT           = _$(args.PORT).default("8787");
args.LOG            = _$(args.LOG).default(void 0);
args.WORK           = String((new java.io.File(_$(args.WORK).default("work"))).getCanonicalPath()).replace(/\\/g, "/");
args.RUN            = String((new java.io.File(_$(args.RUN).default("run"))).getCanonicalPath()).replace(/\\/g, "/");
args.PID            = _$(args.PID).default(args.WORK + "/.rojob/roJob_" + host + "_" + args.PORT);
args.NODETIMEOUT    = Number(_$(args.NODETIMEOUT).default("30000"));
args.APIKEY         = _$(args.APIKEY).default(void 0);
args.PRIVATE        = _$(args.PRIVATE).default("false");
args.FORK           = _$(args.FORK).default("true");
args.SUB            = _$(args.SUB).default("false");
args.CNAME          = _$(args.CNAME).default("rojob");
args.INIT           = _$(args.INIT).default("true");
args.INITCHECK      = _$(args.INITCHECK).default(void 0);
args.RUNONLY        = _$(args.RUNONLY).default("false");
args.SHOWERRORS     = _$(args.SHOWERRORS).default("true");
args.QUEUECH        = _$(args.QUEUECH).default(void 0);
args.CONTAINER      = _$(args.CONTAINER).default("false");

// Ensure the work exists
io.mkdir(args.WORK);
io.mkdir(args.WORK + "/.rojob");

if (isUnDef(args.APIKEY) && isDef(getOPackPath("roJob"))) {
	if (io.fileExists(getOPackPath("roJob") + "/.apikey")) {
		args.APIKEY = io.readFileString(getOPackPath("roJob") + "/.apikey");
	}
}

if (isUnDef(args.CDISC)) {
	var f = $from(io.listFiles(args.WORK + "/.rojob").files)
	        .notContains("filename", "roJob_" + host + "_" + args.PORT)
			.match("filename", "^roJob.+\.pid$")
			.select();
	if (f.length > 0) {
		var connect = false, ii = 0;
		while(!connect && ii < f.length) {
			var r = f[ii];
			var ar = r.filename.replace(/\.pid$/, "").split(/\_/); 
			if (isDef(ar[1]) && isDef(ar[2]) && ow.format.testPort(ar[1], Number(ar[2]))) {
				connect = true;
				args.CDISC = ar[1] + ":" + ar[2]; 
			} else {
				if (!args.CONTAINER) io.rm(r.canonicalPath);
				logWarn("can't use " + ar[1] + ":" + ar[2]);
			}
			ii++;
		}
	}
	if (isUnDef(args.CDISC)) {
		args.CDISC = host + ":" + args.PORT;
	}
}

// Security warnings
if (isUnDef(args.APIKEY)) {
	if (args.PRIVATE == "true") {
		logWarn("==> PRIVATE MODE! NO API KEY DEFINED! <==");
	} else {
		args.APIKEY = sha512(genUUID());
		logWarn("Generated an API key = '" + args.APIKEY + "'");
	}
}
if (args.PRIVATE == "true") {
	logWarn("Private mode on. No API key check is performed.");
}

// Queue check
var queue;
if (isDef(args.QUEUECH)) { 
	var chArgs = {};
	var chName = "roJob_" + args.CNAME;
	log("Connecting to queue " + chName + "...");
	splitBySeparator(args.QUEUECH, ",").forEach(v => {
		var m = splitBySeparator(v, ":");
		chArgs[m[0]] = m[1];
	});
	if (isDef(chArgs.opack)) {
		log("Checking opack " + chArgs.opack + "...");
		includeOPack(chArgs.opack, chArgs.opackMinVer);
	}
	if (isDef(chArgs.load)) {
		log("Loading " + chArgs.load + "...");
		load(chArgs.load);
	}
	$ch(chName).create(1, chArgs.type, chArgs);
	queue = new ow.server.queue({ type: "queue", cname: chName }, void 0, chName);
	args.FORK = "false";
}

// Global variables
global.ROJOB = {
	HOST: host,
	PORT: args.PORT,
	WORK_DIR: args.WORK,
	RUN_DIR: args.RUN,
	CNAME: args.CNAME
};

// Check & Create pid per served port
ow.server.simpleCheckIn(args.PID);

// Turn off stdout logging if a folder is defined
if (isDef(args.LOG)) {
	ow.loadCh();
	setLog({ off: true });
	ow.ch.utils.setLogToFile({
		logFolder       : args.LOG,
		filenameTemplate: "log-" + args.PORT + "-{{timedate}}.log",
		setLogOff       : false
	});
	log(stringify(global.ROJOB));
}

// Starting server
var hs = ow.server.httpd.start(Number(args.PORT), args.LISTEN);
var ls = new ow.server.locks(true);

var cluster = new ow.server.cluster(host, Number(args.PORT), args.NODETIMEOUT, void 0, void 0, {
	name: args.CNAME,
	serverOrPort: hs/*,
	chs: [ "__cluster::" + args.CNAME + "::locks" ]*/
}, ow.server.clusterChsPeersImpl);
global.ROJOB.cluster = cluster;
global.ROJOB.client = new roJob("http://" + global.ROJOB.HOST + ":" + global.ROJOB.PORT, args.APIKEY);

// Functions
// ---------

// API Authorization Sign
function signAuthorization(aURI, data) {
	if (isDef(args.APIKEY)) {
		if (isString(data)) data = data.replace(/[\n \t\r]+$/, "");

		var dateStamp = Math.floor(nowUTC()/(1000*60*2));
		var kDateStamp = hmacSHA256(dateStamp, "roJob" + args.APIKEY);
		var kURI = hmacSHA256(aURI, kDateStamp);
		var kData = hmacSHA256(sha256((isMap(data) ? stringify(data, void 0, "") : data)), kURI);
		//print(dateStamp);
		//print("roJob" + args.APIKEY);
		//print(ow.format.string.toHex(kDateStamp, "").toLowerCase());
		//print(aURI);
		//print(data);
		//print(sha256(data));
		var res = ow.format.string.toHex(kData, "").toLowerCase();
		//print(res);
		return res;
	} else {
		return void 0;
	}
}

// API Request Sign
function signRequest(r, data) {
	return this.signAuthorization(r.originalURI, data);
}

function validatePath(aPath, aTest) {
	var target = String((new java.io.File(aTest)).getCanonicalPath()).replace(/\\/g, "/");
	if (target.indexOf(aPath) == 0) {
		return true;
	} else {
		return false;
	}
}

function fnReply(idxs, data, req, origData, noCheck) {
	var sendOthers = (aData, aMap) => {
		var verb = "/ojob";

		var res = $rest({ 
			throwExceptions: true, 
			requestHeaders: {
				auth: this.signAuthorization(verb, aData)
			}
		}).post("http://" + aMap.host + ":" + aMap.port + verb, jsonParse(aData));
		logWarn("Got a reply from redirected request to " + stringify(aMap, void 0, ""));
		return res;
	};

	try {
		// STEP 1 - Check incoming request
		if (args.PRIVATE != "true" && !noCheck) {
			var auth = signRequest(req, jsonParse(origData));
			if (req.header.auth != auth) {
				logErr("Wrong auth received: " + req.header.auth + " expected " + auth);
				return { result: 0 };
			}
		}

		data.rojob = _$(data.rojob).default({});

		data.args = jsonParse(_$(data.args).default("{}"));
		data.args = merge(data.args, idxs);

		data.ojob = _$(data.ojob).default({});
		if (isDef(data.rojob.name)) data.rojob.name = data.rojob.name.replace(/-/g, "_");

		var async = false, uuid = host + "-" + args.PORT + "-" + (isDef(data.rojob.name) ? data.rojob.name + "_" : "") + nowNano();
		global.ROJOB.UUID = uuid;

		// If logging to a folder then adapt ojob to reflect it
		if (isDef(args.LOG)) {
			setLog({
				dateFormat: "yyyy-MM-dd HH:mm:ss.SSS | '" + uuid + "'"
			});

			data.ojob.logToConsole = false;
		}

		if ((isDef(data.rojob) && isDef(data.rojob.async) && (data.rojob.async)) || (isDef(data.args) && isMap(data.args) && data.args.__async == 1)) async = true;

		// STEP 2 - Execute request
		// Deal with an async request
		var res = void 0;
			__pm = {};
			
		var lockRes = false, pro;
		if (!running) {
			lockRes = ls.whenUnLocked("single", () => {
				running = true;

				pro = $do(() => {
					var shouldRun = true;
					if (isDef(data.rojob.unique) && data.rojob.unique) {
						var others = $from(io.listFiles(args.WORK + "/.rojob").files)
									 .ends("filename", "-" + data.rojob.name + ".unique")
									 .select((r) => { return r.filename; });
						if (others.length <= 0) {
							var uuidUnique = host + "-" + args.PORT + "-" + data.rojob.name + ".unique";
							io.writeFileString(args.WORK + "/.rojob/" + uuidUnique, {
								uuid   : uuidUnique,
								created: new Date()
							});
						} else {
							log("Unique job already running (" + others.join(",") + ")");
							shouldRun = false;
						}
					}
					if (shouldRun) {
						io.writeFile(args.WORK + "/.rojob/" + uuid + ".rojob", { 
							uuid   : uuid,
							created: new Date()
						});
						log("Job " + uuid + " started.");
		
						$tb(() => {
							__pm = merge(__pm, data.args);
							oJobRun(data, data.args, uuid);
							return 1;
						})
						.stopWhen(() => {
							var resFile = !(io.fileExists(args.WORK + "/.rojob/" + uuid + ".rojob"));
							if (resFile) {
								log("Stopping job " + uuid + ".rojob");
								ow.oJob.stop();
								if (!stopping) {
									if (args.CONTAINER == "false") 
										restartOpenAF();
									else
										exit(0);
								}
							}
							return resFile;
						})
						.exec();
					}
	
					return shouldRun;
				})
				.then((shouldRun) => {
					running = false;
	
					io.rm(args.WORK + "/.rojob/" + uuid + ".rojob");
					if (isDef(data.rojob.unique) && data.rojob.unique) {
						var uuidUnique = host + "-" + args.PORT + "-" + data.rojob.name + ".unique";
						io.rm(args.WORK + "/.rojob/" + uuidUnique);
					}
					if (shouldRun) {
						log("Job " + uuid + " ended.");
	
						if (async) {
							res = clone(__pm);
							io.writeFile(args.WORK + "/.rojob/" + uuid + ".result", res);
							if (!stopping) {
								sleep(50, true);
								if (args.CONTAINER == "false")
									restartOpenAF(); 
								else
									exit(0);
							}
						} else {
							if (isDef(ow.oJob.runAllShutdownJobs)) ow.oJob.runAllShutdownJobs();
						}
					}
					ow.oJob.stop();
				})
				.catch((e) => {
					running = false;
					logErr("Error in job " + uuid + ": " + stringify(e));
					ow.oJob.stop();
				});
				if (async) {
					res = { uuid: uuid };
				} else {
					$doWait(pro);
					res = clone(__pm);
					if (args.SHOWERRORS == "true") {
						var errs = $from($ch("oJob::log").getAll()).equals("error", true).select((r) => { return { name: r.name, error: $path(r.log, "[].error") } });
						if (errs.length > 0) {
							res.__errors = errs;
						}
					}
				}
			}, 50, 1);
		}

		// STEP 3 - Cleanup everything or fallback/queue

		var cleanup = () => {
			$ch("oJob::log").unsetAll(["ojobId", "name"], $from($ch("oJob::log").getAll()).starts("ojobId", ow.oJob.getID()).select());
			$ch("oJob::jobs").unsetAll(["name"], $ch("oJob::jobs").getAll());
			$ch("oJob::todo").unsetAll(["ojobId", "todoId"], $from($ch("oJob::jobs").getAll()).starts("ojobId", ow.oJob.getID()).select());
		};

		if (!lockRes && isUnDef(data.rojob.__redirected)) {
			var torigData = (isObject(data) ? clone(data) : data);
			if (isUnDef(torigData.rojob) && !isString(torigData)) torigData.rojob = {};
			if (isMap(torigData)) torigData.rojob.__redirected = true;

			var stores;
			if (isUnDef(args.QUEUECH) && !async) stores = cluster.sendToOthers(torigData, sendOthers);
			
			if (isUnDef(stores)) {
				if (isDef(args.FALLBACKS)) {
					var fs = args.FALLBACKS.split(/,/);
					var ii = 0;
					while(ii < fs.length && isUnDef(stores)) {
						var friend = fs[ii].split(/:/);
						try {
							stores = sendOthers(torigData, {
								host: friend[0],
								port: friend[1]
							});
						} catch(e) { 
							logErr("Couldn't use " + friend[0] + ":" + friend[1]);
						}
						ii++;
					}
				}

				if (args.FORK == "true") {
					var pport = findRandomOpenPort();
					pexpr = pexpr.replace(/PORT=[^ ]+/, "");
					pexpr = pexpr.replace(/FORK=[^ ]+/, "");
					pexpr = pexpr.replace(/LISTEN=[^ ]+/, "");
					pexpr += "SUB=true PRIVATE=true LISTEN=127.0.0.1 PORT=" + pport;

					//pexpr = "\""  + pexpr + "\"";
					log("Launching a sub-service on port " + pport + "...");
					forkOpenAF(["-f", "roJobService.js", "-i", "script", "-e", pexpr]);

					// wait for it
					var pinit = nowUTC(), isready = false;
					while(!isready && nowUTC() - pinit < 7500) {
						isready = ow.format.testPort(args.LISTEN, pport, 500);
						sleep(500);
					}

					// send request
					if (isready) {
						log("Resending request to " + pport);
						stores = sendOthers(torigData, {
							host: args.LISTEN,
							port: pport
						});
					} else {
						logWarn("Couldn't resend the request to " + pport);
						stores = { result: 0 };
					}
				} else {
					if (isDef(args.QUEUECH) && async) {
						log("Queueing job... " + queue.send({
							idxs    : idxs, 
							data    : data, 
							req     : req, 
							origData: origData
						}));
						stores = {
							result: 1,
							queue : true
						};
					} else {
						log("Rejecting job...");
						stores = { result: 0 };
					}
				}
			}
			$do(cleanup);
			return stores;
		} else {
			if (!async && lockRes) {
				$do(cleanup);
			}
			return res;
		}
	} catch(ee) {
		return { error: String(ee) };
	}
};

// Defining routes
ow.server.httpd.route(hs, {
	"/run" : function(r) {
		try {
			lastRequest = nowUTC();
			var source, origData;
			if (isDef(r.params["NanoHttpd.QUERY_STRING"]) && r.params["NanoHttpd.QUERY_STRING"] == null) {
				r.files.postData = String(r.files.postData).replace(/^\"(.+)\"$/, "$1");
				origData = r.files.postData;
				if (validatePath(args.RUN, args.RUN + "/" + r.files.postData))
					source = io.readFileYAML(args.RUN + "/" + r.files.postData); 
				else
					return hs.replyOKJSON(stringify({}, void 0, ""));
			} else {
				r.files.postData = String(r.files.postData).replace(/^\"(.+)\"$/, "$1");
				origData = r.files.postData;
				if (validatePath(args.RUN, args.RUN + "/" + r.files.postData))
					source = io.readFileYAML(args.RUN + "/" + r.files.postData); 
				else
					return hs.replyOKJSON(stringify({}, void 0, ""));
			}
			delete r.params["NanoHttpd.QUERY_STRING"];
			var res = fnReply(r.params, source, r, origData);
			return hs.replyOKJSON(stringify(res, void 0, ""));
		} catch(ee) {
			return hs.replyOKJSON(stringify({ error: String(ee) }, void 0, ""));
		}
	},
	"/ojob": function(r) {
		try {
			lastRequest = nowUTC();
			if (args.RUNONLY == "true") return hs.reply(stringify({}, void 0, ""), ow.server.httpd.getMimeType(".json"), 403, {});

			var source, origData;
			if (isDef(r.params["NanoHttpd.QUERY_STRING"]) && r.params["NanoHttpd.QUERY_STRING"] == null) {
				source = jsonParse(r.files.postData);
				origData = r.files.postData;
				if (isUnDef(source) || source == {} || source == r.files.postData) { 
					source = af.fromYAML(r.files.postData); 
				}
			} else {
				source = jsonParse(r.files.postData);
				origData = r.files.postData;
				if (isUnDef(source) || source == {} || source == r.files.postData) { 
					source = af.fromYAML(r.files.postData); 
				}
			}
			delete r.params["NanoHttpd.QUERY_STRING"];
			var res = fnReply(r.params, source, r, origData);
			return hs.replyOKJSON(stringify(res, void 0, ""));
		} catch(ee) {
			return hs.replyOKJSON(stringify({ error: String(ee) }, void 0, ""));
		}
	},
    "/yaml": function(r) {
		try {
			lastRequest = nowUTC();
			if (args.RUNONLY == "true") return hs.reply(stringify({}, void 0, ""), ow.server.httpd.getMimeType(".json"), 403, {});

			var source;
			if (isDef(r.params["NanoHttpd.QUERY_STRING"]) && r.params["NanoHttpd.QUERY_STRING"] == null) {
				source = af.fromYAML(r.files.postData);
			} else {
				source = af.fromYAML(r.params["NanoHttpd.QUERY_STRING"]);
			}
			delete r.params["NanoHttpd.QUERY_STRING"];
			var res = fnReply(r.params, source, r, origData);
			return hs.replyOKJSON(stringify(res, void 0, ""));
		} catch(ee) {
			return hs.replyOKJSON(stringify({ error: String(ee) }, void 0, ""));
		}
	},
    "/json": function(r) {
		lastRequest = nowUTC();
		if (args.RUNONLY == "true") return hs.reply(stringify({}, void 0, ""), ow.server.httpd.getMimeType(".json"), 403, {});
		
     	return ow.server.rest.reply("/json", r, 
			fnReply,
			(idxs, req)       => { return { result: 0 } },
			(idxs, data, req) => { return { result: 0 } },
			(idxs, req)       => { return { result: 0 } }
      	);
    }
}, function(r) { return hs.replyOKJSON(stringify({ result: 0 }, void 0, "")); });


cluster.checkIn();
cluster.verify({ host: args.CDISC.split(/:/)[0], port: Number(args.CDISC.split(/:/)[1]) }); 
cluster.verify();

addOnOpenAFShutdown(() => {
	log("Master checkout...");
	cluster.checkOut();
	ow.oJob.stop();

	// Clean old files
	log("Cleaning files (" + host + "-" + args.PORT + ")...");
	$from(io.listFiles(args.WORK + "/.rojob").files)
	.starts("filename", host + "-" + args.PORT)
	.notEnds("filename", ".result")
	.select((v) => {
		log("Cleaning " + v.canonicalPath + "...");
		io.rm(v.canonicalPath);
	});
	log("Done");
});

// Server ready
log("READY on " + args.PORT);
print("READY on " + args.PORT);

// Start any initialization jobs
function checkInit() {
	if (args.SUB == "false" && args.INIT == "true") {
		$from(io.listFiles(args.WORK + "/.rojob").files)
		.ends("filename", ".yaml")
		.orEnds("filename", ".json")
		.sort("filename")
		.select((r) => {
			try {
				global.ROJOB.cluster.whenUnLocked(r.canonicalPath, () => {
					log("Starting initialization job " + r.filename + "...");
					global.ROJOB.client.exec(r.canonicalPath);
					log("Ended initialization job " + r.filename + ".");
				}, 1000, 3);
			} catch(e) {
				sprintErr(e);
			}
		});
		lastCheck = nowUTC();
	}
}
checkInit();

const daemonWait = 5000;
ow.server.daemon(daemonWait, () => { 
	// Cluster verification
	cluster.verify(); 

	// PID verification
	if (!(io.fileExists(args.PID + ".pid"))) {
		stopping = true;
		return true;
	}

	// Fork verification
	if (args.SUB == "true" && (nowUTC() - lastRequest) > (1 * 60 * 1000)) {
		stopping = true;
		return true;
	}

	// Stall verification
	if (isDef(args.INITCHECK) && (nowUTC() - lastCheck) > (args.INITCHECK * 1000)) {
		checkInit();
	}

	// Queue processing
	if (isDef(queue) && !running) {
		var res = queue.receive(void 0, daemonWait - 500, 1000);
		if (isDef(res)) {
			log("Handling queued entry " + res.idx);
			fnReply(res.obj.idxs, res.obj.data, res.obj.req, res.obj.origData, true);
		}
	}

	return false; 
});
