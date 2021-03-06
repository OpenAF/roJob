/**
 * <odoc>
 * <key>roJob.roJob(aURL, aAPIKey)</key>
 * Creates a roJob instance for aURL with aAPIKey. If '[oPack roJob]/.apikey' exists it will be used by default if no aAPIKey is 
 * provided. If aURL is not provided it will default to http://127.0.0.1:8787.
 * </odoc>
 */
var roJob = function(aURL, aAPIKey, aRetry, aRetryTime) {
	this.retry = _$(aRetry).isNumber().default(40);
	this.retryTime = _$(aRetryTime).isNumber().default(1500);

	if (isArray(aURL)) {
		this.urls = aURL;
	} else {
		if (isString(aURL)) {
			this.urls = [ aURL ];
		} else {
			var nodes;
			if (io.fileExists(getOPackPath("roJob") + "/work/.rojob")) {
				var nodes = $from(io.listFilenames(getOPackPath("roJob") + "/work/.rojob"))
							.ends(".pid")
							.starts(getOPackPath("roJob") + "/work/.rojob/roJob_")
							.select((r) => { var a = r.split("_"); return "http://" + a[1] + ":" + a[2].replace(".pid", ""); });
				if (nodes.length > 0) {
					this.urls = nodes;
				}
			}
			if (isUnDef(this.urls)) {
				this.urls = [ "http://127.0.0.1:8787" ];
			}
		}
	}
   
    this.APIKEY = aAPIKey;
    if (isUnDef(this.APIKEY) && isDef(getOPackPath("roJob"))) {
	   	if (io.fileExists(getOPackPath("roJob") + "/.apikey")) {
			this.APIKEY = io.readFileString(getOPackPath("roJob") + "/.apikey").replace(/\n/g, "");
	   	}
   }
};

roJob.prototype.setRetry = function(aNum) {
	this.retry = _$(aNum, "retry").isNumber().default(40);
};

roJob.prototype.setRetryTime = function(aNum) {
	this.retryTime = _$(aNum, "retryTime").isNumber().default(1500);
};

roJob.prototype.getURL = function() {
	return this.urls[Math.floor(Math.random()*this.urls.length)];
};

roJob.prototype.signRequestFn = function(uri, apiKey) {
	this.APIKEY = apiKey;

	ow.loadFormat();
	return (r) => {
		var signAuthorization = function(aURI, data) {
			if (isDef(apiKey)) {
				if (isString(data)) data = data.replace(/[\n \t\r]+$/, "");
				//var kaURI = encodeURIComponent(aURI);
		
				var dateStamp = Math.floor(nowUTC()/(1000*60*2));
				var kDateStamp = hmacSHA256(dateStamp, "roJob" + apiKey);
				var kURI = hmacSHA256(aURI, kDateStamp);
				var kData = hmacSHA256(sha256((isMap(data) ? stringify(data, void 0, "") : data)), kURI);
				//print(dateStamp);
				//print("roJob" + apiKey);
				//print(aURI);
				//print(stringify(data, void 0, ""));
				//print(sha256(stringify(data, void 0, "")));
				return ow.format.string.toHex(kData, "").toLowerCase();
			} else {
				return void 0;
			}
		};

		r.reqHeaders = _$(r.reqHeaders).isMap().default({});
		r.reqHeaders.auth = signAuthorization(uri + $rest().index(r.aIdxMap), r.aDataRowMap);
	
		return r;
	};
};

roJob.prototype.__req = function(aURI, aURL, aData) {
	var res, c = this.retry;

	do {
		res = $rest({ preAction: this.signRequestFn(aURI, this.APIKEY) })
			  .post(aURL, aData);
		if (isDef(res.error)) {
			c--;
			sleep(this.retryTime, true);
		}
	} while(isDef(res.error) && c >= 0);

	return res;
}

roJob.prototype.execJob = function(aoJob, aObj) {
	var aURI = "/ojob?" + $rest().query(aObj);
    return this.__req(aURI, this.getURL() + aURI, aoJob);
};

roJob.prototype.exec = function(aFile, aObj) {
	var aURI = "/ojob?" + $rest().query(aObj);
    return this.__req(aURI, this.getURL() + aURI, (aFile.endsWith(".yaml") ? io.readFileYAML(aFile) : io.readFile(aFile)));
};

roJob.prototype.execAsync = function(aFile, aObj) {
	aObj = merge(aObj, { __async: 1 });
	var aURI = "/ojob?" + $rest().query(aObj);
    return this.__req(aURI, this.getURL() + aURI, (aFile.endsWith(".yaml") ? io.readFileYAML(aFile) : io.readFile(aFile)));
};

roJob.prototype.run = function(aFile, aObj) {
	var aURI = "/run?" + $rest().query(aObj);
	return this.__req(aURI, this.getURL() + aURI, aFile);
};

roJob.prototype.runAsync = function(aFile, aObj) {
	aObj = merge(aObj, { __async: 1 });
	var aURI = "/run?" + $rest().query(aObj);
    return this.__req(aURI, this.getURL() + aURI, aFile);
};

/**
 * <odoc>
 * <key>roJob.listNodes() : Map</key>
 * Returns a list of the existing nodes.
 * </odoc>
 */
roJob.prototype.listNodes = function() {
   return this.run("rojob/listnodes.yaml");
};

/**
 * <odoc>
 * <key>roJob.listWork(aPath) : Map</key>
 * Returns a list of the files on the remote work folder on aPath.
 * </odoc>
 */
roJob.prototype.listWork = function(aPath) {
   return this.run("rojob/listwork.yaml", { path: aPath });
};

/**
 * <odoc>
 * <key>roJob.getMemory(notFormat) : Map</key>
 * Returns a map with the java heap memory stats. Optionally if notFormat = true values will be returned in bytes instead of human readable.
 * </odoc>
 */
roJob.prototype.getMemory = function(notFormat) {
	return this.run("rojob/getmem.yaml", { format: !notFormat });
};

/**
 * <odoc>
 * <key>roJob.cleanWork(aPath) : Map</key>
 * Cleans all files on the remote work folder under aPath.
 * </odoc>
 */
roJob.prototype.cleanWork = function(aPath) {
   return this.run("rojob/cleanwork.yaml", { path: aPath });
};

/**
 * <odoc>
 * <key>roJob.killJob(aJob) : Map</key>
 * Tries to stop a remote aJob.
 * </odoc>
 */
roJob.prototype.killJob = function(aJob) {
   return this.run("rojob/killjob.yaml", { job: aJob });
};

/**
 * <odoc>
 * <key>roJob.getResult(aUUID, shouldClean) : Map</key>
 * Returns the result of a async job, identified by aUUID. Optionally the result can be cleaned
 * from the remote work folder.
 * </odoc>
 */
roJob.prototype.getResult = function(aUUID, shouldClean) {
   var res = this.run("rojob/getresult.yaml", { uuid: aUUID });
   if (shouldClean && isUnDef(res.__error)) this.run("rojob/cleanresult.yaml", { uuid: aUUID });
   return res;
};

roJob.prototype.setInitJob = function(aName, aFile) {
   return this.run("rojob/setinitjob.yaml", { name: aName, job: io.readFileString(aFile) });
};

roJob.prototype.clearInitJobs = function() {
	return this.run("rojob/clearinitjobs.yaml");
};

roJob.prototype.addNode = function(aHost, aPort) {
	return this.run("rojob/addnode.yaml", { host: aHost, port: aPort });
};

roJob.prototype.showVars = function() {
   return this.run("rojob/showvars.yaml");
};

roJob.prototype.stop = function() {
   this.run("rojob/stop.yaml");
};

roJob.prototype.stopAll = function() {
   this.run("rojob/stopall.yaml");
};
