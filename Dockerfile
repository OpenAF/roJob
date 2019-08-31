FROM openaf/openaf:nightly

ADD  run /openaf/roJob/run
COPY roJobService.js /openaf/roJob/roJobService.js

RUN mkdir /work\
 && mkdir /logs

ENV OPENAF=/openaf/roJob/roJobService.js
ENV WORK=/work
ENV LISTEN=0.0.0.0

WORKDIR /openaf/roJob
