# roJob

roJob allows to run OpenAF's ojobs as a service. It's designed to be run as a single process or as a full service on docker containers. The advantages over running the ojob directly are:

  * Can be triggered from a simple python script
  * Pre-warmed containers making it faster to execute
  * Run ojobs as service functions returning maps
  * Clean environment for each execution

## Starting the roJob service

You can use the service directly or as a docker container. See examples below for docker-compose, docker swarm and kubernetes.

In all cases there are common arguments or environment variables to configure:

| Argument | Default | Description |
|----------|---------|-------------|
| LISTEN | 127.0.0.1 | The network listener interface (e.g. 0.0.0.0 for all interfaces) for the endpoint. |
| HOST | localhost | The endpoint host address. |
| PORT | 8787 | The endpoint port. |
| LOG | | The log folder where logs should be stored. |
| WORK | work | Where will pid, job and other custom files be written. |
| NODETIMEOUT | 30000 | How much time in ms before considering another node as dead. |
| APIKEY | | The API key to use to authenticate client use. |
| PRIVATE | false | Ignores the API key when setup in a secure network (not recommended). |
| FORK | true | If the current node is busy and a request can be forwarded to another node, should the process fork to try to answer the request. |
| CNAME | rojob | The rojob cluster name. |
| CDISC | (first file in work/.rojob/*.pid) | A string with host:port to contact when discovery other cluster nodes. |
| RUNONLY | false | Enforces that only jobs under the run folder can be executed. |

## Using roJob

### Python

Copy rojob.py.sample to rojob.py and edit to change the URL and APIKEY. Then use like this:

````bash
python rojob.py [yaml/json oJob file] [ARG1=VAL1] [ARGN=VALN]
````

### OpenAF

Load the rojob.js and create a client object:

````javascript
loadLib("rojob.js");
var rojob = new roJob("http://a.service.endpoint:8787", "......");
var result = rojob.exec("/some/path/ojob.yaml", { arg1: "...", argn: "..." });
````

The ojobs yaml/json can customize how it should be executed in rojob. Just add a custom "roJob" map section:

````yaml
rojob:
   # If you want to run the job async.
   async: true
````

## Runtime ojobs

There are specific runtime ojobs included with everynode under the folder "run/rojob":

| oJob | Arguments | Description |
|------|-----------|-------------|
| echo.yaml | anything | Returns any argument passed. Useful for testing. |
| listnodes.yaml | | Returns the current cluster nodes and async jobs that are currently executing. |
| killjob.yaml | { job: "..." } | Tries to stop the execution of async jobs. Use listnodes.yaml to identify them. |
| showvars.yaml | | Shows important roJob internal variables and OpenAF's version and installed opacks. |
| stop.yaml | | Kills the current rojob node. |
| stopall.yaml | | TRies to kill all rojob nodes. | 

## Deploying in Docker Swarm

Follow the steps:

  1. Build the service: 
````bash
docker build . -t rojob
````

  2. Build the common network between nodes:
````bash
docker network create --scope swarm rojob
````

  3. Create the work volume (if you don't want to map it to the host operating system):

````bash
docker volume create rojob_work
````

  4. Create the service:

````bash
docker service create --replicas 3 --name rojob --network rojob --publish published=8787,target=17878 --mount src=rojob_work,dst=/work -e PORT=8787 -e WORK=/work -e APIKEY=xxxxxx rojob 
````

To stop it just execute:

````bash
docker service rm rojob
````

If you want to map the work folder in the host operating system just replace step 4 with:

````bash
docker service create --replicas 3 --name rojob --network rojob --publish published=8787,target=8787 -e PORT=8787 -e WORK=/work -e APIKEY=xxxxxx --mount src=/roJob/work,dst=/work,type=bind rojob
````

## Deploying a work file browser

You can directly use the openaf-fbrowser container:

### Build it:
````bash
docker build -t rojob-browser https://github.com/OpenAF/openaf-dockers.git#:openaf-fbrowser
````

### And use it:

````bash
docker run --rm -ti -p 8080:80 -v /the/work:/output rojob-browser
````